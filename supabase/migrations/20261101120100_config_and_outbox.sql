-- DATA_MODEL.md §2.2 + §3.2 (0002 block); label 0002.
-- Applied in timestamp order. Vector dimension: 768 (docs/decisions.md, Task 0.5).

create table public.app_config (
  key         text primary key check (key ~ '^[a-z0-9_]+$'),
  value       bigint not null check (value >= 0),
  description text not null,
  updated_at  timestamptz not null default now()
);

create trigger app_config_touch
  before update on public.app_config
  for each row execute function private.touch_updated_at();

insert into public.app_config (key, value, description) values
  ('max_docs_per_user',        10,        'Maximum documents one user may own'),
  ('storage_budget_bytes',     209715200, 'Global budget for user-uploaded bytes (200 MB). Set BELOW your plan''s storage cap.'),
  ('limit_user_question',      20,        'Questions per signed-in user per UTC day'),
  ('limit_anon_question',      10,        'Questions per anonymous demo user per UTC day'),
  ('limit_global_question',    200,       'PLACEHOLDER: set from your real provider limits (see ARCHITECTURE.md capacity math)'),
  ('limit_user_ingest',        10,        'Ingestions per signed-in user per UTC day'),
  ('limit_anon_ingest',        0,         'Anonymous users cannot ingest'),
  ('limit_global_ingest',      40,        'PLACEHOLDER: ingestions per UTC day across the app'),
  ('cooldown_ms_question',     2000,      'Minimum milliseconds between two questions from one user'),
  ('stale_processing_minutes', 10,        'A document stuck in processing longer than this may be re-claimed')
on conflict (key) do nothing;

-- Fails loudly if a key is missing: a missing limit must never silently mean "unlimited".
create or replace function private.cfg(p_key text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v bigint;
begin
  select c.value into v from public.app_config c where c.key = p_key;
  if not found then
    raise exception 'missing app_config key: %', p_key;
  end if;
  return v;
end;
$$;

-- Outbox: when a document row is deleted (by anyone, including cascades),
-- its storage path is recorded here so a server job can delete the file via the Storage API.
create table public.storage_deletions (
  id           bigint generated always as identity primary key,
  bucket       text not null default 'documents',
  path         text not null,
  attempts     integer not null default 0,
  last_error   text,
  created_at   timestamptz not null default now(),
  processed_at timestamptz,
  unique (bucket, path)
);

create index storage_deletions_pending_idx
  on public.storage_deletions (created_at)
  where processed_at is null;

-- ---------------------------------------------------------------------------
-- Row Level Security, policies and grants (DATA_MODEL.md §3.2)
-- ---------------------------------------------------------------------------

alter table public.app_config        enable row level security;
alter table public.storage_deletions enable row level security;

-- RLS on with NO policies = deny all for anon/authenticated. The revokes are defense in depth.
revoke all on public.app_config        from anon, authenticated;
revoke all on public.storage_deletions from anon, authenticated;
