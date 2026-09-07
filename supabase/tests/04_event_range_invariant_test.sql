-- oracle: docs/v2/oracle-database.md §5 invariants 1, 4, 5
-- (events_starts_on_le_ends_on CHECK; the two DEFERRABLE constraint
-- triggers event_occurrences_within_event_range /
-- events_range_contains_occurrences).
--
-- Runs fixture setup and assertions as the admin role: this invariant is
-- enforced unconditionally at the DB level for every writer (it is a data
-- integrity rule, not an RLS/ownership rule - see 02_/03_ for the
-- ownership-boundary tests).
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

select pg_temp.create_test_user() as owner_id \gset

-- 1. Event range itself: starts_on must be <= ends_on.
select throws_ok(
  format(
    $$ insert into events (owner_id, title, starts_on, ends_on) values (%L, 'inverted range', '2026-06-10', '2026-06-01') $$,
    :'owner_id'
  ),
  '23514',
  null,
  'events_starts_on_le_ends_on rejects starts_on > ends_on'
);

insert into events (owner_id, title, starts_on, ends_on)
values (:'owner_id', 'range containment fixture', '2026-06-01', '2026-06-10')
returning id as event_id \gset

-- 2. An occurrence dated outside the event's [starts_on, ends_on] range is
--    rejected (event_occurrences_within_event_range), whether the date is
--    before the range...
select throws_ok(
  format(
    $$ insert into event_occurrences (event_id, starts_at) values (%L, '2026-05-31T18:00:00+09:00') $$,
    :'event_id'
  ),
  '23514',
  null,
  'occurrence before the event''s Event range is rejected'
);

-- ...or after it.
select throws_ok(
  format(
    $$ insert into event_occurrences (event_id, starts_at) values (%L, '2026-06-11T18:00:00+09:00') $$,
    :'event_id'
  ),
  '23514',
  null,
  'occurrence after the event''s Event range is rejected'
);

-- 3. An occurrence inside the range is accepted.
insert into event_occurrences (event_id, starts_at)
values (:'event_id', '2026-06-05T18:00:00+09:00');

select is(
  (select count(*) from event_occurrences where event_id = :'event_id'),
  1::bigint,
  'occurrence inside the Event range is accepted'
);

-- 4. Narrowing the Event range so it would exclude an existing occurrence
--    is rejected (events_range_contains_occurrences), even though
--    starts_on <= ends_on still holds for the new range on its own.
select throws_ok(
  format(
    $$ update events set starts_on = '2026-06-06', ends_on = '2026-06-10' where id = %L $$,
    :'event_id'
  ),
  '23514',
  null,
  'narrowing the Event range to exclude an existing occurrence is rejected'
);

select * from finish();
rollback;
