select
  document_id,
  count(*) as stored_chunks,
  count(distinct embedding_model) as distinct_models,
  min(embedding_model) as embedding_model
from public.chunks
where document_id in (
  select id
  from public.documents
  where storage_path like 'samples/%'
)
group by document_id
order by document_id;