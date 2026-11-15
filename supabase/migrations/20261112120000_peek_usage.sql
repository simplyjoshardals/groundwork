-- Read-only counterpart of consume_usage, for the app header's question counter (U2).
-- Reports how much of today's allowance a user has spent WITHOUT spending a unit and without
-- writing any row. Service-role only, like consume_usage: the usage tables stay unreadable to clients.
-- It ignores the cooldown and the global cap on purpose: the counter shows the user's own budget.
-- Returns no row for an unknown user.
create or replace function public.peek_usage(p_user_id uuid, p_kind text)
returns table (used_today integer, daily_limit integer, resets_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day     date        := (now() at time zone 'utc')::date;
  v_reset   timestamptz := ((v_day + 1)::timestamp at time zone 'utc');
  v_is_anon boolean;
  v_limit   integer;
  v_used    integer;
begin
  if p_kind not in ('question', 'ingest') then
    raise exception 'unknown usage kind: %', p_kind;
  end if;

  select coalesce(u.is_anonymous, false) into v_is_anon from auth.users u where u.id = p_user_id;
  if not found then
    return;
  end if;

  if v_is_anon then
    v_limit := private.cfg('limit_anon_' || p_kind)::integer;
  else
    v_limit := private.cfg('limit_user_' || p_kind)::integer;
  end if;

  select coalesce(
           (select ud.used from public.usage_daily ud
             where ud.user_id = p_user_id and ud.day = v_day and ud.kind = p_kind),
           0)
    into v_used;

  return query select v_used, greatest(v_limit, 0), v_reset;
end;
$$;

revoke all on function public.peek_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.peek_usage(uuid, text) to service_role;
