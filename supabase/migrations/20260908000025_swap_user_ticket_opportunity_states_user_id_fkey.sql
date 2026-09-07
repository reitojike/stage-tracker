-- v2 M4 (Issue #375, In Scope #1 / decisions.md P5). Step 3 of the
-- expand/validate/swap pattern, one file per table - see 20260908000000
-- for the full ON DELETE policy rationale and 20260908000020 for the
-- production lock-safety analysis behind the per-table split and the
-- `lock_timeout` below.
--
-- This is the last of the seven FKs from decisions.md P5's list. After
-- this file, the schema is byte-for-byte equivalent (same constraint
-- names, same ON DELETE actions, same referenced table/column) to what a
-- plain, single-transaction FK recreation would have produced.
--
-- If this statement fails with `55P03 lock not available`: a long-running
-- transaction is currently holding a conflicting lock on
-- public.user_ticket_opportunity_states. No partial state is left behind,
-- so the operator can wait a short while and re-run `supabase db push`;
-- retrying is always safe. The `_pending` constraint from 20260908000005
-- stays in place (redundant but harmless) until this succeeds.
--
-- `post-deploy-safe` per docs/architecture/runtime-stack.md's ordering
-- fence (same reasoning as 20260908000020). Depends on 20260908000010
-- having already validated the pending constraint dropped and renamed
-- here.
set local lock_timeout = '5s';

alter table public.user_ticket_opportunity_states
  drop constraint user_ticket_opportunity_states_user_id_fkey;
alter table public.user_ticket_opportunity_states
  rename constraint user_ticket_opportunity_states_user_id_fkey_pending
    to user_ticket_opportunity_states_user_id_fkey;
