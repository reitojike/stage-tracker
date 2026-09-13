-- Invitation is a pending-only coordination record. Since
-- 20260830000000_simplify_invitation_pending_only.sql, declining an
-- invitation deletes the row and no current write path populates
-- declined_at. The legacy runtime that still exposed the column was removed
-- before this contract migration, so the dead schema shape can now be
-- removed without an application-runtime change.

alter table public.occurrence_invitations
  drop column declined_at;
