-- v2 M4 (Issue #375, In Scope #1 / decisions.md P5). Step 2 of 3 of the
-- expand/validate pattern started in 20260908000000 - see that file for
-- the full ON DELETE policy rationale and the production lock-safety
-- analysis behind splitting this change across three migration files.
--
-- === PRODUCTION LOCK SAFETY ===
--
-- VALIDATE CONSTRAINT scans existing rows to confirm they already satisfy
-- the (already-enforced-for-new-writes) pending FK added in the previous
-- migration file, but it only needs SHARE UPDATE EXCLUSIVE on the target
-- table to do so - not ACCESS EXCLUSIVE. SHARE UPDATE EXCLUSIVE does not
-- block ordinary reads or writes (SELECT/INSERT/UPDATE/DELETE); it only
-- conflicts with other SHARE UPDATE EXCLUSIVE-or-stronger operations (e.g.
-- another VALIDATE CONSTRAINT, CREATE INDEX CONCURRENTLY, VACUUM FULL) on
-- the same table, none of which legacy or v2 run against these tables in
-- normal operation.
--
-- Confirmed locally: with the ADD CONSTRAINT ... NOT VALID and VALIDATE
-- CONSTRAINT calls split into separate transactions (as they are here,
-- being separate migration files), a concurrent SELECT and a concurrent
-- INSERT against the table both completed in milliseconds while VALIDATE
-- CONSTRAINT was in flight, in contrast to the same statements timing out
-- against a 2s statement_timeout when VALIDATE ran inside the same
-- transaction as the preceding ADD CONSTRAINT.
--
-- All seven VALIDATE CONSTRAINT calls below are combined into this single
-- migration file/transaction. This is safe: each call takes its own SHARE
-- UPDATE EXCLUSIVE lock scoped to its own table (the events, personal
-- schedule, participation, invitation, and ticket-opportunity-state tables
-- are all distinct tables), so combining them does not compound the lock
-- held against any single table, and none of these locks block ordinary
-- reads/writes on any of the tables involved while the whole transaction
-- runs.
--
-- This scan reads every existing row of the referencing table exactly
-- once (the same rows a plain FK recreation would have scanned), so total
-- validation time here scales with current production row counts - this
-- is the actual "long-running" part of the change, deliberately isolated
-- to this file so it never coincides with an ACCESS EXCLUSIVE lock.
--
-- `post-deploy-safe` per docs/architecture/runtime-stack.md's ordering
-- fence (same reasoning as 20260908000000). No dependency on any migration
-- other than 20260908000000 having already been applied (the `_pending`
-- constraints validated here must already exist).
alter table public.events
  validate constraint events_owner_id_fkey_pending;

alter table public.personal_schedule_entries
  validate constraint personal_schedule_entries_owner_id_fkey_pending;

alter table public.personal_schedule_shares
  validate constraint personal_schedule_shares_shared_with_user_id_fkey_pending;

alter table public.occurrence_participations
  validate constraint occurrence_participations_user_id_fkey_pending;

alter table public.occurrence_invitations
  validate constraint occurrence_invitations_inviter_id_fkey_pending;

alter table public.occurrence_invitations
  validate constraint occurrence_invitations_invitee_id_fkey_pending;

alter table public.user_ticket_opportunity_states
  validate constraint user_ticket_opportunity_states_user_id_fkey_pending;
