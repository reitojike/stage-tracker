-- Occurrence-level invitation (Issue #30).
--
-- Product semantics (see .ai-dev-foundation/product-rules.md, "Invitation"):
-- - An invitation targets an occurrence, and records "who invited whom to
--   which occurrence" plus "did the invitee decline".
-- - Decline lives on the invitation lifecycle, not on participation: an
--   invitee who declines does NOT get a `not_attending` participation.
--
-- Why `declined_at timestamptz` and not a status enum: the only lifecycle
-- fact product-rules.md requires is whether the invitee declined. A
-- pending/accepted/declined enum would invent an approval flow and a third
-- product status that nothing has approved - explicitly ruled out by
-- "先行実装しないもの" (no invite approval states). Acceptance already has a
-- representation that cannot drift out of sync with reality: the invitee's
-- own participation reaching `attending`, which only the invitee can do.
--
-- Out of scope for this slice, consistent with events/event_occurrences: no
-- deletion/withdrawal of an invitation (no DELETE grant, no DELETE policy),
-- and no history/audit table.

create table public.occurrence_invitations (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.event_occurrences (id),
  inviter_id uuid not null references auth.users (id),
  invitee_id uuid not null references auth.users (id),
  -- null = not declined. Set by the invitee only (see the UPDATE policy and
  -- the single-column UPDATE grant below).
  declined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint occurrence_invitations_not_self check (inviter_id <> invitee_id),
  -- One invitation per (occurrence, inviter, invitee). This is both the
  -- natural identity of "A invited B to this occurrence" and what keeps
  -- public.invite_to_occurrence idempotent under concurrent calls: a repeat
  -- invite resolves to the existing row instead of stacking duplicates, so
  -- re-inviting can never quietly clear an invitee's declined_at.
  constraint occurrence_invitations_occurrence_inviter_invitee_key
    unique (occurrence_id, inviter_id, invitee_id)
);

-- The unique constraint's index leads with occurrence_id, so it serves
-- neither "invitations I sent" nor "invitations I received" - both of which
-- the SELECT policy below evaluates on every read.
create index occurrence_invitations_inviter_id_idx on public.occurrence_invitations (inviter_id);
create index occurrence_invitations_invitee_id_idx on public.occurrence_invitations (invitee_id);

create trigger occurrence_invitations_set_updated_at
  before update on public.occurrence_invitations
  for each row
  execute function public.set_updated_at();

alter table public.occurrence_invitations enable row level security;

-- See 20260822010000_create_occurrence_participations.sql for why this
-- migration revokes before granting rather than only granting.
revoke all on public.occurrence_invitations from public, anon, authenticated;

grant select, insert, update, delete on public.occurrence_invitations to service_role;

grant select on public.occurrence_invitations to authenticated;
-- declined_at is the only column a normal client may ever write, and only
-- the invitee may write it (occurrence_invitations_update_decline_own).
-- inviter_id/invitee_id/occurrence_id have no UPDATE grant, so an existing
-- invitation cannot be retargeted at a different occurrence or person.
grant update (declined_at) on public.occurrence_invitations to authenticated;

-- Deliberately no INSERT grant and no INSERT policy. Direct INSERT cannot
-- enforce the two things an invitation depends on - that the inviter is
-- `attending` this occurrence, and the invitee-participation branch in
-- product-rules.md - so public.invite_to_occurrence is the only supported
-- create path (see the next migration). Unlike events_insert_own, which was
-- left in place as a second layer when direct INSERT on events was revoked,
-- there is no policy here at all: with neither a grant nor a policy, a
-- later grant alone would still not open this path.
--
-- Deliberately no DELETE grant and no DELETE policy either: withdrawing an
-- invitation is not a decided product operation, and product-rules.md
-- leaves invitation history retention mechanics to be settled by real need
-- rather than pre-built here.

-- Invitations are not part of the shared catalog: only the two parties can
-- read one. A third authenticated user learning that A invited B would be a
-- privacy leak that no product rule asks for, and participation visibility
-- already defaults to private.
create policy occurrence_invitations_select_party
  on public.occurrence_invitations
  for select
  to authenticated
  using (inviter_id = auth.uid() or invitee_id = auth.uid());

-- Declining is the invitee's own act. USING excludes the inviter's rows
-- entirely, so an inviter cannot mark their own invitation as declined on
-- the invitee's behalf, nor undo a decline; WITH CHECK is symmetric
-- defense-in-depth. The invitee may also clear declined_at again - this is
-- their own lifecycle state, and making it one-way would be an
-- unrequested retention rule rather than a protected invariant.
create policy occurrence_invitations_update_decline_own
  on public.occurrence_invitations
  for update
  to authenticated
  using (invitee_id = auth.uid())
  with check (invitee_id = auth.uid());
