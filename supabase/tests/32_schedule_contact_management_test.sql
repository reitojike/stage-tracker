\ir helpers/auth.psql
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select pg_temp.create_test_user('p1b-a@example.test') as a \gset
select pg_temp.create_test_user('p1b-b@example.test') as b \gset
select pg_temp.create_test_user('p1b-c@example.test') as c \gset
select pg_temp.create_test_user('p1b-d@example.test') as d \gset
insert into public.personal_schedule_entries(owner_id,title,is_all_day,starts_on,ends_on,blocking)
values (:'a','A1',true,'2026-10-16','2026-10-16',true) returning id as a1 \gset
insert into public.personal_schedule_entries(owner_id,title,is_all_day,starts_on,ends_on,blocking)
values (:'a','A2',true,'2026-10-16','2026-10-16',true) returning id as a2 \gset
insert into public.personal_schedule_entries(owner_id,title,is_all_day,starts_on,ends_on,blocking)
values (:'b','B1',true,'2026-10-16','2026-10-16',true) returning id as b1 \gset
insert into public.personal_schedule_entries(owner_id,title,is_all_day,starts_on,ends_on,blocking)
values (:'c','C1',true,'2026-10-16','2026-10-16',true) returning id as c1 \gset

select is(public.schedule_contact_registration_enabled(),true,'P3 enables registration after the write cutover');
select ok((select relrowsecurity from pg_class where oid='public.schedule_contact_aliases'::regclass),
  'aliases have RLS');
select is((select count(*)::int from (values ('anon'),('authenticated'),('public')) r(name)
  cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(name)
  where has_table_privilege(r.name,'public.schedule_contact_aliases',p.name)),0,'alias direct privileges are absent');
select ok(not has_any_column_privilege('authenticated','public.personal_schedule_shares','INSERT')
  and not has_any_column_privilege('authenticated','public.personal_schedule_shares','UPDATE'),
  'generation column does not reopen direct share writes');

-- Preserve disabled-operation coverage with a transaction-local fixture even
-- though the P3 migration enables the real gate.
create or replace function public.schedule_contact_registration_enabled()
returns boolean language sql immutable set search_path='' as $$ select false; $$;

call pg_temp.auth_as_user(:'a');
select throws_ok('select public.list_received_schedule_contact_requests()','0A000',null,'received list is gated');
select throws_ok('select public.list_schedule_contacts()','0A000',null,'contact list is gated');
select throws_ok('select public.set_schedule_contact_alias(gen_random_uuid(),''wife'')','0A000',null,'alias is gated');
select throws_ok('select public.unlink_schedule_contact(gen_random_uuid())','0A000',null,'unlink is gated');
select throws_ok(format('select public.share_schedule_entry_with_contact(%L,gen_random_uuid())',:'a1'),
  '0A000',null,'new share path is gated');
select throws_ok('select * from public.schedule_contact_aliases','42501',null,'aliases are not a direct directory');
select throws_ok(format('select public.share_schedule_entry_by_email(%L,%L)',:'a1','p1b-b@example.test'),
  '42501',null,'closed email path stays closed while registration is disabled');
call pg_temp.auth_as_user(:'b');
select is((select count(*)::int from public.personal_schedule_entries where id=:'a1'),0,
  'closed email sharing grants no recipient visibility');
call pg_temp.auth_as_admin();
select is((select count(*)::int from public.personal_schedule_shares where schedule_entry_id=:'a1'),0,
  'closed email path creates no share row');
call pg_temp.auth_as_anon();
select throws_ok('select public.list_schedule_contacts()','42501',null,'anon cannot list contacts');
select throws_ok('select public.unlink_schedule_contact(gen_random_uuid())','42501',null,'anon cannot unlink');
call pg_temp.auth_as_admin();

-- Restore the enabled gate inside the rollback-only transaction for positive
-- registration, contact management, and share operations.
create or replace function public.schedule_contact_registration_enabled()
returns boolean language sql immutable set search_path='' as $$ select true; $$;
call pg_temp.auth_as_user(:'a');
select public.request_schedule_contact_by_email('p1b-b@example.test');
call pg_temp.auth_as_user(:'c');
select public.request_schedule_contact_by_email('p1b-a@example.test');
call pg_temp.auth_as_user(:'b');
select results_eq('select requester_email from public.list_received_schedule_contact_requests()',
  $$values ('p1b-a@example.test'::text)$$,'recipient sees only their incoming request');
select is((select count(*)::int from public.list_schedule_contacts()),0,'pending does not appear as accepted');
call pg_temp.auth_as_admin();
select id as req_ab from public.schedule_contact_requests where requester_id=:'a' and recipient_id=:'b' \gset
call pg_temp.auth_as_user(:'a');
select results_eq('select requester_email from public.list_received_schedule_contact_requests()',
  $$values ('p1b-c@example.test'::text)$$,'sender list contains received requests only, not their sent request');
call pg_temp.auth_as_user(:'c');
select is((select count(*)::int from public.list_received_schedule_contact_requests()),0,'stranger cannot see A/B request');
call pg_temp.auth_as_user(:'b');
select public.accept_schedule_contact_request(:'req_ab');
call pg_temp.auth_as_admin();
select id as ab from public.schedule_contacts where user_low_id=least(:'a'::uuid,:'b'::uuid)
  and user_high_id=greatest(:'a'::uuid,:'b'::uuid) \gset
select is((select count(*)::int from public.personal_schedule_shares),0,'acceptance grants no schedule');
call pg_temp.auth_as_user(:'a');
select public.set_schedule_contact_alias(:'ab','  妻  ');
select results_eq('select counterpart_email,own_alias from public.list_schedule_contacts()',
  $$values ('p1b-b@example.test'::text,'妻'::text)$$,'A sees their own trimmed alias only');
call pg_temp.auth_as_user(:'b');
select results_eq('select counterpart_email,own_alias from public.list_schedule_contacts()',
  $$values ('p1b-a@example.test'::text,null::text)$$,'B does not see A alias');
select public.set_schedule_contact_alias(:'ab','private B name');
call pg_temp.auth_as_user(:'a');
select is((select own_alias from public.list_schedule_contacts()),'妻','B alias does not overwrite A alias');
select throws_ok(format('select public.set_schedule_contact_alias(%L,repeat(''x'',81))',:'ab'),
  '22023',null,'alias length is bounded');
select public.set_schedule_contact_alias(:'ab','  ');
select is((select own_alias from public.list_schedule_contacts()),null::text,'blank alias clears only caller alias');
select public.set_schedule_contact_alias(:'ab','妻');
call pg_temp.auth_as_user(:'c');
select is((select count(*)::int from public.list_schedule_contacts()),0,'unrelated caller cannot list A/B relation');
select throws_ok(format('select public.set_schedule_contact_alias(%L,''intrude'')',:'ab'),
  '42501',null,'unrelated caller cannot write alias');
select throws_ok(format('select public.share_schedule_entry_with_contact(%L,%L)',:'c1',:'ab'),
  '42501',null,'unrelated caller cannot use a known relation ID');
select lives_ok(format('select public.unlink_schedule_contact(%L)',:'ab'),'unrelated unlink is an opaque no-op');
call pg_temp.auth_as_admin();
select is((select count(*)::int from public.schedule_contacts),1,'unrelated unlink preserves relation');
select throws_ok(format('insert into public.schedule_contact_aliases(contact_id,owner_id,alias) values(%L,%L,''bad'')',:'ab',:'c'),
  '23514',null,'DB rejects alias owner outside the pair');

call pg_temp.auth_as_user(:'a');
select throws_ok(format('select public.share_schedule_entry_with_contact(%L,%L)',:'b1',:'ab'),
  '42501',null,'relation member still cannot share another owner entry');
select id as share_ab from public.share_schedule_entry_with_contact(:'a2',:'ab') \gset
select id as duplicate_share from public.share_schedule_entry_with_contact(:'a2',:'ab') \gset
select is(:'share_ab'::uuid,:'duplicate_share'::uuid,'new path is entry/recipient idempotent');
select is((select contact_id from public.personal_schedule_shares where id=:'share_ab'),:'ab'::uuid,'share binds current generation');
select public.share_schedule_entry_with_contact(:'a1',:'ab');
delete from public.personal_schedule_shares where id=:'share_ab';
select is((select count(*)::int from public.list_schedule_contacts()),1,'owner revoke preserves relation');
select id as share_again from public.share_schedule_entry_with_contact(:'a2',:'ab') \gset
call pg_temp.auth_as_user(:'b');
delete from public.personal_schedule_shares where id=:'share_again';
select is((select count(*)::int from public.list_schedule_contacts()),1,'self-leave preserves relation');
select id as share_ba from public.share_schedule_entry_with_contact(:'b1',:'ab') \gset
call pg_temp.auth_as_user(:'a');
select public.share_schedule_entry_with_contact(:'a2',:'ab');
call pg_temp.auth_as_admin();
select throws_ok(format('update public.personal_schedule_shares set contact_id=null where schedule_entry_id=%L and shared_with_user_id=%L',:'a2',:'b'),
  '23514',null,'bound generation cannot be cleared');
select throws_ok(format('update public.personal_schedule_shares set shared_with_user_id=%L where schedule_entry_id=%L and shared_with_user_id=%L',:'c',:'a2',:'b'),
  '23514',null,'bound recipient is immutable');
select throws_ok(format('insert into public.personal_schedule_shares(schedule_entry_id,shared_with_user_id,contact_id) values(%L,%L,%L)',:'c1',:'b',:'ab'),
  '23514',null,'DB rejects mismatched entry owner/pair binding');
update auth.users set email='p1b-b-new@example.test' where id=:'b';
call pg_temp.auth_as_user(:'a');
select is((select counterpart_email from public.list_schedule_contacts()),'p1b-b-new@example.test','projection follows email change on stable identity');
call pg_temp.auth_as_user(:'b');
select public.unlink_schedule_contact(:'ab');
call pg_temp.auth_as_admin();
select is((select count(*)::int from public.schedule_contacts),0,'either participant can unlink');
select is((select count(*)::int from public.schedule_contact_aliases),0,'unlink clears both private aliases');
select is((select count(*)::int from public.personal_schedule_shares where shared_with_user_id in (:'a',:'b')),0,
  'unlink clears contact-bound shares in both directions');
select is((select count(*)::int from public.personal_schedule_entries),4,'unlink preserves every source entry');
select is((select count(*)::int from public.schedule_contact_requests),1,'unrelated pending request survives');
call pg_temp.auth_as_user(:'a');
select public.request_schedule_contact_by_email('p1b-b-new@example.test');
call pg_temp.auth_as_admin();
select id as new_req from public.schedule_contact_requests where requester_id=:'a' and recipient_id=:'b' \gset
call pg_temp.auth_as_user(:'b');
select public.accept_schedule_contact_request(:'req_ab');
select public.accept_schedule_contact_request(:'new_req');
call pg_temp.auth_as_admin();
select id as new_ab from public.schedule_contacts \gset
select isnt(:'new_ab'::uuid,:'ab'::uuid,'re-registration is a new generation');
select is((select count(*)::int from public.personal_schedule_shares where shared_with_user_id=:'b'),0,'old shares do not revive');
call pg_temp.auth_as_user(:'a');
select throws_ok(format('select public.share_schedule_entry_with_contact(%L,%L)',:'a2',:'ab'),
  '42501',null,'stale generation is unavailable after re-registration');
select is((select own_alias from public.list_schedule_contacts()),null::text,'old alias does not revive');
select public.share_schedule_entry_with_contact(:'a2',:'new_ab');
select public.unlink_schedule_contact(:'ab');
select is((select count(*)::int from public.list_schedule_contacts()),1,'stale unlink cannot remove a new generation');
select public.set_schedule_contact_alias(:'new_ab','new private name');
call pg_temp.auth_as_admin();
delete from auth.users where id=:'b';
select is((select count(*)::int from public.schedule_contacts),0,'account deletion removes relationship');
select is((select count(*)::int from public.schedule_contact_aliases),0,'account deletion clears both aliases');
select is((select count(*)::int from public.personal_schedule_shares where shared_with_user_id=:'b'),0,'account deletion removes bound recipient shares');
select is((select count(*)::int from public.personal_schedule_entries where owner_id=:'a'),2,'other owner entries survive account deletion');
select * from finish();
rollback;
