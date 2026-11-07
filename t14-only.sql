-- TEMPORARY, not for the repo: runs only T14 (plus the expect_denied helper) so it does not
-- depend on the T00d/T00e seed-count preflight. Needs the seed users from supabase/seed.sql.
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

do $$ begin
  if (select count(*) from auth.users where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc')) <> 2 then
    raise exception 'seed users are missing; run supabase db reset';
  end if;
  if current_setting('plpgsql.check_asserts', true) is distinct from 'on' then
    raise exception 'plpgsql.check_asserts is not on';
  end if;
end $$;

-- ===== T14: Storage isolation (migration 0007) ===============================
-- Fixtures are inserted here, as the DB owner, and rolled back with everything else.
-- Existing samples/ objects (from `yarn seed:samples`) are left alone, so assertions
-- name specific objects instead of counting a whole folder.
-- (No ON CONFLICT: storage's unique index uses a COLLATE "C" expression that inference cannot match.)
insert into storage.objects (bucket_id, name)
select 'documents', v.name
from (values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/b1000000-0000-4000-8000-000000000001/lab-safety-manual.pdf'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000001/apartment-lease-2026.pdf'),
  ('samples/northwind-remote-work-policy.pdf')
) as v(name)
where not exists (
  select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = v.name
);

-- Queued rows that the insert policy can match: one for Alice, one for the demo session.
insert into public.documents (id, owner_id, title, original_filename, mime_type, size_bytes, storage_path)
values
  ('a9000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'T14 upload', 'upload.pdf', 'application/pdf', 1000,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a9000000-0000-4000-8000-000000000002/upload.pdf'),
  ('c9000000-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'T14 demo upload', 'demo.pdf', 'application/pdf', 1000,
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc/c9000000-0000-4000-8000-000000000001/demo.pdf');

-- T14p: preconditions, so the negative tests below cannot pass vacuously.
do $$
begin
  assert exists (select 1 from storage.buckets
                 where id = 'documents' and not public
                   and file_size_limit = 5242880
                   and allowed_mime_types @> array['application/pdf', 'text/plain', 'text/markdown']
                   and cardinality(allowed_mime_types) = 3),
    'T14p-a: documents bucket must be private with the 5 MiB limit and the 3-type allowlist';
  assert (select array_agg(cmd order by cmd) from pg_policies
          where schemaname = 'storage' and tablename = 'objects' and policyname like 'documents_objects_%')
         = array['INSERT', 'SELECT'],
    'T14p-b: exactly one SELECT and one INSERT policy, no UPDATE or DELETE';
  assert exists (select 1 from storage.objects
                 where bucket_id = 'documents' and name like 'bbbbbbbb-%'),
    'T14p-c: Bob''s storage fixture must exist for T14a to be meaningful';
end $$;

-- Alice (signed in)
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
do $$
begin
  assert not exists (select 1 from storage.objects where bucket_id = 'documents' and name like 'bbbbbbbb-%'),
    'T14a: Alice must not list Bob''s files';
  assert exists (select 1 from storage.objects
                 where bucket_id = 'documents' and name = 'samples/northwind-remote-work-policy.pdf'),
    'T14b: Alice should see public sample files';
  assert exists (select 1 from storage.objects
                 where bucket_id = 'documents'
                   and name = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000001/apartment-lease-2026.pdf'),
    'T14c: Alice should see her own file';
end $$;
call pg_temp.expect_denied('T14d',
  $q$insert into storage.objects (bucket_id, name)
     values ('documents', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/b1000000-0000-4000-8000-000000000001/evil.pdf')$q$,
  'row-level security');
call pg_temp.expect_denied('T14e',
  $q$insert into storage.objects (bucket_id, name)
     values ('documents', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a9000000-0000-4000-8000-000000000001/orphan.pdf')$q$,
  'row-level security');
call pg_temp.expect_denied('T14f',
  $q$insert into storage.objects (bucket_id, name) values ('documents', 'samples/evil.pdf')$q$,
  'row-level security');
-- T14g (positive control): her own folder, at the exact path of her queued row, is allowed.
insert into storage.objects (bucket_id, name)
values ('documents', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a9000000-0000-4000-8000-000000000002/upload.pdf');
do $$
begin
  assert exists (select 1 from storage.objects
                 where bucket_id = 'documents'
                   and name = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a9000000-0000-4000-8000-000000000002/upload.pdf'),
    'T14g: Alice should be able to upload at the path of her queued row';
end $$;
reset role;

-- Demo (anonymous) session
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated","is_anonymous":true}', true); end $$;
set local role authenticated;
do $$
begin
  assert exists (select 1 from storage.objects
                 where bucket_id = 'documents' and name = 'samples/northwind-remote-work-policy.pdf'),
    'T14i: the demo session should see public sample files';
  assert not exists (select 1 from storage.objects where bucket_id = 'documents' and name like 'aaaaaaaa-%'),
    'T14i: the demo session must not see Alice''s files';
end $$;
call pg_temp.expect_denied('T14h',
  $q$insert into storage.objects (bucket_id, name)
     values ('documents', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc/c9000000-0000-4000-8000-000000000001/demo.pdf')$q$,
  'row-level security');
reset role;

do $$ begin raise notice 'T14 standalone: all assertions passed'; end $$;

rollback;