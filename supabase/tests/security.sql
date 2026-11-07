-- file: supabase/tests/security.sql   (LOCAL DEV ONLY)
--
-- Task 1.2 subset of DATA_MODEL.md section 7.1. Runs against a freshly seeded local database
-- (`supabase db reset` applies migrations, then supabase/seed.sql).
--
-- How to run (a failed assertion prints its T## label and psql exits non-zero; a clean run
-- prints "security.sql: all assertions passed" and ends with ROLLBACK):
--
--   psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/security.sql
--
--   PowerShell, without a host psql (container name from `docker ps`):
--   Get-Content supabase/tests/security.sql -Raw | docker exec -i supabase_db_groundwork psql -U postgres -d postgres -v ON_ERROR_STOP=1
--
-- Always pass -v ON_ERROR_STOP=1. Without it psql keeps going after a failed assertion.
-- This is plain SQL, not pgTAP: do not run it through `supabase test db`.
--
-- Implemented: T00 (added preflight), T01-T10, T02c-T02f (Task 3.4), T11c, T11d, T17a-T17d.
-- Skipped until their objects exist:
--   T11a, T11b  usage_daily, usage_global_daily        (migration 0005)
--   T12, T15, T16  consume_usage, claim_document_for_ingest, ...  (migrations 0005/0006)
--   T14            storage.objects policies                       (migration 0007)
--   T13, T18       outside the Task 1.2 subset (T18 also needs usage_daily)
--
-- Keep this file ASCII-only so it survives PowerShell piping on any code page.

begin;

-- ===== Helper (session-local, rolled back with everything else) ===============
-- Runs p_sql and requires it to fail with SQLSTATE 42501 AND an error message matching p_pattern.
-- A statement that succeeds, or is denied for some unrelated reason, fails the test loudly.
create procedure pg_temp.expect_denied(p_label text, p_sql text, p_pattern text)
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception when insufficient_privilege then
    if sqlerrm !~* p_pattern then
      raise exception '% FAILED: denied for the wrong reason: %', p_label, sqlerrm;
    end if;
    return;
  end;
-- Reached only when p_sql ran without error: the access was NOT denied.
-- Rows hidden by RLS (0 rows, no error) are not "denied" for a table that must be unreadable.
raise exception '% FAILED: statement was allowed: %', p_label, left(p_sql, 80);
end;
$$;

-- ===== T00: Preflight, run as the DB owner ====================================
-- Negative assertions ("Alice sees 0 of Bob's rows") pass vacuously on an empty database.
-- Prove the fixtures exist and the test is able to fail before trusting any of them.
do $$
begin
  -- assert statements are silently skipped when plpgsql.check_asserts is off.
  if current_setting('plpgsql.check_asserts', true) is distinct from 'on' then
    raise exception 'T00a FAILED: plpgsql.check_asserts is not on; every assert below would silently pass';
  end if;

  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'T00b FAILED: run this script as the database owner (postgres), not as %', current_user;
  end if;

  if (select count(*) from auth.users where id in (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc')) <> 3 then
    raise exception 'T00c FAILED: seed users are missing. Run `supabase db reset` first';
  end if;

  if (select count(*) from public.documents where is_public) <> 2
     or (select count(*) from public.documents where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 3
     or (select count(*) from public.documents where owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 1 then
    raise exception 'T00d FAILED: seed documents are missing or extra. Expected 2 public, 3 Alice, 1 Bob. Run `supabase db reset` first';
  end if;

  if (select count(*) from public.chunks) <> 14 then
    raise exception 'T00e FAILED: expected 14 seed chunks, found %. Run `supabase db reset` first',
      (select count(*) from public.chunks);
  end if;

  -- The rows the negative tests rely on must really exist, be retrievable, and be Bob's.
  if not exists (select 1
                 from public.chunks c join public.documents d on d.id = c.document_id
                 where d.id = 'b1000000-0000-4000-8000-000000000001'
                   and d.status = 'ready'
                   and c.owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
                   and c.embedding_model = 'dev-fake-768'
                   and c.content ilike '%hydrofluoric%') then
    raise exception 'T00f FAILED: Bob''s ready document and its "hydrofluoric" chunk must exist for T02/T03 to be meaningful';
  end if;

  -- Alice's lease chunk is the positive control for T02b and T03b.
  if (select count(*) from public.chunks c
      where c.document_id = 'a1000000-0000-4000-8000-000000000001'
        and c.owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 3 then
    raise exception 'T00g FAILED: Alice''s lease must have 3 chunks owned by Alice';
  end if;

  -- Roles used for impersonation must exist (otherwise `set local role` errors anyway, but say why).
  if (select count(*) from pg_roles where rolname in ('anon', 'authenticated')) <> 2 then
    raise exception 'T00h FAILED: roles anon/authenticated are missing; this is not a Supabase database';
  end if;
end $$;

-- ===== T01: Alice sees her own and public documents, never Bob's ==============
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
do $$
begin
  assert (select count(*) from public.documents where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 3,
    'T01a: Alice should see her 3 documents';
  assert (select count(*) from public.documents where is_public) = 2,
    'T01b: Alice should see the 2 public samples';
  assert (select count(*) from public.documents where owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 0,
    'T01c: Alice must NOT see Bob''s documents';
  assert (select count(*) from public.documents where id = 'b1000000-0000-4000-8000-000000000001') = 0,
    'T01d: Alice must NOT fetch Bob''s document by ID';
end $$;
reset role;

-- ===== T02: Alice can't see Bob's chunk text ==================================
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
do $$
begin
  assert (select count(*) from public.chunks where content ilike '%hydrofluoric%') = 0,
    'T02a: Bob''s chunk text must be invisible to Alice';
  assert (select count(*) from public.chunks where content ilike '%security deposit%') = 1,
    'T02b: Alice should see her own lease chunk';
end $$;
reset role;

-- ===== T02c-f: Fetching one chunk by ID (Task 3.4, lib/documents/get-chunk.ts) ==
-- Chunk IDs are generated, so look them up as the DB owner (before any role switch) and hand them
-- to the sessions below through transaction-local settings, which survive SET LOCAL ROLE.
-- T02c/T02d/T02f-positive are the positive controls that keep the "returns nothing" checks honest.
do $$
begin
  perform set_config('test.alice_chunk', (select c.id::text from public.chunks c
    where c.document_id = 'a1000000-0000-4000-8000-000000000001' and c.chunk_index = 0), true);
  perform set_config('test.public_chunk', (select c.id::text from public.chunks c
    where c.document_id = '5a000000-0000-4000-8000-000000000001' and c.chunk_index = 0), true);
  perform set_config('test.bob_chunk', (select c.id::text from public.chunks c
    where c.document_id = 'b1000000-0000-4000-8000-000000000001' and c.chunk_index = 0), true);

  assert current_setting('test.alice_chunk', true) ~ '^[0-9]+$'
     and current_setting('test.public_chunk', true) ~ '^[0-9]+$'
     and current_setting('test.bob_chunk', true) ~ '^[0-9]+$',
    'T02c-f setup: a seed chunk is missing. Run `supabase db reset` first';
end $$;

-- Alice: her own chunk and a public chunk load; Bob's chunk ID returns nothing.
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
do $$
declare
  r record;
begin
  -- Same columns as getChunk(): never `embedding`.
  select c.id, c.document_id, c.page_number, c.char_start, c.char_end, c.content into r
  from public.chunks c
  where c.id = current_setting('test.alice_chunk')::bigint;
  assert found, 'T02c: Alice should load her own chunk by ID';
  assert r.document_id = 'a1000000-0000-4000-8000-000000000001'::uuid
     and r.page_number = 2
     and r.char_end = r.char_start + char_length(r.content)
     and r.content like 'Tenant shall pay a security deposit%',
    'T02c: Alice''s chunk came back with the wrong document, page, offsets or text';

  select c.id, c.document_id, c.page_number, c.char_start, c.char_end, c.content into r
  from public.chunks c
  where c.id = current_setting('test.public_chunk')::bigint;
  assert found, 'T02d: Alice should load a public chunk by ID';
  assert r.document_id = '5a000000-0000-4000-8000-000000000001'::uuid
     and r.page_number = 1
     and r.content like 'Northwind Traders allows%',
    'T02d: the public chunk came back with the wrong document, page or text';

  assert not exists (select 1 from public.chunks c
                     where c.id = current_setting('test.bob_chunk')::bigint),
    'T02e: Alice must NOT load Bob''s chunk by ID';
end $$;
reset role;

-- The anonymous demo session: public chunks load, Alice's private chunk does not.
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated","is_anonymous":true}', true); end $$;
set local role authenticated;
do $$
begin
  assert exists (select 1 from public.chunks c
                 where c.id = current_setting('test.public_chunk')::bigint),
    'T02f: the demo session should load a public chunk by ID';
  assert not exists (select 1 from public.chunks c
                     where c.id = current_setting('test.alice_chunk')::bigint),
    'T02f: the demo session must NOT load Alice''s chunk by ID';
end $$;
reset role;

-- ===== T03: Retrieval function respects RLS ===================================
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
do $$
declare
  q extensions.vector := array_fill(0.1::real, array[768])::extensions.vector;
begin
  assert not exists (select 1 from public.match_chunks(q, 'dev-fake-768', 20)
                     where doc_id = 'b1000000-0000-4000-8000-000000000001'),
    'T03a: match_chunks leaked Bob''s chunks to Alice';
  assert exists (select 1 from public.match_chunks(q, 'dev-fake-768', 20)
                 where doc_id = 'a1000000-0000-4000-8000-000000000001'),
    'T03b: match_chunks should return Alice''s own chunks';
  assert not exists (select 1 from public.match_chunks(q, 'dev-fake-768', 20, 'b1000000-0000-4000-8000-000000000001')),
    'T03c: filtering by Bob''s document ID must still return nothing';
end $$;
reset role;

-- ===== T04: Alice cannot insert a document owned by Bob =======================
-- Expected: the BEFORE INSERT trigger raises owner_mismatch (42501) before RLS is even evaluated.
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
call pg_temp.expect_denied('T04',
  $q$insert into public.documents (id, owner_id, title, original_filename, mime_type, size_bytes, storage_path)
     values ('a2000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
             'Forged', 'f.pdf', 'application/pdf', 1000,
             'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/a2000000-0000-4000-8000-000000000001/f.pdf')$q$,
  'owner_mismatch');
reset role;

-- ===== T05: Alice cannot name protected columns (is_public, status) ===========
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
call pg_temp.expect_denied('T05a',
  $q$insert into public.documents (id, owner_id, title, original_filename, mime_type, size_bytes, storage_path, is_public)
     values ('a2000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
             'Sneaky', 'f.pdf', 'application/pdf', 1000,
             'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a2000000-0000-4000-8000-000000000002/f.pdf', true)$q$,
  'permission denied for (table|relation) documents');
call pg_temp.expect_denied('T05b',
  $q$insert into public.documents (id, owner_id, title, original_filename, mime_type, size_bytes, storage_path, status)
     values ('a2000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
             'Sneaky', 'f.pdf', 'application/pdf', 1000,
             'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a2000000-0000-4000-8000-000000000003/f.pdf', 'ready')$q$,
  'permission denied for (table|relation) documents');
reset role;

-- ===== T06: Clients cannot UPDATE documents at all ============================
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
call pg_temp.expect_denied('T06a',
  $q$update public.documents set status = 'ready' where id = 'a1000000-0000-4000-8000-000000000003'$q$,
  'permission denied for (table|relation) documents');
call pg_temp.expect_denied('T06b',
  $q$update public.documents set title = 'pwned' where id = 'b1000000-0000-4000-8000-000000000001'$q$,
  'permission denied for (table|relation) documents');
reset role;

-- ===== T07: Alice cannot delete Bob's or public documents =====================
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
do $$
declare n integer;
begin
  delete from public.documents where id = 'b1000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'T07a: Alice deleted Bob''s document';
  delete from public.documents where is_public;
  get diagnostics n = row_count;
  assert n = 0, 'T07b: Alice deleted a public sample';
end $$;
reset role;
do $$
begin
  assert exists (select 1 from public.documents where id = 'b1000000-0000-4000-8000-000000000001'),
    'T07c: Bob''s document must still exist';
  assert (select count(*) from public.documents where is_public) = 2,
    'T07d: public samples must still exist';
end $$;

-- ===== T08: Alice cannot write chunks =========================================
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
call pg_temp.expect_denied('T08',
  $q$insert into public.chunks (document_id, chunk_index, page_number, char_start, char_end, content, embedding, embedding_model)
     values ('a1000000-0000-4000-8000-000000000001', 99, 1, 0, 5, 'fake',
             array_fill(0.1::real, array[768])::extensions.vector, 'dev-fake-768')$q$,
  'permission denied for (table|relation) chunks');
reset role;

-- ===== T09: Anonymous demo user: reads samples, can't upload ==================
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated","is_anonymous":true}', true); end $$;
set local role authenticated;
do $$
begin
  assert (select count(*) from public.documents where is_public) = 2, 'T09a: demo user should see public samples';
  assert (select count(*) from public.documents where not is_public) = 0, 'T09b: demo user must see no private documents';
end $$;
-- Expected: passes the trigger (owner matches), then the RESTRICTIVE policy rejects the row.
call pg_temp.expect_denied('T09c',
  $q$insert into public.documents (id, owner_id, title, original_filename, mime_type, size_bytes, storage_path)
     values ('c1000000-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
             'Anon upload', 'f.pdf', 'application/pdf', 1000,
             'cccccccc-cccc-4ccc-8ccc-cccccccccccc/c1000000-0000-4000-8000-000000000001/f.pdf')$q$,
  'row-level security');
reset role;

-- ===== T10: No session at all (anon role) sees nothing ========================
do $$ begin perform set_config('request.jwt.claims',
  '', true); end $$;
set local role anon;
call pg_temp.expect_denied('T10a',
  $q$select 1 from public.documents limit 1$q$, 'permission denied for (table|relation) documents');
call pg_temp.expect_denied('T10b',
  $q$select 1 from public.chunks limit 1$q$, 'permission denied for (table|relation) chunks');
reset role;

-- ===== T11 (subset): Server-only tables are unreadable to users ===============
-- T11a (usage_daily) and T11b (usage_global_daily) are skipped until migration 0005 creates them.
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
call pg_temp.expect_denied('T11c',
  $q$select 1 from public.app_config limit 1$q$, 'permission denied for (table|relation) app_config');
call pg_temp.expect_denied('T11d',
  $q$select 1 from public.storage_deletions limit 1$q$, 'permission denied for (table|relation) storage_deletions');
reset role;

-- ===== T17: Structural checks (run as the DB owner) ===========================
do $$
declare bad text;
begin
  -- every table in public has RLS on
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  assert bad is null, 'T17a: tables without RLS: ' || coalesce(bad, '');

  -- anon/authenticated may execute ONLY match_chunks (authenticated), nothing else in public
  select string_agg(p.proname || ' (' || r.rolname || ')', ', ') into bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated')) as r(rolname)
  where n.nspname = 'public'
    and has_function_privilege(r.rolname, p.oid, 'execute')
    and not (p.proname = 'match_chunks' and r.rolname = 'authenticated');
  assert bad is null, 'T17b: unexpectedly executable functions: ' || coalesce(bad, '');

  -- match_chunks must exist and be SECURITY INVOKER (a missing function must not pass)
  assert exists (select 1 from pg_proc where proname = 'match_chunks' and pronamespace = 'public'::regnamespace),
    'T17c: match_chunks does not exist';
  assert (select not prosecdef from pg_proc where proname = 'match_chunks' and pronamespace = 'public'::regnamespace),
    'T17c: match_chunks must not be SECURITY DEFINER';

  -- every SECURITY DEFINER function pins search_path
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%');
  assert bad is null, 'T17d: definer functions without a fixed search_path: ' || coalesce(bad, '');
end $$;

do $$ begin raise notice 'security.sql: all assertions passed (T00-T10 incl. T02c-f, T11c-d, T17a-d)'; end $$;

rollback;   -- leaves the database exactly as seeded
