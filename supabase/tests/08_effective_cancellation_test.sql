-- oracle: docs/v2/oracle-database.md §3.2 Cancellation and §5 invariants
-- 11-12 ("effective cancellation" = Event.canceled_at OR
-- Occurrence.canceled_at; new active participation actions on an
-- effectively-canceled occurrence are rejected with custom SQLSTATE
-- 90002; withdraw/downgrade/unrelated updates remain allowed).
--
-- All participation fixtures used by the "still allowed while canceled"
-- assertions are created *before* the event is canceled: the INSERT guard
-- (occurrence_participations_reject_insert_when_canceled) rejects every
-- new participation row - considering or attending - once effectively
-- canceled, so a considering fixture meant to later prove the
-- considering->attending UPDATE guard has to already exist pre-cancellation
-- too.
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

select pg_temp.create_test_user() as owner_id \gset
select pg_temp.create_test_user() as attending_user_id \gset
select pg_temp.create_test_user() as considering_user_id \gset
select pg_temp.create_test_user() as withdrawing_user_id \gset
select pg_temp.create_test_user() as latecomer_id \gset
select pg_temp.create_test_user() as latecomer_attending_id \gset
select pg_temp.create_test_user() as reinstated_user_id \gset

insert into events (owner_id, title, starts_on, ends_on)
values (:'owner_id', 'cancellation fixture', '2026-10-01', '2026-10-01')
returning id as event_id \gset

insert into event_occurrences (event_id, starts_at)
values (:'event_id', '2026-10-01T18:00:00+09:00')
returning id as occurrence_id \gset

-- Pre-cancellation fixtures (all created while the occurrence is still
-- active, so the INSERT guard never blocks fixture setup itself).
insert into occurrence_participations (occurrence_id, user_id, status)
values (:'occurrence_id', :'attending_user_id', 'attending')
returning id as attending_participation_id \gset

insert into occurrence_participations (occurrence_id, user_id, status)
values (:'occurrence_id', :'considering_user_id', 'considering')
returning id as considering_participation_id \gset

insert into occurrence_participations (occurrence_id, user_id, status)
values (:'occurrence_id', :'withdrawing_user_id', 'considering')
returning id as withdrawing_participation_id \gset

-- The event owner cancels the event (events_update_own governs
-- events.canceled_at, same owner-only write boundary as any other column).
call pg_temp.auth_as_user(:'owner_id');
update events set canceled_at = now() where id = :'event_id';

call pg_temp.auth_as_admin();
select ok(
  event_occurrence_is_effectively_canceled(:'occurrence_id'::uuid),
  'occurrence is effectively canceled once its parent event is canceled'
);

-- A brand new participation (a user trying to join for the first time) is
-- rejected outright.
call pg_temp.auth_as_user(:'latecomer_id');
select throws_ok(
  format(
    $$ insert into occurrence_participations (occurrence_id, user_id, status) values (%L, %L, 'considering') $$,
    :'occurrence_id', :'latecomer_id'
  ),
  '90002',
  null,
  'a new participation on an effectively-canceled occurrence is rejected'
);

-- A brand new participation created directly as `attending` (not merely
-- `considering`) is rejected the same way: the INSERT guard rejects every
-- new participation row - considering or attending - once effectively
-- canceled, regardless of which status the new row is created with.
call pg_temp.auth_as_user(:'latecomer_attending_id');
select throws_ok(
  format(
    $$ insert into occurrence_participations (occurrence_id, user_id, status) values (%L, %L, 'attending') $$,
    :'occurrence_id', :'latecomer_attending_id'
  ),
  '90002',
  null,
  'a new attending participation on an effectively-canceled occurrence is rejected'
);

-- The pre-existing considering fixture cannot advance to attending: that
-- is a new active commitment even though the row already existed.
call pg_temp.auth_as_user(:'considering_user_id');
select throws_ok(
  format(
    $$ update occurrence_participations set status = 'attending' where id = %L $$,
    :'considering_participation_id'
  ),
  '90002',
  null,
  'considering -> attending on an effectively-canceled occurrence is rejected'
);

-- The pre-existing attending fixture can still downgrade to considering:
-- this is not a new active commitment, so it is unaffected by cancellation.
call pg_temp.auth_as_user(:'attending_user_id');
with updated as (
  update occurrence_participations set status = 'considering'
    where id = :'attending_participation_id'
  returning id
)
select is((select count(*) from updated), 1::bigint,
  'attending -> considering downgrade is still allowed while canceled');

-- Withdrawal (delete) remains allowed while canceled.
call pg_temp.auth_as_user(:'withdrawing_user_id');
with deleted as (
  delete from occurrence_participations where id = :'withdrawing_participation_id'
  returning id
)
select is((select count(*) from deleted), 1::bigint,
  'withdrawing (deleting) a participation is still allowed while canceled');

-- Un-canceling the Event does not touch any Occurrence-level cancellation
-- flag (there is none set here), so effective cancellation now clears and
-- a brand new participation succeeds again.
call pg_temp.auth_as_user(:'owner_id');
update events set canceled_at = null where id = :'event_id';

call pg_temp.auth_as_user(:'reinstated_user_id');
insert into occurrence_participations (occurrence_id, user_id, status)
values (:'occurrence_id', :'reinstated_user_id', 'considering')
returning id as reinstated_participation_id \gset

call pg_temp.auth_as_admin();
select isnt(:'reinstated_participation_id'::uuid, null::uuid,
  'a new participation succeeds again once the event is un-canceled');

select * from finish();
rollback;
