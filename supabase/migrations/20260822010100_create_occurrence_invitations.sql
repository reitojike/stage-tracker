-- Occurrence-level invitation (Issue #30).
--
-- Product semantics (see .ai-dev-foundation/product-rules.md, "Invitation"):
-- - An invitation targets an occurrence, and records "who invited whom to
--   which occurrence" plus "did the invitee decline".
-- - Decline lives on the invitation lifecycle, not on participation: an
--   invitee who declines does NOT get a `not_attending` participation.
-- - product-rules.md asks for a *data boundary* that can answer those two
--   questions later; it does not say who may read the row. In MVP only the
--   invitee can, and the reason is the invite flow rather than the record
--   itself - see the SELECT policy at the bottom of this file.
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
  -- null = not declined. Not directly writable by any client: the invitee
  -- sets it through public.decline_occurrence_invitation, which stamps
  -- now() and never clears it. See the grant comment below.
  declined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint occurrence_invitations_not_self check (inviter_id <> invitee_id),
  -- One invitation per (occurrence, inviter, invitee). This is both the
  -- natural identity of "A invited B to this occurrence" and what keeps
  -- public.invite_to_occurrence idempotent under concurrent calls: a repeat
  -- invite settles on the existing row instead of stacking duplicates, so
  -- re-inviting can never quietly clear an invitee's declined_at.
  constraint occurrence_invitations_occurrence_inviter_invitee_key
    unique (occurrence_id, inviter_id, invitee_id)
);

-- The unique constraint's index leads with occurrence_id, so it serves
-- neither "invitations I sent" nor "invitations I received" - both of which
-- the SELECT policy below evaluates on every read.
create index occurrence_invitations_inviter_id_idx on public.occurrence_invitations (inviter_id);
create index occurrence_invitations_invitee_id_idx on public.occurrence_invitations (invitee_id);

-- Per-table, like every other updated_at trigger function in this schema -
-- see 20260822010000_create_occurrence_participations.sql.
create function public.set_occurrence_invitations_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger occurrence_invitations_set_updated_at
  before update on public.occurrence_invitations
  for each row
  execute function public.set_occurrence_invitations_updated_at();

alter table public.occurrence_invitations enable row level security;

-- See 20260822010000_create_occurrence_participations.sql for why this
-- migration revokes before granting rather than only granting.
revoke all on public.occurrence_invitations from public, anon, authenticated;

grant select, insert, update, delete on public.occurrence_invitations to service_role;

-- SELECT is the entire surface a normal client gets on this table. Every
-- write - including the invitee's own decline - goes through a SECURITY
-- DEFINER function, so no column here is directly writable.
--
-- declined_at could have been exposed as a one-column UPDATE grant, but a
-- grant can only say "the invitee may write this column"; it cannot say
-- what they may write. That would let an invitee stamp an arbitrary
-- timestamp and, more importantly, set declined_at back to null.
-- product-rules.md requires that a decline be recordable; it says nothing
-- about undoing one, and invitation history retention mechanics are
-- explicitly left to be settled by real need. A writable column would
-- settle undo semantics by accident. public.decline_occurrence_invitation
-- is therefore the only write path - see
-- 20260822010300_create_decline_occurrence_invitation_rpc.sql.
grant select on public.occurrence_invitations to authenticated;

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

-- Invitations are not part of the shared catalog, and in MVP not even the
-- inviter can read one back: SELECT is the invitee’s alone.
--
-- Letting the inviter read their own invitations sounds harmless, but it is
-- what would re-open the side channel public.invite_to_occurrence exists to
-- close. That function is deliberately opaque about which of the three
-- product branches it took, because "invitee is already attending" is
-- private participation state (product-rules.md: `private` = 本人のみ) and
-- the already-attending branch is the one that writes no invitation row. An
-- inviter who could list their own invitations would recover exactly that
-- bit from the row’s presence or absence, making the opaque return value
-- cosmetic. Response and record therefore have to be closed together.
--
-- What this gives up is inviter-facing invitation history, which no current
-- product rule asks for. It is not worth weakening a stated privacy
-- boundary to pre-build; when a real need appears it can be served by a
-- projection designed not to leak the branch (Issue #30 PO decision).
--
-- product-rules.md still holds: "誰が誰をどの occurrence へ招待したか" and
-- "invitee が辞退したか" remain answerable from this table - that is a data
-- boundary, and this policy governs read access, not what is recorded.
create policy occurrence_invitations_select_invitee
  on public.occurrence_invitations
  for select
  to authenticated
  using (invitee_id = auth.uid());
