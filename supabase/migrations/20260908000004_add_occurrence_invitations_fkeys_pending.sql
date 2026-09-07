-- v2 M4 (Issue #375, In Scope #1 / decisions.md P5). Step 1 of the
-- expand/validate/swap pattern, one file per table - see 20260908000000
-- for the full ON DELETE policy rationale and the production lock-safety
-- analysis behind the per-table split and the `lock_timeout` below.
--
-- occurrence_invitations has two FKs to auth.users (inviter_id and
-- invitee_id), both -> ON DELETE CASCADE: a pending invitation has no
-- meaning once either party is gone, so removing it alongside either user
-- is exactly "消す" per decisions.md P5. Both ADD CONSTRAINTs are combined
-- into this single file/transaction because they target the *same* table:
-- extending how long this transaction holds occurrence_invitations'
-- ACCESS EXCLUSIVE lock does not put any other table's lock at risk (the
-- lock-safety problem this per-table split fixes is specifically about one
-- transaction spanning *multiple different* tables, not about the number
-- of statements against a single table).
--
-- If this statement fails with `55P03 lock not available`: a long-running
-- transaction is currently holding a conflicting lock on
-- public.occurrence_invitations. No partial state is left behind, so the
-- operator can wait a short while and re-run `supabase db push`;
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

alter table public.occurrence_invitations
  add constraint occurrence_invitations_inviter_id_fkey_pending
    foreign key (inviter_id) references auth.users (id) on delete cascade
    not valid;

alter table public.occurrence_invitations
  add constraint occurrence_invitations_invitee_id_fkey_pending
    foreign key (invitee_id) references auth.users (id) on delete cascade
    not valid;

commit;
