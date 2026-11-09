-- DATA_MODEL.md section 2.5 + 3.2 (0005 block); label 0005.
-- Applied in timestamp order. Vector dimension: 768 (docs/decisions.md, Task 0.5).

create table public.usage_daily (
  user_id      uuid not null references auth.users (id) on delete cascade,
  day          date not null,
  kind         text not null check (kind in ('question', 'ingest')),
  used         integer not null default 0 check (used >= 0),
  last_used_at timestamptz not null default now(),
  primary key (user_id, day, kind)
);

create table public.usage_global_daily (
  day  date not null,
  kind text not null check (kind in ('question', 'ingest')),
  used integer not null default 0 check (used >= 0),
  primary key (day, kind)
);

-- Atomic "check and spend one unit". Call BEFORE any provider call.
-- Returns allowed=false with a reason: 'user_limit', 'cooldown', 'global_limit', 'not_allowed', 'unknown_user'.
create or replace function public.consume_usage(p_user_id uuid, p_kind text)
returns table (allowed boolean, reason text, used_today integer, daily_limit integer, resets_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day          date        := (now() at time zone 'utc')::date;
  v_reset        timestamptz := ((v_day + 1)::timestamp at time zone 'utc');
  v_is_anon      boolean;
  v_user_limit   integer;
  v_global_limit integer;
  v_cooldown     interval    := null;
  v_used         integer;
  v_global_used  integer;
begin
  if p_kind not in ('question', 'ingest') then
    raise exception 'unknown usage kind: %', p_kind;
  end if;

  select coalesce(u.is_anonymous, false) into v_is_anon from auth.users u where u.id = p_user_id;
  if not found then
    return query select false, 'unknown_user'::text, 0, 0, v_reset;
    return;
  end if;

  if v_is_anon then
    v_user_limit := private.cfg('limit_anon_' || p_kind)::integer;
  else
    v_user_limit := private.cfg('limit_user_' || p_kind)::integer;
  end if;
  v_global_limit := private.cfg('limit_global_' || p_kind)::integer;

  if p_kind = 'question' then
    v_cooldown := make_interval(secs => (private.cfg('cooldown_ms_question') / 1000.0)::double precision);
  end if;

  if v_user_limit <= 0 or v_global_limit <= 0 then
    return query select false, 'not_allowed'::text, 0, greatest(v_user_limit, 0), v_reset;
    return;
  end if;

  -- 1) Per-user counter. The WHERE on the conflict branch makes check+increment one atomic statement.
  insert into public.usage_daily as ud (user_id, day, kind, used, last_used_at)
  values (p_user_id, v_day, p_kind, 1, now())
  on conflict (user_id, day, kind) do update
    set used = ud.used + 1,
        last_used_at = now()
    where ud.used < v_user_limit
      and (v_cooldown is null or ud.last_used_at <= now() - v_cooldown)
  returning ud.used into v_used;

  if v_used is null then
    select ud.used into v_used
    from public.usage_daily ud
    where ud.user_id = p_user_id and ud.day = v_day and ud.kind = p_kind;

    return query select false,
                        (case when v_used >= v_user_limit then 'user_limit' else 'cooldown' end)::text,
                        v_used, v_user_limit, v_reset;
    return;
  end if;

  -- 2) Global counter (the kill switch). If it's exhausted, give the user's unit back.
  insert into public.usage_global_daily as g (day, kind, used)
  values (v_day, p_kind, 1)
  on conflict (day, kind) do update
    set used = g.used + 1
    where g.used < v_global_limit
  returning g.used into v_global_used;

  if v_global_used is null then
    update public.usage_daily ud
       set used = greatest(ud.used - 1, 0)
     where ud.user_id = p_user_id and ud.day = v_day and ud.kind = p_kind;

    return query select false, 'global_limit'::text, greatest(v_used - 1, 0), v_user_limit, v_reset;
    return;
  end if;

  return query select true, 'ok'::text, v_used, v_user_limit, v_reset;
end;
$$;

-- Give a unit back when the failure was ours (provider outage, etc.).
create or replace function public.refund_usage(p_user_id uuid, p_kind text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.usage_daily ud
     set used = greatest(ud.used - 1, 0)
   where ud.user_id = p_user_id
     and ud.kind = p_kind
     and ud.day = (now() at time zone 'utc')::date;

  update public.usage_global_daily g
     set used = greatest(g.used - 1, 0)
   where g.kind = p_kind
     and g.day = (now() at time zone 'utc')::date;
$$;

alter table public.usage_daily        enable row level security;
alter table public.usage_global_daily enable row level security;

revoke all on public.usage_daily        from anon, authenticated;
revoke all on public.usage_global_daily from anon, authenticated;

-- Functions in "public" are executable by PUBLIC by default, and Supabase exposes them as /rpc endpoints.
-- Revoke explicitly, then grant to the service role only.
revoke all on function public.consume_usage(uuid, text) from public, anon, authenticated;
revoke all on function public.refund_usage(uuid, text)  from public, anon, authenticated;
grant execute on function public.consume_usage(uuid, text) to service_role;
grant execute on function public.refund_usage(uuid, text)  to service_role;
