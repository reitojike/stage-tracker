-- oracle: docs/v2/oracle-database.md §7 point 2 and decisions.md "PO 判断:
-- v2 の DB 方針" P5 (Issue #375 In Scope #1). Verifies the ON DELETE policy
-- migration (20260908000000_set_auth_users_fk_on_delete_policy.sql):
-- shared catalog data (events.owner_id) is kept - deleting its owner is
-- refused while the Event still references them - and personal data
-- (personal_schedule_entries / personal_schedule_shares / occurrence_
-- participations / occurrence_invitations / user_ticket_opportunity_states)
-- is deleted alongside the user it belongs to.
--
-- These are structural FK/CASCADE assertions, not RLS assertions: fixtures
-- are created and auth.users rows are deleted directly as the test
-- session's own `postgres` role (superuser, BYPASSRLS), the same way
-- pg_temp.create_test_user() already writes auth.users. auth_as_admin()
-- resets to that role between steps for clarity even though no
-- auth_as_user() switch happens before it in this file.
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

-- --------------------------------------------------------------------
-- 1. events.owner_id: ON DELETE NO ACTION (shared catalog data is kept).
-- --------------------------------------------------------------------
select pg_temp.create_test_user() as event_owner_id \gset

insert into events (owner_id, title, starts_on, ends_on)
values (:'event_owner_id', 'fk fixture: kept event', '2026-11-01', '2026-11-01')
returning id as kept_event_id \gset

select throws_ok(
  format($$ delete from auth.users where id = %L $$, :'event_owner_id'),
  '23503',
  null,
  'deleting an auth.users row that owns an Event is refused (shared catalog data is kept)'
);

select is(
  (select count(*) from events where id = :'kept_event_id'),
  1::bigint,
  'the Event survives the refused delete attempt, unchanged'
);

-- Deleting the Event first removes the FK reference, so the same
-- auth.users row can now be deleted - NO ACTION blocks the delete only
-- while it would orphan an Event, not permanently.
delete from events where id = :'kept_event_id';

with deleted as (
  delete from auth.users where id = :'event_owner_id' returning id
)
select is(
  (select count(*) from deleted),
  1::bigint,
  'once the owned Event is gone, the same auth.users row can be deleted'
);

-- --------------------------------------------------------------------
-- 2. personal_schedule_entries.owner_id: ON DELETE CASCADE (personal data
--    is deleted with its owner).
-- --------------------------------------------------------------------
select pg_temp.create_test_user() as schedule_owner_id \gset

insert into personal_schedule_entries (owner_id, title, is_all_day, starts_on, ends_on, blocking)
values (:'schedule_owner_id', 'fk fixture: schedule entry', true, '2026-11-02', '2026-11-02', true)
returning id as schedule_entry_id \gset

delete from auth.users where id = :'schedule_owner_id';

select is(
  (select count(*) from personal_schedule_entries where id = :'schedule_entry_id'),
  0::bigint,
  'deleting the owner cascades to their personal_schedule_entries row'
);

-- --------------------------------------------------------------------
-- 3. personal_schedule_shares.shared_with_user_id: ON DELETE CASCADE
--    (only the share link is personal to the recipient; the entry itself
--    belongs to its owner and must survive).
-- --------------------------------------------------------------------
select pg_temp.create_test_user() as share_entry_owner_id \gset
select pg_temp.create_test_user() as share_recipient_id \gset

insert into personal_schedule_entries (owner_id, title, is_all_day, starts_on, ends_on, blocking)
values (:'share_entry_owner_id', 'fk fixture: shared entry', true, '2026-11-03', '2026-11-03', false)
returning id as shared_entry_id \gset

insert into personal_schedule_shares (schedule_entry_id, shared_with_user_id)
values (:'shared_entry_id', :'share_recipient_id')
returning id as share_id \gset

delete from auth.users where id = :'share_recipient_id';

select is(
  (select count(*) from personal_schedule_shares where id = :'share_id'),
  0::bigint,
  'deleting the recipient cascades to their personal_schedule_shares row'
);

select is(
  (select count(*) from personal_schedule_entries where id = :'shared_entry_id'),
  1::bigint,
  'the shared entry itself survives - only the recipient link was personal to them'
);

-- --------------------------------------------------------------------
-- 4. occurrence_participations.user_id: ON DELETE CASCADE.
-- --------------------------------------------------------------------
select pg_temp.create_test_user() as occ_owner_id \gset
select pg_temp.create_test_user() as participant_id \gset

insert into events (owner_id, title, starts_on, ends_on)
values (:'occ_owner_id', 'fk fixture: participation event', '2026-11-04', '2026-11-04')
returning id as participation_event_id \gset

insert into event_occurrences (event_id, starts_at)
values (:'participation_event_id', '2026-11-04T18:00:00+09:00')
returning id as participation_occurrence_id \gset

insert into occurrence_participations (occurrence_id, user_id, status)
values (:'participation_occurrence_id', :'participant_id', 'considering')
returning id as participation_id \gset

delete from auth.users where id = :'participant_id';

select is(
  (select count(*) from occurrence_participations where id = :'participation_id'),
  0::bigint,
  'deleting a participant cascades to their occurrence_participations row'
);

-- --------------------------------------------------------------------
-- 5. occurrence_invitations.{inviter_id,invitee_id}: ON DELETE CASCADE on
--    both sides independently.
-- --------------------------------------------------------------------
select pg_temp.create_test_user() as invitation_occ_owner_id \gset
select pg_temp.create_test_user() as inviter_a_id \gset
select pg_temp.create_test_user() as invitee_a_id \gset
select pg_temp.create_test_user() as inviter_b_id \gset
select pg_temp.create_test_user() as invitee_b_id \gset

insert into events (owner_id, title, starts_on, ends_on)
values (:'invitation_occ_owner_id', 'fk fixture: invitation event', '2026-11-05', '2026-11-05')
returning id as invitation_event_id \gset

insert into event_occurrences (event_id, starts_at)
values (:'invitation_event_id', '2026-11-05T18:00:00+09:00')
returning id as invitation_occurrence_id \gset

-- Inserted directly (bypassing invite_to_occurrence's eligibility checks,
-- as the superuser test role): this is a structural FK test, not a
-- behavioral test of the RPC's own invariants.
insert into occurrence_invitations (occurrence_id, inviter_id, invitee_id)
values (:'invitation_occurrence_id', :'inviter_a_id', :'invitee_a_id')
returning id as invitation_a_id \gset

insert into occurrence_invitations (occurrence_id, inviter_id, invitee_id)
values (:'invitation_occurrence_id', :'inviter_b_id', :'invitee_b_id')
returning id as invitation_b_id \gset

-- 5a. Deleting the inviter cascades.
delete from auth.users where id = :'inviter_a_id';

select is(
  (select count(*) from occurrence_invitations where id = :'invitation_a_id'),
  0::bigint,
  'deleting an inviter cascades to the occurrence_invitations row they created'
);

-- 5b. Deleting the invitee (a different invitation, independent of 5a)
-- cascades too.
delete from auth.users where id = :'invitee_b_id';

select is(
  (select count(*) from occurrence_invitations where id = :'invitation_b_id'),
  0::bigint,
  'deleting an invitee cascades to the occurrence_invitations row addressed to them'
);

-- --------------------------------------------------------------------
-- 6. user_ticket_opportunity_states.user_id: ON DELETE CASCADE (the shared
--    ticket_opportunities row itself is untouched - only the personal
--    planning state is removed).
-- --------------------------------------------------------------------
select pg_temp.create_test_user() as ticket_event_owner_id \gset
select pg_temp.create_test_user() as ticket_state_user_id \gset

insert into events (owner_id, title, starts_on, ends_on)
values (:'ticket_event_owner_id', 'fk fixture: ticket opportunity event', '2026-11-06', '2026-11-06')
returning id as ticket_event_id \gset

insert into ticket_opportunities (event_id, target_scope, display_name, source_key)
values (:'ticket_event_id', 'event_wide', 'fk fixture opportunity', 'fk-fixture-opportunity-1')
returning id as ticket_opportunity_id \gset

insert into user_ticket_opportunity_states (user_id, opportunity_id, status)
values (:'ticket_state_user_id', :'ticket_opportunity_id', 'planned')
returning id as ticket_state_id \gset

delete from auth.users where id = :'ticket_state_user_id';

select is(
  (select count(*) from user_ticket_opportunity_states where id = :'ticket_state_id'),
  0::bigint,
  'deleting the user cascades to their user_ticket_opportunity_states row'
);

select is(
  (select count(*) from ticket_opportunities where id = :'ticket_opportunity_id'),
  1::bigint,
  'the shared ticket_opportunities row itself survives - it is not personal data'
);

select * from finish();
rollback;
