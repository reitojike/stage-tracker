-- v2 M4 (Issue #375, In Scope #1 / decisions.md P5). Step 1 of the
-- expand/validate/swap pattern, one file per table - see 20260908000000
-- for the full ON DELETE policy rationale and the production lock-safety
-- analysis behind the per-table split and the `lock_timeout` below.
--
-- occurrence_participations.user_id -> ON DELETE CASCADE: a participation
-- row has no meaning once its owning user is gone, so removing it
-- alongside the user is exactly "消す" per decisions.md P5.
--
-- If this statement fails with `55P03 lock not available`: a long-running
-- transaction is currently holding a conflicting lock on
-- public.occurrence_participations. No partial state is left behind, so
-- the operator can wait a short while and re-run `supabase db push`;
-- retrying is always safe.
--
-- `post-deploy-safe` per docs/architecture/runtime-stack.md's ordering
-- fence (same reasoning as 20260908000000).
-- Wrapped in an explicit transaction. The Supabase migration runner is not
-- guaranteed to wrap a file's statements in one (20260821000100 wraps for
-- the same reason), and `set local` has no effect outside a transaction
-- block - it would emit a warning and silently leave lock_timeout at its
-- default, removing the bound this file relies on. Wrapping explicitly
-- makes the bound hold regardless of runner behavior.
begin;

set local lock_timeout = '5s';

alter table public.occurrence_participations
  add constraint occurrence_participations_user_id_fkey_pending
    foreign key (user_id) references auth.users (id) on delete cascade
    not valid;

commit;
