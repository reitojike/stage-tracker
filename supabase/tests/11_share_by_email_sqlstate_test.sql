-- The legacy email-share RPC remains only as a closed compatibility boundary.
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

select pg_temp.create_test_user() as owner_id \gset
select pg_temp.create_test_user() as other_id \gset

insert into personal_schedule_entries (owner_id, title, is_all_day, starts_on, ends_on, blocking)
values (:'owner_id', 'A8 test entry', true, '2026-05-10', '2026-05-10', true)
returning id as entry_id \gset

select email as owner_email from auth.users where id = :'owner_id' \gset
select email as other_email from auth.users where id = :'other_id' \gset
call pg_temp.auth_as_user(:'owner_id');

-- The closed RPC rejects every target before revealing registration or
-- self-share details.
select throws_ok(
  format('select share_schedule_entry_by_email(%L, %L)', :'entry_id', 'nobody-a8@example.test'),
  '42501',
  null,
  'closed email share rejects an unregistered recipient'
);

select throws_ok(
  format('select share_schedule_entry_by_email(%L, %L)', :'entry_id', :'owner_email'),
  '42501',
  null,
  'closed email share rejects a self target'
);

select throws_ok(
  format('select share_schedule_entry_by_email(%L, %L)', :'entry_id', :'other_email'),
  '42501',
  null,
  'closed email share rejects a registered recipient too'
);

select is(
  (select count(*)::int from personal_schedule_shares
    where schedule_entry_id = :'entry_id' and shared_with_user_id = :'other_id'),
  0,
  'closed email share creates no row'
);

select * from finish();
rollback;
