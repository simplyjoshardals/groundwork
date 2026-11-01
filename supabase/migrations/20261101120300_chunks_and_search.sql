-- DATA_MODEL.md §2.4 + §3.2 (0004 block); label 0004.
-- Applied in timestamp order. Vector dimension: 768 (docs/decisions.md, Task 0.5).

create table public.chunks (
  id              bigint generated always as identity primary key,
  document_id     uuid not null references public.documents (id) on delete cascade,
  owner_id        uuid references auth.users (id) on delete cascade,   -- copied from the document by trigger
  is_public       boolean not null default false,                      -- copied from the document by trigger
  chunk_index     integer not null check (chunk_index >= 0),
  page_number     integer not null check (page_number between 1 and 30),
  char_start      integer not null check (char_start >= 0),
  char_end        integer not null,
  content         text not null check (char_length(content) between 1 and 4000),
  token_count     integer check (token_count > 0),
  embedding       extensions.vector(768) not null,
  embedding_model text not null,
  created_at      timestamptz not null default now(),

  unique (document_id, chunk_index),
  constraint chunks_offsets_ordered check (char_end > char_start),
  constraint chunks_owner_xor_public
    check ((is_public and owner_id is null) or (not is_public and owner_id is not null))
);

-- Whatever the caller supplies for owner_id/is_public is overwritten with the document's values.
-- Combined with the immutability trigger on documents, the copies can never drift.
create or replace function private.chunks_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner  uuid;
  v_public boolean;
begin
  select d.owner_id, d.is_public into v_owner, v_public
  from public.documents d
  where d.id = new.document_id;

  if not found then
    raise exception 'document_not_found';
  end if;

  new.owner_id  := v_owner;
  new.is_public := v_public;
  return new;
end;
$$;

create trigger chunks_bi_copy_owner
  before insert on public.chunks
  for each row execute function private.chunks_before_insert();

create index chunks_owner_idx  on public.chunks (owner_id);
create index chunks_public_idx on public.chunks (document_id) where is_public;

-- Retrieval. SECURITY INVOKER is deliberate: it runs with the caller's permissions,
-- so RLS filters every row. Never make this SECURITY DEFINER.
create or replace function public.match_chunks(
  query_embedding   extensions.vector,
  p_embedding_model text,
  match_count       integer default 6,
  p_document_id     uuid    default null
)
returns table (
  chunk_id    bigint,
  doc_id      uuid,
  doc_title   text,
  page_number integer,
  char_start  integer,
  char_end    integer,
  content     text,
  similarity  double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select c.id,
         c.document_id,
         d.title,
         c.page_number,
         c.char_start,
         c.char_end,
         c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  join public.documents d on d.id = c.document_id
  where d.status = 'ready'
    and c.embedding_model = p_embedding_model
    and (p_document_id is null or c.document_id = p_document_id)
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

revoke all on function public.match_chunks(extensions.vector, text, integer, uuid) from public, anon;
grant execute on function public.match_chunks(extensions.vector, text, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security, policies and grants (DATA_MODEL.md §3.2)
-- ---------------------------------------------------------------------------

alter table public.chunks enable row level security;

revoke all on public.chunks from anon, authenticated;
grant select on public.chunks to authenticated;

create policy chunks_select
  on public.chunks for select to authenticated
  using ( is_public or owner_id = (select auth.uid()) );

-- No insert/update/delete policies or grants: only the service role (which bypasses RLS) writes chunks.
