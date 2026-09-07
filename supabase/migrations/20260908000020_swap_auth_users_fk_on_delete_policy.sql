-- v2 M4 (Issue #375, In Scope #1 / decisions.md P5). Step 3 of 3 of the
-- expand/validate pattern started in 20260908000000 - see that file for
-- the full ON DELETE policy rationale and the production lock-safety
-- analysis behind splitting this change across three migration files.
--
-- === PRODUCTION LOCK SAFETY ===
--
-- By this point the pending FK (added in 20260908000000) has already been
-- validated against every existing row (20260908000010), so all that
-- remains is a catalog-only swap: drop the old constraint (whose
-- ON DELETE behavior we're replacing) and rename the now-validated pending
-- constraint into its place, so the final constraint name matches what
-- existed before this migration set (`events_owner_id_fkey`,
-- `personal_schedule_entries_owner_id_fkey`, etc. - required so that
-- nothing outside this migration set that might reference these names by
-- text - e.g. `supabase:types:check` / pgTAP tests, see
-- supabase/tests/*.sql and apps/legacy-web/scripts/check-supabase-types-
-- drift.mjs - observes a name change).
--
-- Both DROP CONSTRAINT and RENAME CONSTRAINT take ACCESS EXCLUSIVE on the
-- table, same as any FK add/drop, but neither scans table data (DROP just
-- removes catalog rows and the associated RI triggers; RENAME CONSTRAINT
-- is a pure system-catalog rename), so on production-sized tables each
-- pair here is expected to hold ACCESS EXCLUSIVE only briefly - comparable
-- to any ordinary fast DDL statement, not to the FK-validation scan this
-- three-file split exists to avoid holding ACCESS EXCLUSIVE for.
--
-- All seven swaps are combined into this single migration file/transaction
-- for the same reason validation was combined in 20260908000010: each pair
-- touches a distinct table, and none of these operations block on another
-- table's lock, so the combined transaction's total duration is still
-- bounded by "fast catalog operation x 7", not by any table's row count.
--
-- After this file, the schema is byte-for-byte equivalent (same
-- constraint names, same ON DELETE actions, same referenced
-- table/column) to what a plain, single-transaction FK recreation would
-- have produced - this three-file split only changes *how* production
-- gets there, not the end state.
--
-- `post-deploy-safe` per docs/architecture/runtime-stack.md's ordering
-- fence (same reasoning as the previous two files). Depends on
-- 20260908000010 having already validated the pending constraints dropped
-- and renamed here.
alter table public.events
  drop constraint events_owner_id_fkey;
alter table public.events
  rename constraint events_owner_id_fkey_pending to events_owner_id_fkey;

alter table public.personal_schedule_entries
  drop constraint personal_schedule_entries_owner_id_fkey;
alter table public.personal_schedule_entries
  rename constraint personal_schedule_entries_owner_id_fkey_pending
    to personal_schedule_entries_owner_id_fkey;

alter table public.personal_schedule_shares
  drop constraint personal_schedule_shares_shared_with_user_id_fkey;
alter table public.personal_schedule_shares
  rename constraint personal_schedule_shares_shared_with_user_id_fkey_pending
    to personal_schedule_shares_shared_with_user_id_fkey;

alter table public.occurrence_participations
  drop constraint occurrence_participations_user_id_fkey;
alter table public.occurrence_participations
  rename constraint occurrence_participations_user_id_fkey_pending
    to occurrence_participations_user_id_fkey;

alter table public.occurrence_invitations
  drop constraint occurrence_invitations_inviter_id_fkey;
alter table public.occurrence_invitations
  rename constraint occurrence_invitations_inviter_id_fkey_pending
    to occurrence_invitations_inviter_id_fkey;

alter table public.occurrence_invitations
  drop constraint occurrence_invitations_invitee_id_fkey;
alter table public.occurrence_invitations
  rename constraint occurrence_invitations_invitee_id_fkey_pending
    to occurrence_invitations_invitee_id_fkey;

alter table public.user_ticket_opportunity_states
  drop constraint user_ticket_opportunity_states_user_id_fkey;
alter table public.user_ticket_opportunity_states
  rename constraint user_ticket_opportunity_states_user_id_fkey_pending
    to user_ticket_opportunity_states_user_id_fkey;
