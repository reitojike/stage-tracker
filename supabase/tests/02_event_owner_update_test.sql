-- oracle: docs/v2/oracle-database.md §2 "events" UPDATE
-- (events_update_own: owner のみ、owner_id は column grant 自体が無い)
-- and §6 "owner-only write: 非ownerは...更新できず、行は変化しない。owner
-- 自身も id/created_at/updated_at/owner_id を直接書き換えられない".
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

select pg_temp.create_test_user() as owner_id \gset
select pg_temp.create_test_user() as other_id \gset

insert into events (owner_id, title, starts_on, ends_on)
values (:'owner_id', 'original title', '2026-04-01', '2026-04-03')
returning id as event_id \gset

-- owner can update an owner-writable column (events_update_own).
call pg_temp.auth_as_user(:'owner_id');
with updated as (
  update events set title = 'owner edited' where id = :'event_id' returning id
)
select is((select count(*) from updated), 1::bigint,
  'owner can update event.title');

-- non-owner's update matches zero rows: RLS USING filters the target
-- rather than raising, so the statement "succeeds" with no effect.
call pg_temp.auth_as_user(:'other_id');
with updated as (
  update events set title = 'hijacked' where id = :'event_id' returning id
)
select is((select count(*) from updated), 0::bigint,
  'non-owner update of event.title matches no rows');

call pg_temp.auth_as_admin();
select is(
  (select title from events where id = :'event_id'),
  'owner edited',
  'event.title is unchanged by the non-owner''s no-op update'
);

-- owner_id has no UPDATE column grant at all (ownership transfer is not a
-- supported operation), so even the owner touching that column raises a
-- permission error before RLS is evaluated.
call pg_temp.auth_as_user(:'owner_id');
select throws_ok(
  format($$ update events set owner_id = %L where id = %L $$, :'other_id', :'event_id'),
  '42501',
  null,
  'owner cannot reassign events.owner_id (no column grant)'
);

select * from finish();
rollback;
