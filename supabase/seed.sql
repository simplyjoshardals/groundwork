-- file: supabase/seed.sql  (LOCAL DEV ONLY. Never run against production.)

-- Fixed IDs so the security tests can refer to them.
--   Alice  aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
--   Bob    bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb
--   Demo   cccccccc-cccc-4ccc-8ccc-cccccccccccc   (anonymous session)

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_anonymous)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'authenticated', 'authenticated',
   'alice@example.test', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), false),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'authenticated', 'authenticated',
   'bob@example.test', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), false),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'authenticated', 'authenticated',
   null, '', null,
   '{"provider":"anonymous"}', '{}', now(), now(), true)
on conflict (id) do nothing;

-- Deterministic fake 768-dim embedding, one per seed number.
create function pg_temp.fake_embedding(p_seed integer)
returns extensions.vector
language sql
as $$
  select array(select sin(p_seed * g + 0.5)::real from generate_series(1, 768) g)::extensions.vector(768)
$$;

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
insert into public.documents
  (id, owner_id, is_public, title, original_filename, mime_type, size_bytes, storage_path,
   status, error_reason, page_count, chunk_count, embedding_model, processing_started_at)
values
  -- Public samples (no owner)
  ('5a000000-0000-4000-8000-000000000001', null, true,
   'Northwind Traders: Remote Work Policy', 'northwind-remote-work-policy.pdf', 'application/pdf', 184320,
   'samples/northwind-remote-work-policy.pdf', 'ready', null, 4, 6, 'dev-fake-768', null),
  ('5a000000-0000-4000-8000-000000000002', null, true,
   'Fabrikam Home Router FAQ', 'fabrikam-router-faq.md', 'text/markdown', 9216,
   'samples/fabrikam-router-faq.md', 'ready', null, 2, 3, 'dev-fake-768', null),

  -- Alice: one ready, one still processing, one failed (scanned)
  ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false,
   'Apartment Lease 2026', 'apartment-lease-2026.pdf', 'application/pdf', 912384,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000001/apartment-lease-2026.pdf',
   'ready', null, 12, 3, 'dev-fake-768', null),
  ('a1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false,
   'Q3 Board Notes', 'q3-board-notes.txt', 'text/plain', 20480,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000002/q3-board-notes.txt',
   'processing', null, null, 0, null, now()),
  ('a1000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false,
   'Scanned receipt', 'scan-receipt.pdf', 'application/pdf', 2097152,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000003/scan-receipt.pdf',
   'failed', 'scanned_pdf', null, 0, null, null),

  -- Bob: one ready
  ('b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false,
   'Lab Safety Manual', 'lab-safety-manual.pdf', 'application/pdf', 655360,
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/b1000000-0000-4000-8000-000000000001/lab-safety-manual.pdf',
   'ready', null, 8, 2, 'dev-fake-768', null);

-- ---------------------------------------------------------------------------
-- Chunks (owner_id / is_public are filled in by trigger)
-- ---------------------------------------------------------------------------
insert into public.chunks
  (document_id, chunk_index, page_number, char_start, char_end, content, token_count, embedding, embedding_model)
select v.document_id, v.chunk_index, v.page_number, v.char_start,
       v.char_start + char_length(v.content), v.content, ceil(char_length(v.content) / 4.0)::int,
       pg_temp.fake_embedding(v.seed), 'dev-fake-768'
from (values
  -- Northwind remote work policy (public)
  ('5a000000-0000-4000-8000-000000000001'::uuid, 0, 1,   0, 101,
   'Northwind Traders allows eligible employees to work remotely up to three days per week. Eligibility requires at least six months of continuous employment and a manager''s written approval.'),
  ('5a000000-0000-4000-8000-000000000001'::uuid, 1, 1, 420, 102,
   'Remote employees must be reachable during core hours of 10:00 to 15:00 local time, and must respond to direct messages within one business hour during those hours.'),
  ('5a000000-0000-4000-8000-000000000001'::uuid, 2, 2,   0, 103,
   'The company provides a one-time home office stipend of $500 for new remote employees. The stipend covers a monitor, keyboard, or chair, and receipts must be submitted within 30 days of purchase.'),
  ('5a000000-0000-4000-8000-000000000001'::uuid, 3, 2, 610, 104,
   'Employees must use the company VPN when accessing internal systems. Personal devices may not store customer data, and lost devices must be reported to IT security within 24 hours.'),
  ('5a000000-0000-4000-8000-000000000001'::uuid, 4, 3,   0, 105,
   'Employees working remotely from a different country for more than 14 days in a year must obtain prior approval from HR, because tax and employment law may apply.'),
  ('5a000000-0000-4000-8000-000000000001'::uuid, 5, 4,   0, 106,
   'This policy takes effect on January 1, 2026 and is reviewed annually by the People Operations team.'),

  -- Fabrikam router FAQ (public, markdown with virtual pages)
  ('5a000000-0000-4000-8000-000000000002'::uuid, 0, 1,   0, 107,
   'To factory reset the router, hold the recessed reset button for 10 seconds until the front light blinks amber. All custom settings, including the Wi-Fi name and password, will be erased.'),
  ('5a000000-0000-4000-8000-000000000002'::uuid, 1, 1, 540, 108,
   'The default admin address is 192.168.8.1. The default admin password is printed on the label on the bottom of the device and should be changed during first setup.'),
  ('5a000000-0000-4000-8000-000000000002'::uuid, 2, 2,   0, 109,
   'Fabrikam routers include a two-year limited warranty covering manufacturing defects. Damage from power surges or liquid is not covered.'),

  -- Alice's lease (private)
  ('a1000000-0000-4000-8000-000000000001'::uuid, 0, 2,   0, 201,
   'Tenant shall pay a security deposit of $2,400 prior to occupancy. The deposit will be returned within 30 days after the lease ends, minus any documented damage beyond normal wear.'),
  ('a1000000-0000-4000-8000-000000000001'::uuid, 1, 5,   0, 202,
   'Pets are not permitted without the landlord''s written consent. If consent is given, a pet deposit of $300 per animal is required.'),
  ('a1000000-0000-4000-8000-000000000001'::uuid, 2, 9,   0, 203,
   'Either party may terminate the lease with 60 days written notice after the first twelve months. Early termination within the first twelve months incurs a fee equal to two months of rent.'),

  -- Bob's lab manual (private)
  ('b1000000-0000-4000-8000-000000000001'::uuid, 0, 3,   0, 301,
   'Hydrofluoric acid must be handled only inside a fume hood while wearing neoprene gloves and a full face shield. Calcium gluconate gel must be within reach before work begins.'),
  ('b1000000-0000-4000-8000-000000000001'::uuid, 1, 6,   0, 302,
   'Emergency eyewash stations must be tested weekly and logged. Any station that fails the test must be tagged out of service immediately.')
) as v(document_id, chunk_index, page_number, char_start, seed, content);

-- ---------------------------------------------------------------------------
-- Usage: DATA_MODEL.md section 6.2. Alice is at 19/20 questions today, so the very next question is
-- the last allowed one (T15a) and the one after it is denied (T15b).
insert into public.usage_daily (user_id, day, kind, used, last_used_at)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (now() at time zone 'utc')::date,
        'question', 19, now() - interval '1 hour')
on conflict (user_id, day, kind) do nothing;
-- ---------------------------------------------------------------------------
