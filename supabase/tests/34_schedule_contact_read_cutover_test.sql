\ir helpers/auth.psql
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Public-schema tests use synthetic users and rollback every change. Actual
-- P3 -> P4 legacy replay, drift rejection and lock races live in the isolated
-- scheduleContactReadCutover.test.ts fixture, never in real auth/public DDL.
select is((select attnotnull from pg_attribute
  where attrelid='public.personal_schedule_shares'::regclass and attname='contact_id'),
  true,'P4 requires a contact generation on every persisted share');
select ok((select p.prosecdef and p.provolatile='s' and p.prorettype='boolean'::regtype
  and p.proconfig=array['search_path=""'] and p.proowner='postgres'::regrole
  from pg_proc p where p.oid='private.can_read_current_schedule_share(uuid)'::regprocedure),
  'read helper is stable, boolean, postgres-owned SECURITY DEFINER with empty search_path');
select ok(has_function_privilege('authenticated','private.can_read_current_schedule_share(uuid)','EXECUTE')
  and not has_function_privilege('anon','private.can_read_current_schedule_share(uuid)','EXECUTE'),
  'read helper execute is limited to authenticated clients');
select is(public.schedule_contact_registration_enabled(),true,'P4 keeps the P3 registration gate enabled');
select ok(not has_function_privilege('authenticated','public.share_schedule_entry_by_email(uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.share_schedule_entry_by_email(uuid,text)','EXECUTE'),
  'P4 never reopens old email creation');
select ok(not has_any_column_privilege('authenticated','public.personal_schedule_shares','INSERT,UPDATE')
  and not has_table_privilege('authenticated','public.personal_schedule_shares','INSERT,UPDATE'),
  'P4 never reopens direct share writes');
select is((select count(*)::int from pg_policy
  where polrelid='public.personal_schedule_shares'::regclass and polcmd='r'),1,
  'shares have one SELECT policy');
select ok((select pg_get_expr(polqual,polrelid) like '%can_read_current_schedule_share(id)%' from pg_policy
  where polrelid='public.personal_schedule_shares'::regclass and polcmd='r'),
  'shares SELECT uses actual persisted share ID');

select pg_temp.create_test_user('p4-read-a@example.test') as a \gset
select pg_temp.create_test_user('p4-read-b@example.test') as b \gset
select pg_temp.create_test_user('p4-read-c@example.test') as c \gset
select pg_temp.create_test_user('p4-read-d@example.test') as d \gset
insert into public.personal_schedule_entries(owner_id,title,is_all_day,starts_on,ends_on,blocking)
values(:'a','P4 A',true,'2026-10-17','2026-10-17',true) returning id as a1 \gset
insert into public.personal_schedule_entries(owner_id,title,is_all_day,starts_on,ends_on,blocking)
values(:'b','P4 B',true,'2026-10-17','2026-10-17',false) returning id as b1 \gset

call pg_temp.auth_as_user(:'a');
select public.request_schedule_contact_by_email('p4-read-b@example.test');
select public.request_schedule_contact_by_email('p4-read-c@example.test');
call pg_temp.auth_as_admin();
select id as request_ab from public.schedule_contact_requests where requester_id=:'a' and recipient_id=:'b' \gset
select id as request_ac from public.schedule_contact_requests where requester_id=:'a' and recipient_id=:'c' \gset
call pg_temp.auth_as_user(:'b');
select public.accept_schedule_contact_request(:'request_ab');
call pg_temp.auth_as_user(:'c');
select public.accept_schedule_contact_request(:'request_ac');
call pg_temp.auth_as_admin();
select id as ab from public.schedule_contacts where user_low_id=least(:'a'::uuid,:'b'::uuid)
  and user_high_id=greatest(:'a'::uuid,:'b'::uuid) \gset
select id as ac from public.schedule_contacts where user_low_id=least(:'a'::uuid,:'c'::uuid)
  and user_high_id=greatest(:'a'::uuid,:'c'::uuid) \gset
select is((select count(*)::int from public.personal_schedule_shares where schedule_entry_id in(:'a1',:'b1')),0,
  'mutual contact acceptance does not publish schedules');
call pg_temp.auth_as_user(:'a');
select id as share_ab from public.share_schedule_entry_with_contact(:'a1',:'ab') \gset
select id as share_ac from public.share_schedule_entry_with_contact(:'a1',:'ac') \gset
call pg_temp.auth_as_user(:'b');
select id as share_ba from public.share_schedule_entry_with_contact(:'b1',:'ab') \gset

select is((select count(*)::int from public.personal_schedule_entries where id=:'a1'),1,
  'B reads explicitly shared A schedule through the transitive entry policy');
select is((select count(*)::int from public.personal_schedule_shares where schedule_entry_id=:'a1'),1,
  'B reads only their own recipient share');
select throws_ok(format('select public.list_schedule_share_recipient_emails(%L)',:'a1'),'P0001',
  'only the schedule entry owner can view recipient emails','recipient cannot use owner email projection');
call pg_temp.auth_as_user(:'a');
select is((select count(*)::int from public.personal_schedule_shares where schedule_entry_id=:'a1'),2,
  'owner reads all current accepted shares of own schedule');
select results_eq(format('select recipient_email from public.list_schedule_share_recipient_emails(%L) order by recipient_email',:'a1'),
  $$select email from (values('p4-read-b@example.test'::text),('p4-read-c@example.test'::text)) expected(email) order by email$$,
  'owner email projection exposes only current recipients');
select is((select count(*)::int from public.personal_schedule_entries where id=:'b1'),1,
  'A reads the reciprocal B schedule');
call pg_temp.auth_as_user(:'c');
select is((select count(*)::int from public.personal_schedule_shares where schedule_entry_id=:'a1'),1,
  'third party cannot enumerate another recipient');
select is((select count(*)::int from public.personal_schedule_entries where id=:'b1'),0,
  'third party cannot read reciprocal A/B sharing');
call pg_temp.auth_as_user(:'d');
select is((select count(*)::int from public.personal_schedule_entries where id in(:'a1',:'b1')),0,
  'unrelated active account cannot read either schedule');
select is((select count(*)::int from public.personal_schedule_shares where id in(:'share_ab',:'share_ba',:'share_ac')),0,
  'known share IDs do not grant an unrelated account access');
call pg_temp.auth_as_anon();
select throws_ok('select * from public.personal_schedule_shares','42501',null,'anonymous share reads stay closed');
call pg_temp.auth_as_admin();

-- Soft-deletion does not cascade rows, so each read surface must independently
-- reject inactive participants even while the persisted generation still exists.
update auth.users set deleted_at=now() where id=:'b';
call pg_temp.auth_as_user(:'a');
select is((select count(*)::int from public.personal_schedule_shares where id in(:'share_ab',:'share_ba')),0,
  'active A cannot read shares involving inactive B in either direction');
select is((select count(*)::int from public.personal_schedule_entries where id=:'b1'),0,
  'inactive owner closes recipient entry visibility');
select results_eq(format('select recipient_email from public.list_schedule_share_recipient_emails(%L)',:'a1'),
  $$select 'p4-read-c@example.test'::text$$,'owner projection suppresses inactive B but preserves C');
call pg_temp.auth_as_user(:'b');
select is((select count(*)::int from public.personal_schedule_entries where id=:'a1'),0,
  'inactive recipient cannot use an unexpired JWT to read shared A schedule');
select is((select count(*)::int from public.personal_schedule_shares where id in(:'share_ab',:'share_ba')),0,
  'inactive caller reads no share metadata');
select is((select count(*)::int from public.list_schedule_share_recipient_emails(:'b1')),0,
  'inactive owner email projection discloses no recipient');
call pg_temp.auth_as_admin();
update auth.users set deleted_at=null,email='p4-read-b-renamed@example.test' where id=:'b';
call pg_temp.auth_as_user(:'a');
select results_eq(format('select recipient_email from public.list_schedule_share_recipient_emails(%L) order by recipient_email',:'a1'),
  $$select email from (values('p4-read-b-renamed@example.test'::text),('p4-read-c@example.test'::text)) expected(email) order by email$$,
  'account email changes preserve the identity-bound share and current projection');

delete from public.personal_schedule_shares where id=:'share_ab';
select is((select count(*)::int from public.list_schedule_contacts()),2,'owner revoke preserves accepted contacts');
call pg_temp.auth_as_user(:'b');
select is((select count(*)::int from public.personal_schedule_entries where id=:'a1'),0,
  'owner revoke immediately closes recipient visibility');
select public.share_schedule_entry_with_contact(:'b1',:'ab');
call pg_temp.auth_as_user(:'a');
delete from public.personal_schedule_shares where id=:'share_ba';
select is((select count(*)::int from public.personal_schedule_entries where id=:'b1'),0,
  'recipient self-leave immediately closes shared entry visibility');
select is((select count(*)::int from public.list_schedule_contacts()),2,'self-leave preserves accepted contacts');
select public.share_schedule_entry_with_contact(:'a1',:'ab');
select public.unlink_schedule_contact(:'ab');
call pg_temp.auth_as_admin();
select is((select count(*)::int from public.personal_schedule_shares where contact_id=:'ab'),0,
  'unlink removes both directions of current generation shares');
select is((select count(*)::int from public.personal_schedule_shares where id=:'share_ac'),1,
  'unlink preserves third-party share');
select is((select count(*)::int from public.personal_schedule_entries where id in(:'a1',:'b1')),2,
  'unlink preserves both owners schedules');

call pg_temp.auth_as_user(:'a');
select public.request_schedule_contact_by_email('p4-read-b-renamed@example.test');
call pg_temp.auth_as_admin();
select id as renewed_request from public.schedule_contact_requests where requester_id=:'a' and recipient_id=:'b' \gset
call pg_temp.auth_as_user(:'b');
select public.accept_schedule_contact_request(:'renewed_request');
call pg_temp.auth_as_admin();
select id as renewed_ab from public.schedule_contacts where user_low_id=least(:'a'::uuid,:'b'::uuid)
  and user_high_id=greatest(:'a'::uuid,:'b'::uuid) \gset
select isnt(:'renewed_ab'::uuid,:'ab'::uuid,'reacceptance creates a distinct consent generation');
call pg_temp.auth_as_user(:'b');
select is((select count(*)::int from public.personal_schedule_entries where id=:'a1'),0,
  'reacceptance does not resurrect an old schedule grant');
call pg_temp.auth_as_user(:'a');
select is((select count(*)::int from public.list_schedule_share_recipient_emails(:'a1')),1,
  'reacceptance does not restore old owner-projection recipients');
select public.share_schedule_entry_with_contact(:'a1',:'renewed_ab');
call pg_temp.auth_as_user(:'b');
select is((select count(*)::int from public.personal_schedule_entries where id=:'a1'),1,
  'explicit sharing under the new generation restores only the requested grant');

select * from finish();
rollback;
