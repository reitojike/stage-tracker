-- oracle: docs/v2/oracle-database.md §7 point 8 (A14, Issue #375 In Scope
-- #3). Verifies the index consolidation migration
-- (20260908000100_consolidate_event_occurrences_event_id_index.sql): the
-- redundant plain btree(event_id) index is gone, the composite unique
-- index backing event_occurrences_event_id_starts_at_key remains, and an
-- event_id-only lookup still returns the right rows (functional behavior is
-- unchanged even though the specific index serving it changed).
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

select hasnt_index(
  'public', 'event_occurrences', 'event_occurrences_event_id_idx',
  'the redundant plain event_id index has been dropped'
);

select has_index(
  'public', 'event_occurrences', 'event_occurrences_event_id_starts_at_key',
  'the (event_id, starts_at) unique constraint index remains and now alone serves event_id-only lookups'
);

select pg_temp.create_test_user() as owner_id \gset

insert into events (owner_id, title, starts_on, ends_on)
values (:'owner_id', 'index consolidation fixture', '2026-11-07', '2026-11-08')
returning id as event_id \gset

insert into event_occurrences (event_id, starts_at)
values (:'event_id', '2026-11-07T18:00:00+09:00');

insert into event_occurrences (event_id, starts_at)
values (:'event_id', '2026-11-08T18:00:00+09:00');

select is(
  (select count(*) from event_occurrences where event_id = :'event_id'),
  2::bigint,
  'an event_id-only lookup still returns all of its occurrences after the index consolidation'
);

select * from finish();
rollback;
