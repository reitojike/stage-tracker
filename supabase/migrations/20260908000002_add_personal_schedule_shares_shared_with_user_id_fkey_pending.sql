-- v2 M4 (Issue #375, In Scope #1 / decisions.md P5). Step 1 of the
-- expand/validate/swap pattern, one file per table - see 20260908000000
-- for the full ON DELETE policy rationale and the production lock-safety
-- analysis behind the per-table split and the `lock_timeout` below.
--
-- personal_schedule_shares.shared_with_user_id -> ON DELETE CASCADE: a
-- share link is personal to its recipient, so removing it alongside the
-- recipient is exactly "消す" per decisions.md P5. The shared entry itself
-- (owned by a different user) is unaffected by this FK.
--
-- If this statement fails with `55P03 lock not available`: a long-running
-- transaction is currently holding a conflicting lock on
-- public.personal_schedule_shares. No partial state is left behind, so the
-- operator can wait a short while and re-run `supabase db push` (or
-- re-apply this file directly via psql); retrying is always safe.
--
-- `post-deploy-safe` per docs/architecture/runtime-stack.md's ordering
-- fence (same reasoning as 20260908000000).
set local lock_timeout = '5s';

alter table public.personal_schedule_shares
  add constraint personal_schedule_shares_shared_with_user_id_fkey_pending
    foreign key (shared_with_user_id) references auth.users (id) on delete cascade
    not valid;
