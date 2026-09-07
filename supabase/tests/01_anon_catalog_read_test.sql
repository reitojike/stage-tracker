-- oracle: docs/v2/oracle-database.md §2 "events" / "event_occurrences" SELECT,
-- and §6 "shared read: authenticated は誰の event/occurrence も読める。anon は
-- ...読めない".
--
-- anon has no grant at all on these tables (table-level `revoke all` in the
-- create-table migrations), so a read attempt raises a permission error
-- (42501) rather than returning zero rows. authenticated can read every
-- row regardless of who owns it - this is a shared catalog, not
-- per-owner-scoped data.
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

select pg_temp.create_test_user() as owner_id \gset
select pg_temp.create_test_user() as reader_id \gset

insert into events (owner_id, title, starts_on, ends_on)
values (:'owner_id', 'catalog read fixture', '2026-03-01', '2026-03-01')
returning id as event_id \gset

insert into event_occurrences (event_id, starts_at)
values (:'event_id', '2026-03-01T18:00:00+09:00')
returning id as occurrence_id \gset

call pg_temp.auth_as_anon();

select throws_ok(
  $$ select 1 from events limit 1 $$,
  '42501',
  null,
  'anon cannot select from events'
);

select throws_ok(
  $$ select 1 from event_occurrences limit 1 $$,
  '42501',
  null,
  'anon cannot select from event_occurrences'
);

-- A different authenticated user (not the owner) can still read the event
-- and its occurrence: the catalog is shared, not owner-scoped.
call pg_temp.auth_as_user(:'reader_id');

select is(
  (select count(*) from events where id = :'event_id'),
  1::bigint,
  'non-owner authenticated user can read another owner''s event (shared catalog)'
);

select is(
  (select count(*) from event_occurrences where id = :'occurrence_id'),
  1::bigint,
  'non-owner authenticated user can read another owner''s occurrence (shared catalog)'
);

select * from finish();
rollback;
