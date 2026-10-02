begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(88);

-- Inline equivalents of create_supabase_user / authenticate_as: no helper
-- package, network access, passwords, or real OAuth credentials are needed.
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated',
   'sync-a@example.test', '{"provider":"google","providers":["google"]}', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated',
   'sync-b@example.test', '{"provider":"github","providers":["github"]}', '{}');

create temporary table sync_test_state (key text primary key, value bigint);
grant select, insert, update on table sync_test_state to authenticated;

select ok((select relrowsecurity and relforcerowsecurity from pg_class
           where oid = 'public.vault'::regclass), 'vault enables and forces RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
           where oid = 'public.records'::regclass), 'records enables and forces RLS');
select ok((select count(*) = 4 and bool_and(not prosecdef) from pg_proc
           where oid in ('public.push_records(jsonb)'::regprocedure,
                         'public.pull_records(bigint,integer)'::regprocedure,
                         'public.usage()'::regprocedure,
                         'public.delete_my_data()'::regprocedure)),
          'all four public RPCs are security invoker');
select ok((select bool_and(proconfig @> array['search_path=""']) from pg_proc
           where oid in ('public.push_records(jsonb)'::regprocedure,
                         'public.pull_records(bigint,integer)'::regprocedure,
                         'public.usage()'::regprocedure,
                         'public.delete_my_data()'::regprocedure)),
          'all four public RPCs have an empty search_path');
select is((select count(*) from pg_policy
           where polrelid in ('public.records'::regclass, 'public.vault'::regclass)
             and polcmd in ('d', '*')), 0::bigint, 'there is no DELETE policy');
select ok((select count(*) = 6 and bool_and(polroles = array[
             (select oid from pg_roles where rolname = 'authenticated')])
           from pg_policy where polrelid in ('public.records'::regclass, 'public.vault'::regclass)),
          'all six RLS policies apply only to authenticated');
select is((select username from cron.job where jobname = 'anchoa-prune-tombstones'),
          'postgres', 'cleanup runs as postgres to bypass forced RLS');
select is((select schedule from cron.job where jobname = 'anchoa-prune-tombstones'),
          '0 3 * * *', 'cleanup is scheduled daily');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

select is(public.push_records('[
  {"id":"shared","changed_at":200,"device_id":"10000000-0000-0000-0000-000000000001","deleted":false,"payload":"\\x1122"},
  {"id":"b-only","changed_at":200,"device_id":"10000000-0000-0000-0000-000000000001","deleted":true,"payload":"\\x3344"}
]'), '{"rejected":[]}'::jsonb, 'B can push records and encrypted tombstones');
select lives_ok($$insert into public.vault (kdf, dek_by_passphrase, dek_by_recovery)
  values ('{"alg":"argon2id"}', '\x02', '\x03')$$, 'B can create a vault');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000000000a1","role":"authenticated"}';

select is(auth.uid(), '00000000-0000-0000-0000-0000000000a1'::uuid, 'JWT authenticates A');
select is((select count(*) from public.records), 0::bigint, 'A cannot read B records');
select is((select count(*) from public.vault), 0::bigint, 'A cannot read B vault');
select results_empty($$update public.records set payload = '\xdead'
  where user_id = '00000000-0000-0000-0000-0000000000b2' returning id$$,
  'A cannot update B records directly');
select results_empty($$update public.vault set dek_by_passphrase = '\xdead'
  where user_id = '00000000-0000-0000-0000000000b2' returning user_id$$,
  'A cannot update B vault directly');
select throws_ok($$insert into public.records (user_id, id, changed_at, device_id, deleted, payload)
  values ('00000000-0000-0000-0000-0000000000b2', 'shared', 900,
          '10000000-0000-0000-0000-000000000001', false, '\xdead')
  on conflict (user_id, id) do update set payload = excluded.payload$$,
  '42501', null, 'A cannot overwrite B records with a table upsert');
select throws_ok($$insert into public.vault (user_id, kdf, dek_by_passphrase, dek_by_recovery)
  values ('00000000-0000-0000-0000-0000000000b2', '{}', '\xdead', '\xdead')
  on conflict (user_id) do update set dek_by_passphrase = excluded.dek_by_passphrase$$,
  '42501', null, 'A cannot overwrite B vault with a table upsert');
select lives_ok($$insert into public.vault (kdf, dek_by_passphrase, dek_by_recovery)
  values ('{"alg":"argon2id"}', '\x04', '\x05')$$, 'A can create a vault');
select lives_ok($$insert into public.vault (kdf, dek_by_passphrase, dek_by_recovery)
  values ('{"alg":"argon2id"}', '\x06', '\x07')
  on conflict (user_id) do update set dek_by_passphrase = excluded.dek_by_passphrase$$,
  'A can upsert its own vault');
select is((select dek_by_passphrase from public.vault), '\x06'::bytea, 'vault upsert stores the new value');
select throws_ok($$update public.vault set user_id = '00000000-0000-0000-0000-0000000000b2'$$,
  '42501', null, 'A cannot transfer its vault to B');
select is(public.push_records('[
  {"user_id":"00000000-0000-0000-0000-0000000000b2","id":"shared","changed_at":900,
   "device_id":"10000000-0000-0000-0000-000000000001","deleted":false,"payload":"\\xaabb"}
]'), '{"rejected":[]}'::jsonb, 'push ignores spoofed user_id and writes as A');
select is((select user_id from public.records where id = 'shared'),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'same id is stored separately for A');
select throws_ok($$update public.records set user_id = '00000000-0000-0000-0000-0000000000b2'
  where id = 'shared'$$, '42501', null, 'A cannot transfer its record to B');
select is((select count(*) from public.pull_records(0, 500)), 1::bigint, 'pull excludes both B records');
select is((select rows from public.usage()), 1::bigint, 'usage excludes B record count');
select is((select bytes from public.usage()), 2::bigint, 'usage excludes B ciphertext bytes');

reset role;
select is((select changed_at from public.records
  where user_id = '00000000-0000-0000-0000-0000000000b2' and id = 'shared'),
  200::bigint, 'B version survives attempted table and RPC overwrites');
select is((select payload from public.records
  where user_id = '00000000-0000-0000-0000-0000000000b2' and id = 'shared'),
  '\x1122'::bytea, 'B ciphertext survives attempted overwrites');
select is((select dek_by_passphrase from public.vault
  where user_id = '00000000-0000-0000-0000-0000000000b2'),
  '\x02'::bytea, 'B vault survives attempted overwrites');
set local role authenticated;

select is(public.push_records('[
  {"id":"lww","changed_at":100,"device_id":"10000000-0000-0000-0000-000000000002","deleted":false,"payload":"\\x0102"}
]'), '{"rejected":[]}'::jsonb, 'initial LWW insert is accepted');
insert into sync_test_state select 'lww_seq', seq from public.records where id = 'lww';
select is(public.push_records('[
  {"id":"lww","changed_at":99,"device_id":"10000000-0000-0000-0000-000000000003","deleted":false,"payload":"\\xdead"}
]'), '{"rejected":[{"id":"lww","changed_at":100,"device_id":"10000000-0000-0000-0000-000000000002"}]}'::jsonb,
  'older timestamp is rejected with the stored version even with a higher device_id');
select is(public.push_records('[
  {"id":"lww","changed_at":100,"device_id":"10000000-0000-0000-0000-000000000002","deleted":true,"payload":"\\xdead"}
]'), '{"rejected":[{"id":"lww","changed_at":100,"device_id":"10000000-0000-0000-0000-000000000002"}]}'::jsonb,
  'an equal version is rejected, including a competing tombstone');
select is((select payload from public.records where id = 'lww'), '\x0102'::bytea,
  'rejected versions leave ciphertext unchanged');
select is((select seq from public.records where id = 'lww'),
  (select value from sync_test_state where key = 'lww_seq'), 'rejected versions leave seq unchanged');
select is(public.push_records('[
  {"id":"lww","changed_at":101,"device_id":"10000000-0000-0000-0000-000000000001","deleted":false,"payload":"\\x0304"}
]'), '{"rejected":[]}'::jsonb, 'newer timestamp wins even with a lower device_id');
select ok((select seq from public.records where id = 'lww') >
  (select value from sync_test_state where key = 'lww_seq'), 'seq increases on accepted update');
update sync_test_state set value = (select seq from public.records where id = 'lww') where key = 'lww_seq';
select is(public.push_records('[
  {"id":"lww","changed_at":101,"device_id":"10000000-0000-0000-0000-000000000002","deleted":false,"payload":"\\x070809"}
]'), '{"rejected":[]}'::jsonb, 'higher device_id breaks a timestamp tie');
select is(public.push_records('[
  {"id":"lww","changed_at":101,"device_id":"10000000-0000-0000-0000-000000000001","deleted":false,"payload":"\\xdead"}
]'), '{"rejected":[{"id":"lww","changed_at":101,"device_id":"10000000-0000-0000-0000-000000000002"}]}'::jsonb,
  'lower device_id loses a timestamp tie and receives the stored version');
select is((select payload from public.records where id = 'lww'), '\x070809'::bytea,
  'tie winner ciphertext is stored');
select ok((select seq from public.records where id = 'lww') >
  (select value from sync_test_state where key = 'lww_seq'), 'seq increases again on accepted tie update');

select is(public.push_records('[
  {"id":"tombstone","changed_at":1,"device_id":"10000000-0000-0000-0000-000000000001","deleted":true,"payload":"\\xa0"}
]'), '{"rejected":[]}'::jsonb, 'a tombstone with ciphertext is accepted');
select throws_ok($$select public.push_records('[
  {"id":"null-tombstone","changed_at":1,"device_id":"10000000-0000-0000-0000-000000000001","deleted":true,"payload":null}
]')$$, '23502', null, 'tombstones cannot have a NULL payload');
select throws_ok($$select public.push_records(jsonb_build_array(jsonb_build_object(
  'id', 'oversized', 'changed_at', 1, 'device_id', '10000000-0000-0000-0000-000000000001',
  'deleted', false, 'payload', '\x' || repeat('ab', 262145))))$$,
  '23514', null, 'ciphertext larger than 256 KiB is rejected');
select lives_ok($$select public.push_records(jsonb_build_array(jsonb_build_object(
  'id', 'at-limit', 'changed_at', 1, 'device_id', '10000000-0000-0000-0000-000000000001',
  'deleted', false, 'payload', '\x' || repeat('ab', 262144))))$$,
  'ciphertext of exactly 256 KiB is accepted');
select throws_ok($$select public.push_records(jsonb_build_array(jsonb_build_object(
  'id', repeat('i', 81), 'changed_at', 1, 'device_id', '10000000-0000-0000-0000-000000000001',
  'deleted', false, 'payload', '\x00')))$$, '23514', null, 'ids longer than 80 characters are rejected');
select lives_ok($$select public.push_records(jsonb_build_array(jsonb_build_object(
  'id', repeat('i', 80), 'changed_at', 1, 'device_id', '10000000-0000-0000-0000-000000000001',
  'deleted', false, 'payload', '\x00')))$$, 'an id of exactly 80 characters is accepted');
select throws_ok($$select public.push_records('[
  {"id":"invalid-device","changed_at":1,"device_id":"not-a-uuid","deleted":false,"payload":"\\x00"}
]')$$, '22P02', null, 'device_id must be a UUID');
select throws_ok($$select public.push_records('[
  {"id":"nonhex","changed_at":1,"device_id":"10000000-0000-0000-0000-000000000001","deleted":false,"payload":"plaintext"}
]')$$, '22023', 'payload must be a hex bytea string', 'payload must use hex bytea encoding');
select throws_ok($$select public.push_records('[
  {"id":"badhex","changed_at":1,"device_id":"10000000-0000-0000-0000-000000000001","deleted":false,"payload":"\\xzz"}
]')$$, '22P02', null, 'malformed hex is rejected');
select throws_ok($$select public.push_records('{}')$$, '22023', 'rows must be a JSON array',
  'non-array input is rejected');
select throws_ok($$select public.push_records(null)$$, '22023', 'rows must be a JSON array',
  'NULL input is rejected');
select throws_ok($$select public.push_records((select jsonb_agg(jsonb_build_object(
  'id', 'too-many-' || i, 'changed_at', 1, 'device_id', '10000000-0000-0000-0000-000000000001',
  'deleted', false, 'payload', '\x00')) from generate_series(1, 501) as g(i)))$$,
  '22023', 'push_records accepts at most 500 rows', 'a 501-row batch is rejected');
insert into sync_test_state select 'batch_cursor', max(seq) from public.records;
select is(public.push_records((select jsonb_agg(jsonb_build_object(
  'id', 'batch-' || i, 'changed_at', 1, 'device_id', '10000000-0000-0000-0000-000000000001',
  'deleted', false, 'payload', '\x00') order by i) from generate_series(1, 500) as g(i))),
  '{"rejected":[]}'::jsonb, 'a 500-row batch is accepted');
select is(public.push_records('[]'), '{"rejected":[]}'::jsonb, 'an empty batch is accepted');
select is((select count(*) from public.records where id in ('null-tombstone', 'oversized', 'too-many-1')),
  0::bigint, 'failed pushes leave no records');

select is((select count(*) from public.pull_records(0, 1)), 1::bigint, 'pull honours max 1');
select is((select count(*) from public.pull_records(0, 0)), 1::bigint, 'pull clamps max 0 to 1');
select is((select count(*) from public.pull_records(0, -5)), 1::bigint, 'pull clamps a negative max to 1');
select results_eq($$select id from public.pull_records(0, 3)$$,
  $$select id from public.records order by seq limit 3$$, 'pull returns the first three records in seq order');
select results_eq($$select seq from public.pull_records(0, 500)$$,
  $$select seq from public.records order by seq limit 500$$, 'pull is ordered by seq across a full batch');
select is((select count(*) from public.pull_records(0, 999)), 500::bigint, 'pull clamps max above 500');
select is((select count(*) from public.pull_records(0, null)), 500::bigint, 'pull treats NULL max as 500');
select ok((select count(*) = 500 and min(seq) > (select value from sync_test_state where key = 'batch_cursor')
  from public.pull_records((select value from sync_test_state where key = 'batch_cursor'), 500)),
  'pull returns only records strictly after the cursor');
select is((select count(*) from public.pull_records((select max(seq) from public.records), 500)),
  0::bigint, 'pull after the last seq is empty');
select is((select rows from public.usage()), (select count(*) from public.records),
  'usage includes all caller records, including tombstones');
select is((select bytes from public.usage()), (select sum(octet_length(payload)) from public.records),
  'usage sums ciphertext bytes');

select throws_ok($$delete from public.records$$, '42501', null, 'direct record deletion is denied');
select throws_ok($$delete from public.vault$$, '42501', null, 'direct vault deletion is denied');
select lives_ok($$select public.delete_my_data()$$, 'A can delete its cloud data through the RPC');
select is((select count(*) from public.records), 0::bigint, 'delete_my_data removes all A records');
select is((select count(*) from public.vault), 0::bigint, 'delete_my_data removes A vault');
select results_eq($$select rows, bytes from public.usage()$$, $$values (0::bigint, 0::bigint)$$,
  'usage returns zero rows and bytes after deletion');

reset role;
select is((select count(*) from public.records where user_id = '00000000-0000-0000-0000-0000000000b2'),
  2::bigint, 'delete_my_data preserves both B records');
select is((select count(*) from public.vault where user_id = '00000000-0000-0000-0000-0000000000b2'),
  1::bigint, 'delete_my_data preserves B vault');

-- Simulate aged records as postgres. Disable only the timestamp trigger while
-- backdating fixtures, then execute the actual scheduled SQL in this transaction.
insert into public.records (user_id, id, changed_at, device_id, deleted, payload)
values
  ('00000000-0000-0000-0000-0000000000b2', 'old-tombstone', 1,
   '10000000-0000-0000-0000-000000000001', true, '\x00'),
  ('00000000-0000-0000-0000-0000000000a1', 'other-old-tombstone', 1,
   '10000000-0000-0000-0000-000000000001', true, '\x00'),
  ('00000000-0000-0000-0000-0000000000b2', 'old-soft-delete', 1,
   '10000000-0000-0000-0000-000000000001', false, '\x00'),
  ('00000000-0000-0000-0000-0000000000b2', 'recent-tombstone', 1,
   '10000000-0000-0000-0000-000000000001', true, '\x00');
alter table public.records disable trigger records_stamp;
update public.records set updated_at = now() - interval '91 days'
where id in ('old-tombstone', 'other-old-tombstone', 'old-soft-delete');
alter table public.records enable trigger records_stamp;
select lives_ok($$do $cleanup$
  declare command text;
  begin
    select j.command into command from cron.job as j where j.jobname = 'anchoa-prune-tombstones';
    execute command;
  end;
$cleanup$;$$, 'the scheduled cleanup command executes');
select is((select count(*) from public.records where id in ('old-tombstone', 'other-old-tombstone')),
  0::bigint, 'cleanup deletes expired tombstones across both users');
select is((select count(*) from public.records where id = 'old-soft-delete'),
  1::bigint, 'cleanup preserves old non-tombstones, including encrypted soft deletes');
select is((select count(*) from public.records where id = 'recent-tombstone'),
  1::bigint, 'cleanup preserves recent tombstones');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select * from public.records$$, '42501', null, 'anon cannot read records');
select throws_ok($$select * from public.vault$$, '42501', null, 'anon cannot read vault');
select throws_ok($$select public.push_records('[]')$$, '42501', null, 'anon cannot call push_records');
select throws_ok($$select * from public.pull_records(0, 500)$$, '42501', null, 'anon cannot call pull_records');
select throws_ok($$select * from public.usage()$$, '42501', null, 'anon cannot call usage');
select throws_ok($$select public.delete_my_data()$$, '42501', null, 'anon cannot call delete_my_data');
select throws_ok($$select anchoa_private.delete_my_data()$$, '42501', null, 'anon cannot call the private helper');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$select public.push_records('[]')$$, '42501', 'Authentication required',
  'push requires a JWT subject even when the role is authenticated');
select throws_ok($$select public.delete_my_data()$$, '42501', 'Authentication required',
  'delete requires a JWT subject even when the role is authenticated');

reset role;
select * from finish();
rollback;
