-- Task 5.6: purge_old_records now returns how many rows it removed, so the scheduled
-- job can log a count (it returned void in DATA_MODEL 2.8 / migration 0008).
-- A function's return type cannot change with `create or replace`, so drop and recreate.
-- Same body and same grants otherwise. Nothing depends on the old function.

drop function if exists public.purge_old_records(interval);

create function public.purge_old_records(p_keep interval default '30 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usage  integer;
  v_global integer;
  v_outbox integer;
begin
  with gone as (
    delete from public.usage_daily
     where day < ((now() at time zone 'utc') - p_keep)::date
    returning 1
  )
  select count(*) into v_usage from gone;

  with gone as (
    delete from public.usage_global_daily
     where day < ((now() at time zone 'utc') - p_keep)::date
    returning 1
  )
  select count(*) into v_global from gone;

  with gone as (
    delete from public.storage_deletions
     where processed_at is not null and processed_at < now() - p_keep
    returning 1
  )
  select count(*) into v_outbox from gone;

  return v_usage + v_global + v_outbox;
end;
$$;

revoke all on function public.purge_old_records(interval) from public, anon, authenticated;
grant execute on function public.purge_old_records(interval) to service_role;
