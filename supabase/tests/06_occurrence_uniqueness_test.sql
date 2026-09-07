-- oracle: docs/v2/oracle-database.md §1.2 UK
-- event_occurrences_event_id_starts_at_key and §5 invariant 2 "同一event内で
-- occurrenceは開始instant(starts_at)によって一意に識別される".
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

select pg_temp.create_test_user() as owner_id \gset

insert into events (owner_id, title, starts_on, ends_on)
values (:'owner_id', 'uniqueness fixture A', '2026-08-01', '2026-08-05')
returning id as event_a_id \gset

insert into events (owner_id, title, starts_on, ends_on)
values (:'owner_id', 'uniqueness fixture B', '2026-08-01', '2026-08-05')
returning id as event_b_id \gset

insert into event_occurrences (event_id, starts_at)
values (:'event_a_id', '2026-08-02T18:00:00+09:00');

-- A second occurrence in the *same* event at the *same* instant is
-- rejected.
select throws_ok(
  format(
    $$ insert into event_occurrences (event_id, starts_at) values (%L, '2026-08-02T18:00:00+09:00') $$,
    :'event_a_id'
  ),
  '23505',
  null,
  'a duplicate starts_at within the same event is rejected'
);

-- A different instant in the same event is fine.
insert into event_occurrences (event_id, starts_at)
values (:'event_a_id', '2026-08-03T18:00:00+09:00');

select is(
  (select count(*) from event_occurrences where event_id = :'event_a_id'),
  2::bigint,
  'a different starts_at within the same event is accepted'
);

-- The same instant in a *different* event is fine: uniqueness is scoped
-- per event, not global.
insert into event_occurrences (event_id, starts_at)
values (:'event_b_id', '2026-08-02T18:00:00+09:00');

select is(
  (select count(*) from event_occurrences where event_id = :'event_b_id'),
  1::bigint,
  'the same starts_at in a different event is accepted (uniqueness is per-event)'
);

select * from finish();
rollback;
