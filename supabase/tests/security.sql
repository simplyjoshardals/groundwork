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
-- Implemented: T00 (added preflight), T01-T10, T02c-T02f (Task 3.4), T11a-d, T12a-h, T13, T15a-i,
-- T16a-T16n, T17a-d, T18a-f, T19a-f (Task 4.2 added T12, T13, T16, T18; Task 5.1 added the usage
-- tests T11a-b, T12a-b, T12f, T15, T18c and the maintenance behaviour tests T19).
--
-- The file expects a database that was just reset (`supabase db reset`) and NOT yet seeded with
-- `yarn seed:samples`: T00d and T00e assert exactly the 2 + 14 rows from supabase/seed.sql.
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
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
call pg_temp.expect_denied('T11a',
  $q$select 1 from public.usage_daily limit 1$q$, 'permission denied for (table|relation) usage_daily');
call pg_temp.expect_denied('T11b',
  $q$select 1 from public.usage_global_daily limit 1$q$, 'permission denied for (table|relation) usage_global_daily');
call pg_temp.expect_denied('T11c',
  $q$select 1 from public.app_config limit 1$q$, 'permission denied for (table|relation) app_config');
call pg_temp.expect_denied('T11d',
  $q$select 1 from public.storage_deletions limit 1$q$, 'permission denied for (table|relation) storage_deletions');
reset role;

-- ===== T12 (subset): Server-only ingestion functions are not callable by users ==
-- A call to a missing function fails with a different error (undefined_function), so it can never
-- pass as "denied": these tests only work once migrations 0005 and 0008 exist.
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
call pg_temp.expect_denied('T12a',
  $q$select * from public.consume_usage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'question')$q$,
  'permission denied for function consume_usage');
call pg_temp.expect_denied('T12b',
  $q$select public.refund_usage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'question')$q$,
  'permission denied for function refund_usage');
call pg_temp.expect_denied('T12c',
  $q$select public.claim_document_for_ingest('a1000000-0000-4000-8000-000000000003')$q$,
  'permission denied for function claim_document_for_ingest');
call pg_temp.expect_denied('T12d',
  $q$select public.finalize_ingestion('a1000000-0000-4000-8000-000000000002', 1, 'x', 1::smallint)$q$,
  'permission denied for function finalize_ingestion');
call pg_temp.expect_denied('T12e',
  $q$select public.fail_ingestion('a1000000-0000-4000-8000-000000000002', 'internal_error')$q$,
  'permission denied for function fail_ingestion');
call pg_temp.expect_denied('T12f',
  $q$select public.purge_stale_anonymous_users()$q$,
  'permission denied for function purge_stale_anonymous_users');
reset role;

-- Privilege matrix (owner view, nothing is executed): the service role is the ONLY caller allowed.
-- T12g is the positive control: without it a wrong revoke would make T12c-e pass for the wrong reason.
do $$
declare
  f regprocedure;
begin
  foreach f in array array[
    'public.claim_document_for_ingest(uuid)'::regprocedure,
    'public.finalize_ingestion(uuid, integer, text, smallint)'::regprocedure,
    'public.fail_ingestion(uuid, text)'::regprocedure,
    'public.consume_usage(uuid, text)'::regprocedure,
    'public.refund_usage(uuid, text)'::regprocedure,
    'public.reap_documents(interval, interval)'::regprocedure,
    'public.purge_stale_anonymous_users(interval)'::regprocedure,
    'public.purge_old_records(interval)'::regprocedure
  ] loop
    assert has_function_privilege('service_role', f, 'execute'),
      'T12g: service_role must be able to execute ' || f::text;
    assert not has_function_privilege('anon', f, 'execute'),
      'T12h: anon must not be able to execute ' || f::text;
    assert not has_function_privilege('authenticated', f, 'execute'),
      'T12h: authenticated must not be able to execute ' || f::text;
  end loop;
end $$;

-- ===== T13: Document cap is enforced (10 per user) ============================
-- Alice has 3. Add 7 more as postgres to reach 10, then try an 11th as Alice.
-- Bob (1 document) must still be able to insert: the cap is per user, not global.
insert into public.documents (id, owner_id, title, original_filename, mime_type, size_bytes, storage_path)
select g.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'filler', 'f.pdf', 'application/pdf', 1000,
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' || g.id::text || '/f.pdf'
from (select gen_random_uuid() as id from generate_series(1, 7)) g;

do $$
begin
  assert (select count(*) from public.documents where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 10,
    'T13 setup: Alice should own exactly 10 documents before the 11th insert';
end $$;

do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
do $$
begin
  insert into public.documents (id, owner_id, title, original_filename, mime_type, size_bytes, storage_path)
  values ('a2000000-0000-4000-8000-000000000009', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'Eleventh', 'f.pdf', 'application/pdf', 1000,
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a2000000-0000-4000-8000-000000000009/f.pdf');
  raise exception 'T13a FAILED: 11th document was accepted';
exception when others then
  if sqlerrm <> 'document_limit_reached' then raise; end if;
end $$;
reset role;

do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
insert into public.documents (id, owner_id, title, original_filename, mime_type, size_bytes, storage_path)
values ('b2000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'Bob second', 'f.pdf', 'application/pdf', 1000,
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/b2000000-0000-4000-8000-000000000001/f.pdf');
reset role;
do $$
begin
  assert exists (select 1 from public.documents where id = 'b2000000-0000-4000-8000-000000000001'),
    'T13b: Bob (under the cap) should still be able to insert a document';
end $$;

-- ===== T15: Usage limits (as postgres; consume_usage/refund_usage are service-role functions) ==
-- Everything runs inside this one transaction, so now() is constant. That makes the cooldown
-- deterministic: a second call right after a successful one always falls inside the 2 s window.
-- Seed: Alice 19/20 questions with last_used_at an hour ago. Demo (cccc...) is anonymous.
do $$
declare
  r record;
begin
  -- T15a: Alice's 20th question is the last allowed one.
  select * into r from public.consume_usage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'question');
  assert r.allowed and r.reason = 'ok' and r.used_today = 20 and r.daily_limit = 20,
    format('T15a: 20th question should be allowed (got %s, %s, %s/%s)', r.allowed, r.reason, r.used_today, r.daily_limit);
  assert r.resets_at = (((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc'),
    'T15a: resets_at must be the next UTC midnight';

  -- T15b: the 21st is denied as user_limit and the counter does not move.
  select * into r from public.consume_usage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'question');
  assert not r.allowed and r.reason = 'user_limit' and r.used_today = 20,
    format('T15b: 21st question must be denied as user_limit (got %s, %s, %s)', r.allowed, r.reason, r.used_today);
  assert (select used from public.usage_daily
          where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and kind = 'question'
            and day = (now() at time zone 'utc')::date) = 20,
    'T15b: a denied call must not increment the counter';

  -- T15c: cooldown. Bob has no row yet, so his first question is allowed and the second, in the
  -- same instant, is denied as cooldown without spending a unit.
  select * into r from public.consume_usage('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'question');
  assert r.allowed and r.used_today = 1, 'T15c setup: Bob''s first question should be allowed';
  select * into r from public.consume_usage('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'question');
  assert not r.allowed and r.reason = 'cooldown' and r.used_today = 1,
    format('T15c: back-to-back question must be denied as cooldown (got %s, %s, %s)', r.allowed, r.reason, r.used_today);

  -- T15d: global cap. Two units are spent globally so far (Alice, Bob). Lower the cap to 2 and the
  -- demo user's question must be denied as global_limit, with the demo user's own unit given back.
  update public.app_config set value = 2 where key = 'limit_global_question';
  select * into r from public.consume_usage('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'question');
  assert not r.allowed and r.reason = 'global_limit' and r.used_today = 0,
    format('T15d: global cap must deny with global_limit and refund (got %s, %s, %s)', r.allowed, r.reason, r.used_today);
  assert (select used from public.usage_daily
          where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and kind = 'question'
            and day = (now() at time zone 'utc')::date) = 0,
    'T15d: the user counter must be rolled back when the global cap denies';
  assert (select used from public.usage_global_daily
          where kind = 'question' and day = (now() at time zone 'utc')::date) = 2,
    'T15d: the global counter must not exceed its cap';
  update public.app_config set value = 200 where key = 'limit_global_question';

  -- T15e: anonymous users cannot ingest (limit_anon_ingest = 0), and nothing is recorded.
  select * into r from public.consume_usage('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'ingest');
  assert not r.allowed and r.reason = 'not_allowed',
    format('T15e: anonymous ingest must be not_allowed (got %s, %s)', r.allowed, r.reason);
  assert not exists (select 1 from public.usage_daily
                     where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and kind = 'ingest'),
    'T15e: a not_allowed call must not create a usage row';

  -- T15f: a user id that does not exist.
  select * into r from public.consume_usage('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'question');
  assert not r.allowed and r.reason = 'unknown_user',
    format('T15f: unknown user must be denied as unknown_user (got %s, %s)', r.allowed, r.reason);
  assert not exists (select 1 from public.usage_daily where user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
    'T15f: an unknown user must not create a usage row';

  -- T15g: an invalid kind is a caller bug and must raise, not return a quiet denial.
  begin
    perform * from public.consume_usage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bogus');
    raise exception 'T15g FAILED: invalid usage kind was accepted';
  exception when others then
    if sqlerrm !~ 'unknown usage kind' then raise; end if;
  end;

  -- T15h: refund gives one unit back to the user and to the global counter.
  perform public.refund_usage('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'question');
  assert (select used from public.usage_daily
          where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and kind = 'question'
            and day = (now() at time zone 'utc')::date) = 0,
    'T15h: refund should return Bob''s unit';
  assert (select used from public.usage_global_daily
          where kind = 'question' and day = (now() at time zone 'utc')::date) = 1,
    'T15h: refund should return the global unit';

  -- T15i: refund never goes below zero, and a user with no row is not an error.
  perform public.refund_usage('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'question');
  assert (select used from public.usage_daily
          where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and kind = 'question'
            and day = (now() at time zone 'utc')::date) = 0,
    'T15i: refund must floor at zero';
  perform public.refund_usage('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'question');
end $$;

-- ===== T16: Immutability and state-machine guards (as postgres) ===============
-- T16a-g follow DATA_MODEL 7.1. T16h-n extra: what claim, finalize and fail each guard against.
do $$
begin
  begin
    update public.documents set owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
     where id = 'a1000000-0000-4000-8000-000000000001';
    raise exception 'T16a FAILED: owner_id changed';
  exception when others then
    if sqlerrm <> 'immutable_column' then raise; end if;
  end;

  begin
    update public.documents set is_public = true where id = 'a1000000-0000-4000-8000-000000000001';
    raise exception 'T16b FAILED: document made public';
  exception when others then
    if sqlerrm <> 'immutable_column' then raise; end if;
  end;

  -- A ready document cannot be re-claimed for ingest
  assert not public.claim_document_for_ingest('a1000000-0000-4000-8000-000000000001'),
    'T16c: ready documents must not be claimable';

  -- A failed document can be claimed exactly once
  assert public.claim_document_for_ingest('a1000000-0000-4000-8000-000000000003'), 'T16d: failed doc should be claimable';
  assert not public.claim_document_for_ingest('a1000000-0000-4000-8000-000000000003'), 'T16e: second claim must fail';

  -- Chunk owner/public flags are overwritten by the trigger even if the caller lies
  insert into public.chunks (document_id, owner_id, is_public, chunk_index, page_number, char_start, char_end, content, embedding, embedding_model)
  values ('b1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true, 50, 1, 0, 4, 'lies',
          array_fill(0.2::real, array[768])::extensions.vector, 'dev-fake-768');
  assert (select owner_id from public.chunks where document_id = 'b1000000-0000-4000-8000-000000000001' and chunk_index = 50)
         = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'T16f: chunk owner must be copied from the document';
  assert (select is_public from public.chunks where document_id = 'b1000000-0000-4000-8000-000000000001' and chunk_index = 50) = false,
    'T16g: chunk visibility must be copied from the document';
end $$;

-- claim: a fresh 'processing' document (seed doc ...0002, started "now") is not taken by a second
-- worker; once it is older than stale_processing_minutes it is taken, and the claim wipes the
-- half-written chunks of the dead attempt.
do $$
begin
  assert not public.claim_document_for_ingest('a1000000-0000-4000-8000-000000000002'),
    'T16h: a fresh processing document must not be claimable';

  insert into public.chunks (document_id, chunk_index, page_number, char_start, char_end, content, embedding, embedding_model)
  values ('a1000000-0000-4000-8000-000000000002', 0, 1, 0, 7, 'partial', array_fill(0.1::real, array[768])::extensions.vector, 'dev-fake-768');
  update public.documents set processing_started_at = now() - interval '11 minutes'
   where id = 'a1000000-0000-4000-8000-000000000002';

  assert public.claim_document_for_ingest('a1000000-0000-4000-8000-000000000002'),
    'T16i: a stale processing document should be claimable';
  assert (select count(*) from public.chunks where document_id = 'a1000000-0000-4000-8000-000000000002') = 0,
    'T16i: claiming must wipe the chunks of the previous attempt';
  assert (select status from public.documents where id = 'a1000000-0000-4000-8000-000000000002') = 'processing',
    'T16i: the re-claimed document must be processing';
end $$;

-- finalize: refuses to mark a document ready unless chunks exist, share the expected model, and the
-- document is still 'processing' (doc ...0003 was claimed in T16d, so it is processing with no chunks).
do $$
begin
  begin
    perform public.finalize_ingestion('a1000000-0000-4000-8000-000000000003', 1, 'dev-fake-768', 1::smallint);
    raise exception 'T16j FAILED: finalize accepted a document with no chunks';
  exception when others then
    if sqlerrm <> 'no_chunks_written' then raise; end if;
  end;

  insert into public.chunks (document_id, chunk_index, page_number, char_start, char_end, content, embedding, embedding_model)
  values ('a1000000-0000-4000-8000-000000000003', 0, 1, 0, 5, 'hello', array_fill(0.1::real, array[768])::extensions.vector, 'dev-fake-768');

  begin
    perform public.finalize_ingestion('a1000000-0000-4000-8000-000000000003', 1, 'some-other-model', 1::smallint);
    raise exception 'T16k FAILED: finalize accepted a chunk set with the wrong embedding model';
  exception when others then
    if sqlerrm <> 'embedding_model_mismatch' then raise; end if;
  end;

  -- ready doc ...0001 has chunks with the right model, so only the status guard can stop this call
  begin
    perform public.finalize_ingestion('a1000000-0000-4000-8000-000000000001', 12, 'dev-fake-768', 1::smallint);
    raise exception 'T16l FAILED: finalize accepted a document that is not processing';
  exception when others then
    if sqlerrm <> 'document_not_processing' then raise; end if;
  end;

  -- positive control for T16j-l: the happy path works
  perform public.finalize_ingestion('a1000000-0000-4000-8000-000000000003', 4, 'dev-fake-768', 1::smallint);
  assert exists (select 1 from public.documents
                  where id = 'a1000000-0000-4000-8000-000000000003' and status = 'ready' and page_count = 4
                    and chunk_count = 1 and embedding_model = 'dev-fake-768' and processing_started_at is null),
    'T16m: finalize should mark the document ready with its page count, chunk count and model';
end $$;

-- fail: records the reason, deletes partial chunks and leaves the document 'failed'
-- (doc ...0002 was re-claimed in T16i, so it is processing).
do $$
begin
  insert into public.chunks (document_id, chunk_index, page_number, char_start, char_end, content, embedding, embedding_model)
  values ('a1000000-0000-4000-8000-000000000002', 0, 1, 0, 7, 'partial', array_fill(0.1::real, array[768])::extensions.vector, 'dev-fake-768');

  perform public.fail_ingestion('a1000000-0000-4000-8000-000000000002', 'internal_error');
  assert exists (select 1 from public.documents
                  where id = 'a1000000-0000-4000-8000-000000000002' and status = 'failed'
                    and error_reason = 'internal_error' and chunk_count = 0 and processing_started_at is null),
    'T16n: fail_ingestion should mark the document failed with the reason';
  assert (select count(*) from public.chunks where document_id = 'a1000000-0000-4000-8000-000000000002') = 0,
    'T16n: fail_ingestion must delete partial chunks';
end $$;

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

-- ===== T18: Account deletion cascades and queues file cleanup (as postgres) ====
do $$
begin
  assert (select count(*) from public.documents where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') > 0
     and (select count(*) from public.chunks where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') > 0
     and (select count(*) from public.usage_daily where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') > 0,
    'T18 setup: Alice must own documents and chunks before the delete, or T18a-b pass vacuously';
  assert not exists (select 1 from public.storage_deletions
                     where path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000001/apartment-lease-2026.pdf'),
    'T18 setup: the outbox must not already hold Alice''s file';
end $$;

delete from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$
begin
  assert (select count(*) from public.documents where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 0,
    'T18a: Alice''s documents should be gone';
  assert (select count(*) from public.chunks where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 0,
    'T18b: Alice''s chunks should be gone';
  assert (select count(*) from public.usage_daily where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 0,
    'T18c: Alice''s usage rows should be gone';
  assert exists (select 1 from public.storage_deletions
                 where path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000001/apartment-lease-2026.pdf'),
    'T18d: Alice''s file must be queued for deletion';
  assert (select count(*) from public.documents where is_public) = 2, 'T18e: public samples must survive';
  assert exists (select 1 from public.documents where id = 'b1000000-0000-4000-8000-000000000001'),
    'T18f: Bob''s data must be untouched';
end $$;

-- ===== T19: Maintenance functions really delete (as postgres; Task 5.1) ====
-- Run after T18 on purpose: reap_documents is not scoped to the rows created here, so on a database
-- that was seeded a while ago it could also reap seed documents that T16 depends on.
do $$
declare
  v_old   uuid := gen_random_uuid();
  v_fresh uuid := gen_random_uuid();
  v_anon  uuid := gen_random_uuid();
  v_n     integer;
begin
  insert into public.documents (id, owner_id, title, original_filename, mime_type, size_bytes, storage_path, status, created_at)
  values
    (v_old,   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'old queued',   'f.pdf', 'application/pdf', 1000,
     'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/' || v_old::text   || '/f.pdf', 'queued', now() - interval '3 hours'),
    (v_fresh, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'fresh queued', 'f.pdf', 'application/pdf', 1000,
     'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/' || v_fresh::text || '/f.pdf', 'queued', now());

  -- T19a-c: an old queued document is reaped, a fresh one is not, and the file is queued for cleanup.
  v_n := public.reap_documents();
  assert v_n >= 1, 'T19a: reap_documents should report at least the old queued document';
  assert not exists (select 1 from public.documents where id = v_old), 'T19b: the old queued document must be deleted';
  assert exists (select 1 from public.documents where id = v_fresh), 'T19b: a fresh queued document must survive';
  assert exists (select 1 from public.storage_deletions
                 where path = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/' || v_old::text || '/f.pdf'),
    'T19c: the reaped document''s file must be queued for deletion';

  -- T19d-f: a stale anonymous user is purged (this proves a SECURITY DEFINER function may delete
  -- from auth.users); a fresh anonymous user and a stale signed-in user are not.
  insert into auth.users (instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', v_anon, 'authenticated', 'authenticated',
          '{"provider":"anonymous"}', '{}', now() - interval '30 days', now() - interval '30 days', true);
  update auth.users set created_at = now() - interval '30 days' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  v_n := public.purge_stale_anonymous_users();
  assert v_n >= 1 and not exists (select 1 from auth.users where id = v_anon),
    'T19d: the stale anonymous user must be purged';
  assert exists (select 1 from auth.users where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
    'T19e: the fresh anonymous demo user must survive';
  assert exists (select 1 from auth.users where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    'T19f: a stale non-anonymous user must never be purged';
end $$;

do $$ begin raise notice 'security.sql: all assertions passed (T00-T10 incl. T02c-f, T11a-d, T12a-h, T13, T15a-i, T16a-n, T17a-d, T18a-f, T19a-f)'; end $$;

rollback;   -- leaves the database exactly as seeded
