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
-- Implemented: T00 (added preflight), T01-T10, T02c-T02f (Task 3.4), T11c, T11d, T12c-T12h, T13,
-- T16a-T16n, T17a-T17d, T18a, T18b, T18d-T18f (Task 4.2 added T12, T13, T16, T18).
-- Skipped until their objects exist:
--   T11a, T11b  usage_daily, usage_global_daily        (migration 0005)
--   T12a, T12b  consume_usage, refund_usage            (migration 0005)
--   T12f        purge_stale_anonymous_users            (migration 0008)
--   T15, T18c   usage limits; usage rows in the cascade (migration 0005, Slice 5)
--   T14         storage.objects policies               (migration 0007)
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
-- T11a (usage_daily) and T11b (usage_global_daily) are skipped until migration 0005 creates them.
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
call pg_temp.expect_denied('T11c',
  $q$select 1 from public.app_config limit 1$q$, 'permission denied for (table|relation) app_config');
call pg_temp.expect_denied('T11d',
  $q$select 1 from public.storage_deletions limit 1$q$, 'permission denied for (table|relation) storage_deletions');
reset role;

-- ===== T12 (subset): Server-only ingestion functions are not callable by users ==
-- T12a, T12b (consume_usage, refund_usage) and T12f (purge_stale_anonymous_users) are skipped until
-- migrations 0005 and 0008 create them. A call to a missing function fails with a different error
-- (undefined_function), so it can never pass as "denied".
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
call pg_temp.expect_denied('T12c',
  $q$select public.claim_document_for_ingest('a1000000-0000-4000-8000-000000000003')$q$,
  'permission denied for function claim_document_for_ingest');
call pg_temp.expect_denied('T12d',
  $q$select public.finalize_ingestion('a1000000-0000-4000-8000-000000000002', 1, 'x', 1::smallint)$q$,
  'permission denied for function finalize_ingestion');
call pg_temp.expect_denied('T12e',
  $q$select public.fail_ingestion('a1000000-0000-4000-8000-000000000002', 'internal_error')$q$,
  'permission denied for function fail_ingestion');
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
    'public.fail_ingestion(uuid, text)'::regprocedure
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
-- T18c (usage rows are removed too) is skipped until migration 0005 creates usage_daily.
do $$
begin
  assert (select count(*) from public.documents where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') > 0
     and (select count(*) from public.chunks where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') > 0,
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
  assert exists (select 1 from public.storage_deletions
                 where path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000001/apartment-lease-2026.pdf'),
    'T18d: Alice''s file must be queued for deletion';
  assert (select count(*) from public.documents where is_public) = 2, 'T18e: public samples must survive';
  assert exists (select 1 from public.documents where id = 'b1000000-0000-4000-8000-000000000001'),
    'T18f: Bob''s data must be untouched';
end $$;

do $$ begin raise notice 'security.sql: all assertions passed (T00-T10 incl. T02c-f, T11c-d, T12c-h, T13, T16a-n, T17a-d, T18a-b,d-f)'; end $$;

rollback;   -- leaves the database exactly as seeded