-- DATA_MODEL.md §2.1; label 0001.
-- Applied in timestamp order. Vector dimension: 768 (docs/decisions.md, Task 0.5).

-- pgvector lives in the "extensions" schema on Supabase.
create extension if not exists vector with schema extensions;

-- Helper and trigger functions live in "private": never exposed through the API,
-- and unreachable by anon/authenticated roles.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
