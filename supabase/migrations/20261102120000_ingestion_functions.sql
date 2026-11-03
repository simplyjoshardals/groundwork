-- DATA_MODEL.md §2.6 + §3.2 (0006 block); label 0006.
-- Applied in timestamp order. Independent of 0005 (usage): these functions only use
-- public.documents, public.chunks and private.cfg() from migrations 0002 to 0004.

-- Atomically move a document into 'processing'. Returns false if someone else already has it
-- (or it's already ready). Also clears any half-written chunks from a previous attempt.
create or replace function public.claim_document_for_ingest(p_document_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed boolean := false;
begin
  update public.documents d
     set status = 'processing',
         processing_started_at = now(),
         error_reason = null,
         chunk_count = 0
   where d.id = p_document_id
     and (
           d.status in ('queued', 'failed')
        or (d.status = 'processing'
            and d.processing_started_at < now() - make_interval(mins => private.cfg('stale_processing_minutes')::integer))
     )
  returning true into v_claimed;

  if coalesce(v_claimed, false) then
    delete from public.chunks c where c.document_id = p_document_id;
  end if;

  return coalesce(v_claimed, false);
end;
$$;

-- Flip to 'ready' only if chunks were actually written with the expected model.
create or replace function public.finalize_ingestion(
  p_document_id      uuid,
  p_page_count       integer,
  p_embedding_model  text,
  p_pipeline_version smallint default 1
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chunks integer;
begin
  select count(*) into v_chunks from public.chunks c where c.document_id = p_document_id;
  if v_chunks = 0 then
    raise exception 'no_chunks_written';
  end if;

  if exists (select 1 from public.chunks c
             where c.document_id = p_document_id and c.embedding_model <> p_embedding_model) then
    raise exception 'embedding_model_mismatch';
  end if;

  update public.documents d
     set status = 'ready',
         page_count = p_page_count,
         chunk_count = v_chunks,
         embedding_model = p_embedding_model,
         pipeline_version = p_pipeline_version,
         processing_started_at = null
   where d.id = p_document_id
     and d.status = 'processing';

  if not found then
    raise exception 'document_not_processing';
  end if;
end;
$$;

create or replace function public.fail_ingestion(p_document_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.chunks c where c.document_id = p_document_id;

  update public.documents d
     set status = 'failed',
         error_reason = p_reason,
         processing_started_at = null,
         chunk_count = 0
   where d.id = p_document_id
     and d.status in ('queued', 'processing');
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants (DATA_MODEL.md §3.2): server-side callers only (the service role).
-- ---------------------------------------------------------------------------

-- Functions in "public" are executable by PUBLIC by default and are exposed as /rpc endpoints.
-- Revoke explicitly, then grant to the service role only.
revoke all on function public.claim_document_for_ingest(uuid)                     from public, anon, authenticated;
revoke all on function public.finalize_ingestion(uuid, integer, text, smallint)  from public, anon, authenticated;
revoke all on function public.fail_ingestion(uuid, text)                          from public, anon, authenticated;

grant execute on function public.claim_document_for_ingest(uuid)                     to service_role;
grant execute on function public.finalize_ingestion(uuid, integer, text, smallint)  to service_role;
grant execute on function public.fail_ingestion(uuid, text)                          to service_role;
