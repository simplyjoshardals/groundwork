-- DATA_MODEL.md section 2.8 + 3.2 (0008 block); label 0008.
-- Applied in timestamp order. Vector dimension: 768 (docs/decisions.md, Task 0.5).

-- Remove abandoned and long-failed documents. Deleting rows fires the outbox trigger,
-- so the files get cleaned up too.
create or replace function public.reap_documents(
  p_queued_age interval default '1 hour',
  p_failed_age interval default '7 days'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with gone as (
    delete from public.documents d
     where d.is_public = false
       and (
             (d.status = 'queued' and d.created_at < now() - p_queued_age)
          or (d.status = 'failed' and d.updated_at < now() - p_failed_age)
       )
    returning 1
  )
  select count(*) into v_count from gone;
  return v_count;
end;
$$;

-- Anonymous demo users own nothing (they can't upload), so deleting them is safe.
create or replace function public.purge_stale_anonymous_users(p_older_than interval default '14 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with gone as (
    delete from auth.users u
     where u.is_anonymous
       and u.created_at < now() - p_older_than
    returning 1
  )
  select count(*) into v_count from gone;
  return v_count;
end;
$$;

create or replace function public.purge_old_records(p_keep interval default '30 days')
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.usage_daily        where day < ((now() at time zone 'utc') - p_keep)::date;
  delete from public.usage_global_daily where day < ((now() at time zone 'utc') - p_keep)::date;
  delete from public.storage_deletions  where processed_at is not null and processed_at < now() - p_keep;
$$;

-- Optional scheduling with pg_cron (🔎 VERIFY the extension is available), or call the same
-- functions from a GitHub Actions cron using the service-role key.
-- select cron.schedule('reap-documents',  '*/30 * * * *', $$select public.reap_documents()$$);
-- select cron.schedule('purge-anon',      '17 3 * * *',   $$select public.purge_stale_anonymous_users()$$);
-- select cron.schedule('purge-old',       '23 3 * * *',   $$select public.purge_old_records()$$);

revoke all on function public.reap_documents(interval, interval)       from public, anon, authenticated;
revoke all on function public.purge_stale_anonymous_users(interval)    from public, anon, authenticated;
revoke all on function public.purge_old_records(interval)              from public, anon, authenticated;

grant execute on function public.reap_documents(interval, interval)    to service_role;
grant execute on function public.purge_stale_anonymous_users(interval) to service_role;
grant execute on function public.purge_old_records(interval)           to service_role;
