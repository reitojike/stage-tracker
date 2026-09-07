-- oracle: docs/v2/oracle-database.md §2 "event_occurrences" INSERT/UPDATE
-- (event_occurrences_insert_own / event_occurrences_update_own: derived
-- from the parent event's owner_id, occurrence has no independent owner)
-- and §5 invariant 14 "Occurrenceの管理権限は常に親Eventのownerから導出される".
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

select pg_temp.create_test_user() as owner_id \gset
select pg_temp.create_test_user() as other_id \gset

insert into events (owner_id, title, starts_on, ends_on)
values (:'owner_id', 'occurrence write fixture', '2026-05-01', '2026-05-10')
returning id as event_id \gset

-- The parent event's owner can add an occurrence to it.
call pg_temp.auth_as_user(:'owner_id');
with inserted as (
  insert into event_occurrences (event_id, starts_at)
  values (:'event_id', '2026-05-02T18:00:00+09:00')
  returning id
)
select is((select count(*) from inserted), 1::bigint,
  'event owner can insert an occurrence for their own event');

-- A non-owner cannot add an occurrence to someone else's event: the INSERT
-- WITH CHECK fails (an error, not a silently-filtered row, since INSERT
-- must always produce exactly the attempted row or none).
call pg_temp.auth_as_user(:'other_id');
select throws_ok(
  format(
    $$ insert into event_occurrences (event_id, starts_at) values (%L, '2026-05-03T18:00:00+09:00') $$,
    :'event_id'
  ),
  '42501',
  null,
  'non-owner cannot insert an occurrence into someone else''s event'
);

call pg_temp.auth_as_admin();
select id as occurrence_id from event_occurrences
  where event_id = :'event_id' and starts_at = '2026-05-02T18:00:00+09:00'
  \gset

-- The parent event's owner can update that occurrence.
call pg_temp.auth_as_user(:'owner_id');
with updated as (
  update event_occurrences set ends_at = '2026-05-02T21:00:00+09:00'
    where id = :'occurrence_id'
  returning id
)
select is((select count(*) from updated), 1::bigint,
  'event owner can update an occurrence of their own event');

-- A non-owner's update of that occurrence matches zero rows.
call pg_temp.auth_as_user(:'other_id');
with updated as (
  update event_occurrences set ends_at = '2026-05-02T23:00:00+09:00'
    where id = :'occurrence_id'
  returning id
)
select is((select count(*) from updated), 0::bigint,
  'non-owner update of another owner''s occurrence matches no rows');

select * from finish();
rollback;
