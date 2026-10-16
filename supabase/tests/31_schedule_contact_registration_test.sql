-- P1a is disabled in the shipped schema. Only this rollback-only fixture
-- replaces the migration-owned gate to exercise the future operations.
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select pg_temp.create_test_user('contact-a-825@example.test') as a \gset
select pg_temp.create_test_user('contact-b-825@example.test') as b \gset
select pg_temp.create_test_user('contact-c-825@example.test') as c \gset
select pg_temp.create_test_user('contact-d-825@example.test') as d \gset

select is(public.schedule_contact_registration_enabled(), false, 'registration ships disabled');
select is((select count(*)::int from public.schedule_contacts), 0, 'no automatic accepted backfill');
select ok((select bool_and(relrowsecurity) from pg_class
  where oid in ('public.schedule_contacts'::regclass,
                'public.schedule_contact_requests'::regclass,
                'private.schedule_contact_request_budgets'::regclass)), 'all new tables have RLS');
select is((select count(*)::int from
  (values ('anon'), ('authenticated'), ('public')) roles(name)
  cross join (values ('public.schedule_contacts'), ('public.schedule_contact_requests'),
    ('private.schedule_contact_request_budgets')) tables(name)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
    ('REFERENCES'), ('TRIGGER')) privileges(name)
  where has_table_privilege(roles.name, tables.name, privileges.name)),
  0, 'no client direct table privileges');
select ok(not has_any_column_privilege('authenticated', 'public.schedule_contacts', 'INSERT')
  and not has_any_column_privilege('authenticated', 'public.schedule_contact_requests', 'INSERT'),
  'no latent client column INSERT grant');

call pg_temp.auth_as_user(:'a');
select throws_ok($$select public.request_schedule_contact_by_email('contact-b-825@example.test')$$,
  '0A000', null, 'registered target cannot request while disabled');
select throws_ok($$select public.request_schedule_contact_by_email('unknown-825@example.test')$$,
  '0A000', null, 'unknown target receives the same disabled result');
select throws_ok($$select public.accept_schedule_contact_request(gen_random_uuid())$$,
  '0A000', null, 'accept is gated');
select throws_ok($$select public.decline_schedule_contact_request(gen_random_uuid())$$,
  '0A000', null, 'decline is gated');
select throws_ok($$select public.cancel_schedule_contact_request_by_email('contact-b-825@example.test')$$,
  '0A000', null, 'cancel is gated');
select set_config('app.schedule_contact_registration_enabled', 'true', true);
select is(public.schedule_contact_registration_enabled(), false, 'a caller GUC cannot enable registration');
select throws_ok($$select * from public.schedule_contact_requests$$,
  '42501', null, 'sender cannot enumerate real pending requests');
select throws_ok($$select * from public.schedule_contacts$$,
  '42501', null, 'new accepted table is not yet a public directory');
select throws_ok($$select private.lock_schedule_contact_pair(gen_random_uuid(), gen_random_uuid())$$,
  '42501', null, 'client cannot call the private lock helper');
select throws_ok($$create or replace function public.schedule_contact_registration_enabled()
  returns boolean language sql as 'select true'$$,
  '42501', null, 'client cannot replace the migration-owned gate');

call pg_temp.auth_as_anon();
select throws_ok($$select public.schedule_contact_registration_enabled()$$,
  '42501', null, 'anon cannot execute the capability RPC');
select throws_ok($$select public.request_schedule_contact_by_email('contact-b-825@example.test')$$,
  '42501', null, 'anon cannot execute registration operations');

call pg_temp.auth_as_admin();
select is((select count(*)::int from public.schedule_contact_requests), 0, 'disabled operations wrote no requests');
select is((select count(*)::int from private.schedule_contact_request_budgets), 0, 'disabled operations wrote no budgets');

-- Existing supported email sharing must be unchanged by this additive slice.
insert into public.personal_schedule_entries
  (owner_id, title, is_all_day, starts_on, ends_on, blocking)
values (:'a', 'contact foundation legacy regression', true, '2026-10-16', '2026-10-16', true)
returning id as entry_id \gset
call pg_temp.auth_as_user(:'a');
select lives_ok(format('select public.share_schedule_entry_by_email(%L,%L)',
  :'entry_id', 'contact-b-825@example.test'), 'existing email sharing still succeeds');
call pg_temp.auth_as_user(:'b');
select is((select count(*)::int from public.personal_schedule_entries where id = :'entry_id'),
  1, 'existing shared recipient read is unchanged');
call pg_temp.auth_as_admin();
select count(*)::int as share_count from public.personal_schedule_shares \gset

-- Test fixture only. DDL is rolled back with every fixture below; no GUC or
-- authenticated API can perform this replacement in the shipped schema.
create or replace function public.schedule_contact_registration_enabled()
returns boolean language sql immutable set search_path = '' as $$ select true; $$;

call pg_temp.auth_as_user(:'a');
select lives_ok($$select public.request_schedule_contact_by_email('unknown-825@example.test')$$,
  'unknown request is an opaque no-op');
select lives_ok($$select public.request_schedule_contact_by_email('  CONTACT-B-825@EXAMPLE.TEST  ')$$,
  'exact address normalizes case and surrounding whitespace');
select lives_ok($$select public.request_schedule_contact_by_email('contact-b-825@example.test')$$,
  'duplicate request has the same acknowledgement');
call pg_temp.auth_as_admin();
select is((select count(*)::int from public.schedule_contact_requests), 1, 'one pending request');
select is((select count(*)::int from public.schedule_contacts), 0, 'request is not acceptance');
select is((select attempts from private.schedule_contact_request_budgets where user_id = :'a'),
  3, 'unknown, known, and duplicate all consume caller budget');
select id as request_id from public.schedule_contact_requests \gset

call pg_temp.auth_as_user(:'b');
select lives_ok($$select public.request_schedule_contact_by_email('contact-a-825@example.test')$$,
  'reverse request acknowledges without accepting');
call pg_temp.auth_as_user(:'c');
select lives_ok(format('select public.accept_schedule_contact_request(%L)', :'request_id'),
  'unrelated accept is opaque');
select lives_ok(format('select public.decline_schedule_contact_request(%L)', :'request_id'),
  'unrelated decline is opaque');
select lives_ok($$select public.cancel_schedule_contact_request_by_email('contact-b-825@example.test')$$,
  'unrelated caller cannot cancel the requester relation');
call pg_temp.auth_as_user(:'a');
select lives_ok(format('select public.accept_schedule_contact_request(%L)', :'request_id'),
  'requester cannot approve their own request');
call pg_temp.auth_as_admin();
select is((select count(*)::int from public.schedule_contacts), 0, 'only recipient approval may establish a relation');
select is((select count(*)::int from public.schedule_contact_requests), 1, 'unauthorized operations left pending intact');

call pg_temp.auth_as_user(:'b');
select public.decline_schedule_contact_request(:'request_id');
call pg_temp.auth_as_admin();
select is((select count(*)::int from public.schedule_contact_requests), 0, 'decline removes pending only');
call pg_temp.auth_as_user(:'a');
select public.request_schedule_contact_by_email('contact-b-825@example.test');
call pg_temp.auth_as_admin();
select id as new_request_id from public.schedule_contact_requests \gset
select isnt(:'new_request_id'::uuid, :'request_id'::uuid, 'resubmission has a new request identity');
call pg_temp.auth_as_user(:'b');
select public.accept_schedule_contact_request(:'request_id');
call pg_temp.auth_as_admin();
select is((select count(*)::int from public.schedule_contacts), 0, 'old declined request cannot be accepted');
call pg_temp.auth_as_user(:'a');
select public.cancel_schedule_contact_request_by_email('contact-b-825@example.test');
select public.cancel_schedule_contact_request_by_email('unknown-825@example.test');
call pg_temp.auth_as_user(:'b');
select public.accept_schedule_contact_request(:'new_request_id');
call pg_temp.auth_as_admin();
select is((select count(*)::int from public.schedule_contacts), 0, 'cancelled request cannot be accepted');

call pg_temp.auth_as_user(:'a');
select public.request_schedule_contact_by_email('contact-b-825@example.test');
call pg_temp.auth_as_admin();
update auth.users set email = 'contact-b-new-825@example.test' where id = :'b';
select is((select recipient_id from public.schedule_contact_requests), :'b'::uuid,
  'pending target is stable across email change');
call pg_temp.auth_as_user(:'a');
select public.cancel_schedule_contact_request_by_email('contact-b-825@example.test');
call pg_temp.auth_as_admin();
select is((select count(*)::int from public.schedule_contact_requests), 0, 'cancel uses original supplied address');
call pg_temp.auth_as_user(:'a');
select public.request_schedule_contact_by_email('contact-b-new-825@example.test');
call pg_temp.auth_as_admin();
select id as accepted_request_id from public.schedule_contact_requests \gset
call pg_temp.auth_as_user(:'b');
select public.accept_schedule_contact_request(:'accepted_request_id');
select public.accept_schedule_contact_request(:'accepted_request_id');
call pg_temp.auth_as_admin();
select is((select count(*)::int from public.schedule_contacts), 1, 'recipient acceptance is idempotent');
select is((select count(*)::int from public.schedule_contact_requests), 0, 'accept consumes pending');
select id as contact_id from public.schedule_contacts \gset
select isnt(:'contact_id'::uuid, :'accepted_request_id'::uuid, 'accepted generation does not reuse request ID');
select is((select count(*)::int from public.personal_schedule_shares), :share_count,
  'registration neither adds nor removes any schedule share');
select throws_ok(format('insert into public.schedule_contacts(user_low_id,user_high_id) values (%L,%L)',
  :'a', :'a'), '23514', null, 'self relation rejected by DB constraint');
select throws_ok(format('insert into public.schedule_contact_requests(requester_id,recipient_id,requested_email)
  values (%L,%L,%L)', :'a', :'a', 'contact-a-825@example.test'),
  '23514', null, 'self request rejected by DB constraint');

call pg_temp.auth_as_user(:'a');
select public.request_schedule_contact_by_email('contact-b-new-825@example.test');
select throws_ok($$select public.request_schedule_contact_by_email('contact-a-825@example.test')$$,
  '22023', null, 'self request rejected by operation');
select throws_ok($$select public.request_schedule_contact_by_email('invalid')$$,
  '22023', null, 'malformed email is a caller-input error');
call pg_temp.auth_as_admin();
select is((select count(*)::int from public.schedule_contact_requests), 0, 'accepted relation does not create new pending');
update auth.users set email = 'contact-b-825@example.test' where id = :'c';
call pg_temp.auth_as_user(:'a');
select public.request_schedule_contact_by_email('contact-b-825@example.test');
call pg_temp.auth_as_admin();
select is((select recipient_id from public.schedule_contact_requests), :'c'::uuid, 'reused email creates a new explicit request');
select ok((select user_low_id = least(:'a'::uuid, :'b'::uuid)
  and user_high_id = greatest(:'a'::uuid, :'b'::uuid) from public.schedule_contacts),
  'accepted relation did not move to the reused email account');
delete from auth.users where id = :'c';
select is((select count(*)::int from public.schedule_contact_requests), 0, 'deleted recipient leaves no pending request');

-- The known-target path is limited by unknown attempts as well, rather than
-- a target-dependent pending-row count. The budget stores at most one row.
delete from private.schedule_contact_request_budgets where user_id = :'a';
call pg_temp.auth_as_user(:'a');
select public.request_schedule_contact_by_email('unknown-825@example.test') from generate_series(1, 11);
select public.request_schedule_contact_by_email('contact-d-825@example.test');
call pg_temp.auth_as_admin();
select is((select count(*)::int from public.schedule_contact_requests), 0,
  'unknown attempts exhaust the budget for a new registered target as well');
select is((select attempts from private.schedule_contact_request_budgets where user_id = :'a'),
  11, 'budget saturates at a bounded counter');
select is((select count(*)::int from private.schedule_contact_request_budgets where user_id = :'a'),
  1, 'budget retains no attempt or address history');
update private.schedule_contact_request_budgets set window_started_at = now() - interval '11 minutes'
  where user_id = :'a';
call pg_temp.auth_as_user(:'a');
select public.request_schedule_contact_by_email('contact-d-825@example.test');
call pg_temp.auth_as_admin();
select is((select attempts from private.schedule_contact_request_budgets where user_id = :'a'),
  1, 'expired caller window restarts');
select is((select recipient_id from public.schedule_contact_requests), :'d'::uuid,
  'new registered request succeeds after the caller window expires');
delete from auth.users where id = :'d';
delete from auth.users where id = :'b';
select is((select count(*)::int from public.schedule_contacts), 0, 'account deletion cascades accepted relation');
select is((select count(*)::int from private.schedule_contact_request_budgets where user_id = :'b'),
  0, 'account deletion cascades its caller budget');
select is((select count(*)::int from public.personal_schedule_entries where id = :'entry_id'),
  1, 'recipient account deletion preserves the other owner schedule');

select * from finish();
rollback;
