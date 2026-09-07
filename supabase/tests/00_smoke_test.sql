-- Smoke test for the auth-context helper (helpers/auth.psql). Confirms
-- role switching + auth.uid() actually drive real RLS policy outcomes
-- (using events_update_own, an owner-only policy) before other test files
-- rely on the same helper.
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

-- Fixture setup as the session's default role (postgres, superuser -
-- bypasses RLS and grants, same role as the Node suite's service_role
-- admin client).
select pg_temp.create_test_user() as owner_id \gset
select pg_temp.create_test_user() as other_id \gset

insert into events (owner_id, title, starts_on, ends_on)
values (:'owner_id', 'smoke test event', '2026-01-01', '2026-01-05')
returning id as event_id \gset

-- auth.uid() reflects the switched user.
call pg_temp.auth_as_user(:'owner_id');
select is(auth.uid(), :'owner_id'::uuid, 'auth.uid() reflects auth_as_user');

-- owner can update their own event (events_update_own). A data-modifying
-- WITH must be a standalone top-level statement, so this cannot be nested
-- inside select is(...) - the CTE result is selected from afterward instead.
with updated as (
  update events set title = 'updated by owner' where id = :'event_id' returning id
)
select is((select count(*) from updated), 1::bigint,
  'owner update matches the row (events_update_own)');

-- a different authenticated user cannot update someone else's event: the
-- UPDATE matches zero rows rather than erroring (RLS USING filters the
-- target, it does not raise).
call pg_temp.auth_as_user(:'other_id');
with updated as (
  update events set title = 'hijacked' where id = :'event_id' returning id
)
select is((select count(*) from updated), 0::bigint,
  'non-owner update matches no rows (events_update_own)');

-- anon has no SELECT grant on events at all - even reading raises a
-- permission error rather than returning zero rows.
call pg_temp.auth_as_anon();
select throws_ok(
  $$ select 1 from events limit 1 $$,
  '42501',
  null,
  'anon has no select privilege on events'
);

select * from finish();
rollback;
