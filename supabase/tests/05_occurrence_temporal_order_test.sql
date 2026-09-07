-- oracle: docs/v2/oracle-database.md §1.2 CHECK constraints
-- (event_occurrences_doors_at_le_starts_at,
-- event_occurrences_starts_at_le_ends_at) and §5 invariant 3
-- "doors_at <= starts_at <= ends_at ... 未設定の項は比較対象から除外".
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

select pg_temp.create_test_user() as owner_id \gset

insert into events (owner_id, title, starts_on, ends_on)
values (:'owner_id', 'temporal order fixture', '2026-07-01', '2026-07-01')
returning id as event_id \gset

-- doors_at must be <= starts_at.
select throws_ok(
  format(
    $$ insert into event_occurrences (event_id, starts_at, doors_at) values (%L, '2026-07-01T18:00:00+09:00', '2026-07-01T18:30:00+09:00') $$,
    :'event_id'
  ),
  '23514',
  null,
  'event_occurrences_doors_at_le_starts_at rejects doors_at after starts_at'
);

-- starts_at must be <= ends_at.
select throws_ok(
  format(
    $$ insert into event_occurrences (event_id, starts_at, ends_at) values (%L, '2026-07-01T18:00:00+09:00', '2026-07-01T17:00:00+09:00') $$,
    :'event_id'
  ),
  '23514',
  null,
  'event_occurrences_starts_at_le_ends_at rejects ends_at before starts_at'
);

-- A fully-ordered doors_at <= starts_at <= ends_at row is accepted.
insert into event_occurrences (event_id, starts_at, doors_at, ends_at)
values (:'event_id', '2026-07-01T18:00:00+09:00', '2026-07-01T17:30:00+09:00', '2026-07-01T20:00:00+09:00')
returning id as occurrence_id \gset

select isnt(:'occurrence_id'::uuid, null::uuid, 'fully-ordered doors/starts/ends row is accepted');

-- ends_at left null (unknown end time) is a legitimate state: it is
-- excluded from the comparison rather than treated as an implicit 0.
insert into event_occurrences (event_id, starts_at, doors_at)
values (:'event_id', '2026-07-01T21:00:00+09:00', '2026-07-01T20:30:00+09:00')
returning id as second_occurrence_id \gset

select isnt(:'second_occurrence_id'::uuid, null::uuid,
  'null ends_at is excluded from the temporal-order comparison, not treated as a default');

select * from finish();
rollback;
