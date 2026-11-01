-- DATA_MODEL.md §2.3 + §3.2 (0003 block); label 0003.
-- Applied in timestamp order. Vector dimension: 768 (docs/decisions.md, Task 0.5).

create table public.documents (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid references auth.users (id) on delete cascade,
  is_public             boolean not null default false,
  title                 text not null,
  original_filename     text not null,
  mime_type             text not null,
  size_bytes            integer not null,
  storage_path          text not null unique,
  status                text not null default 'queued',
  error_reason          text,
  page_count            integer,
  chunk_count           integer not null default 0,
  embedding_model       text,
  pipeline_version      smallint not null default 1,
  processing_started_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- A document is either a private user document (has an owner) or a public sample (has none).
  constraint documents_owner_xor_public
    check ((is_public and owner_id is null) or (not is_public and owner_id is not null)),

  constraint documents_title_shape
    check (char_length(title) between 1 and 200 and title !~ '[[:cntrl:]]'),
  constraint documents_filename_shape
    check (char_length(original_filename) between 1 and 255 and original_filename !~ '[[:cntrl:]]'),
  constraint documents_mime_allowed
    check (mime_type in ('application/pdf', 'text/plain', 'text/markdown')),
  constraint documents_size_limit
    check (size_bytes between 1 and 5242880),                       -- 5 MB
  constraint documents_status_allowed
    check (status in ('queued', 'processing', 'ready', 'failed')),
  constraint documents_error_reason_matches_status
    check ((status = 'failed') = (error_reason is not null)),
  constraint documents_error_reason_allowed
    check (error_reason is null or error_reason in (
      'scanned_pdf', 'too_many_pages', 'file_too_large', 'unsupported_type',
      'corrupt_file', 'encrypted_file', 'empty_document',
      'provider_unavailable', 'internal_error')),
  constraint documents_page_count_limit
    check (page_count is null or page_count between 1 and 30),
  constraint documents_ready_is_complete
    check (status <> 'ready'
           or (page_count is not null and chunk_count > 0 and embedding_model is not null)),
  constraint documents_processing_has_timestamp
    check (status <> 'processing' or processing_started_at is not null),

  -- Storage path must have exactly this shape, which also blocks path traversal:
  --   private:  <owner_id>/<document_id>/<safe filename>
  --   public:   samples/<safe filename>
  constraint documents_storage_path_shape
    check (
      (is_public and storage_path ~ '^samples/[A-Za-z0-9._-]{1,100}$')
      or
      (not is_public and storage_path ~ ('^' || owner_id::text || '/' || id::text || '/[A-Za-z0-9._-]{1,100}$'))
    )
);

-- Enforce per-user document cap and the global storage budget, race-free.
create or replace function private.documents_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_total bigint;
begin
  if new.owner_id is null then
    return new;                                   -- public samples are seeded by an admin script
  end if;

  -- BEFORE triggers run before RLS checks. Without this guard, a forged owner_id would still reach
  -- the cap logic below and could reveal whether ANOTHER user is at their document limit.
  -- auth.uid() is NULL for the service role and admin scripts, so they are unaffected.
  if auth.uid() is not null and new.owner_id is distinct from auth.uid() then
    raise exception 'owner_mismatch' using errcode = '42501';
  end if;

  -- Serialize inserts per user so two parallel uploads can't both slip under the cap.
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text, 0));
  select count(*) into v_count from public.documents d where d.owner_id = new.owner_id;
  if v_count >= private.cfg('max_docs_per_user') then
    raise exception 'document_limit_reached' using hint = 'Delete a document before uploading another.';
  end if;

  -- Serialize the global budget check (tiny scale, so a global lock is fine).
  perform pg_advisory_xact_lock(hashtextextended('global_storage_budget', 0));
  select coalesce(sum(d.size_bytes), 0) into v_total from public.documents d where not d.is_public;
  if v_total + new.size_bytes > private.cfg('storage_budget_bytes') then
    raise exception 'storage_budget_exhausted' using hint = 'Uploads are paused. Try the demo documents.';
  end if;

  return new;
end;
$$;

-- Ownership, visibility, path and type can never change after insert.
create or replace function private.documents_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id           is distinct from old.id
  or new.owner_id     is distinct from old.owner_id
  or new.is_public    is distinct from old.is_public
  or new.storage_path is distinct from old.storage_path
  or new.mime_type    is distinct from old.mime_type
  or new.size_bytes   is distinct from old.size_bytes then
    raise exception 'immutable_column' using hint = 'owner, visibility, path, type and size cannot change.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- After any delete (including cascades from account deletion), queue the file for removal.
create or replace function private.documents_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.storage_deletions (bucket, path)
  values ('documents', old.storage_path)
  on conflict (bucket, path) do nothing;
  return old;
end;
$$;

create trigger documents_bi_limits
  before insert on public.documents
  for each row execute function private.documents_before_insert();

create trigger documents_bu_guard
  before update on public.documents
  for each row execute function private.documents_before_update();

create trigger documents_ad_outbox
  after delete on public.documents
  for each row execute function private.documents_after_delete();

create index documents_owner_created_idx on public.documents (owner_id, created_at desc);
create index documents_public_idx         on public.documents (created_at) where is_public;
create index documents_processing_idx     on public.documents (processing_started_at) where status = 'processing';
create index documents_status_created_idx on public.documents (status, created_at) where status in ('queued', 'failed');

-- ---------------------------------------------------------------------------
-- Row Level Security, policies and grants (DATA_MODEL.md §3.2)
-- ---------------------------------------------------------------------------

alter table public.documents enable row level security;

-- Start from zero, then grant exactly what's needed.
revoke all on public.documents from anon, authenticated;
grant select on public.documents to authenticated;
grant delete on public.documents to authenticated;
-- Column-level insert grant: users cannot even NAME is_public, status, page_count, etc.
grant insert (id, owner_id, title, original_filename, mime_type, size_bytes, storage_path)
  on public.documents to authenticated;

create policy documents_select
  on public.documents for select to authenticated
  using ( is_public or owner_id = (select auth.uid()) );

create policy documents_insert_own
  on public.documents for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and is_public = false
    and status = 'queued'
  );

-- RESTRICTIVE: ANDed with every permissive insert policy, so no future policy can re-open it.
create policy documents_insert_not_anonymous
  on public.documents as restrictive for insert to authenticated
  with check ( coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false );

create policy documents_delete_own
  on public.documents for delete to authenticated
  using ( owner_id = (select auth.uid()) );

-- No UPDATE policy and no UPDATE grant: documents are immutable to clients.
