-- Issue #387 post-cutover contract cleanup: a pending Invitation has no
-- declined lifecycle state. Decline is represented by row absence, not by a
-- timestamp on a retained row.
begin;
create extension if not exists pgtap with schema extensions;

select plan(1);

select hasnt_column(
  'public',
  'occurrence_invitations',
  'declined_at',
  'pending-only invitations do not retain the legacy declined_at column'
);

select * from finish();
rollback;
