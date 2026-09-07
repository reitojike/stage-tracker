-- v2 M4 (Issue #375, In Scope #1 / decisions.md P5). Step 2 of the
-- expand/validate/swap pattern started in 20260908000000 - see that file
-- for the full ON DELETE policy rationale. Step 1 (expand) is split one
-- file per table (20260908000000..000005) and step 3 (swap) likewise
-- (20260908000020..000025); see 20260908000000 for why those two steps
-- needed a per-table split (review finding on PR #378, round 2: ACCESS
-- EXCLUSIVE locks taken earlier in a transaction stay held while that same
-- transaction waits on a later table's lock, so combining multiple tables'
-- ACCESS EXCLUSIVE DDL in one transaction can stall unrelated tables for an
-- unbounded time). This step does not need that split - see below.
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
-- Even though SHARE UPDATE EXCLUSIVE does not block ordinary reads/writes,
-- this file still sets `lock_timeout` (review finding on PR #378, round
-- 2): if a later VALIDATE CONSTRAINT in this same transaction has to wait
-- for a conflicting SHARE UPDATE EXCLUSIVE-or-stronger operation already
-- running against one of the *other* six tables (e.g. a VACUUM, a CREATE
-- INDEX CONCURRENTLY, or an out-of-band VALIDATE CONSTRAINT), it would
-- otherwise wait indefinitely - and because Postgres holds every lock a
-- transaction has acquired until the transaction ends, the SHARE UPDATE
-- EXCLUSIVE locks this transaction already took on the earlier tables
-- would stay held for that entire wait too, blocking maintenance DDL
-- against those earlier tables as collateral damage. This is the same
-- cross-table lock contagion that forced the per-table split for steps 1
-- and 3 (see above), except here it can only ever stall other
-- maintenance DDL, never ordinary application reads/writes, which is why
-- this step does not need that same per-table file split - one bounded
-- wait per table, all in one file, is enough.
--
-- If this statement fails with `55P03 lock not available`: a maintenance
-- operation (VACUUM, CREATE INDEX CONCURRENTLY, or another VALIDATE
-- CONSTRAINT) is currently running against one of the seven tables below.
-- No partial state is left behind - all seven VALIDATE CONSTRAINT calls
-- are in the same transaction, so a timeout on any one of them rolls the
-- whole transaction back - so the operator can wait a short while and
-- re-run `supabase db push`; retrying is always safe.
--
-- `post-deploy-safe` per docs/architecture/runtime-stack.md's ordering
-- fence (same reasoning as 20260908000000). Depends only on
-- 20260908000000..000005 having already been applied (the `_pending`
-- constraints validated here must already exist).
-- Wrapped in an explicit transaction. The Supabase migration runner is not
-- guaranteed to wrap a file's statements in one (20260821000100 wraps for
-- the same reason), and `set local` has no effect outside a transaction
-- block - it would emit a warning and silently leave lock_timeout at its
-- default, removing the bound this file relies on. Wrapping explicitly
-- makes the bound hold regardless of runner behavior.
begin;

set local lock_timeout = '5s';

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

commit;
