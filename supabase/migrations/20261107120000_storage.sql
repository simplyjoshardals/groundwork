-- migration: 20261107120000_storage.sql  (DATA_MODEL.md label 0007; sections 2.7 and 3.2)
--
-- Private `documents` bucket plus the two storage.objects policies.
-- The bucket upsert is idempotent on purpose: `yarn seed:samples` (Task 1.6) may already
-- have created the bucket with the same settings, and this migration takes it over.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 5242880,
        array['application/pdf', 'text/plain', 'text/markdown'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read (this is what lets a signed URL be created): your own folder, or the shared samples
-- folder. Anonymous demo sessions use the `authenticated` role, so they can read samples too.
create policy documents_objects_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and (
      split_part(name, '/', 1) = 'samples'
      or split_part(name, '/', 1) = (select auth.uid())::text
    )
  );

-- Write: own folder only, never anonymous, and only at the exact path of a queued row you own.
-- This ties every uploaded byte to a document row that already passed the cap triggers.
create policy documents_objects_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
    and split_part(name, '/', 1) = (select auth.uid())::text
    and exists (
      select 1
      from public.documents d
      where d.owner_id = (select auth.uid())
        and d.storage_path = name           -- "name" resolves to storage.objects.name
        and d.status = 'queued'
    )
  );

-- No UPDATE or DELETE policies: no overwrites, no client-side deletes.
