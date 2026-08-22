-- Ticket transfer ledger (Issue #32).
--
-- Product semantics (see .ai-dev-foundation/product-rules.md, "Ticket
-- transfer", and Issue #32):
-- - The current ticket owner explicitly starts a transfer; the recipient
--   must accept it; before acceptance the sender may cancel it.
-- - On acceptance the ticket's current owner and edit authority move to the
--   recipient, and the sender cannot unilaterally take it back.
-- - Rows here are never deleted or rewritten into a different shape: this
--   table *is* the durable "who transferred which ticket to whom" record
--   that keeps transfer provenance observable to the original acquirer.
-- - Transfers say nothing about participation. Nothing in this migration or
--   in the RPCs built on it reads or writes participation state.
--
-- Every state change goes through the SECURITY DEFINER RPCs in
-- 20260822093400_create_ticket_transfer_rpcs.sql. authenticated gets SELECT
-- and nothing else here - no INSERT/UPDATE/DELETE grant and no
-- corresponding policy - so a client cannot fabricate a transfer, flip one
-- to 'accepted', or reopen a settled one, whatever the RPCs do.

create table public.ticket_transfers (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id),
  sender_id uuid not null references auth.users (id),
  recipient_id uuid not null references auth.users (id),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'cancelled')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A transfer to yourself is not a transfer, and would let a ticket be
  -- "accepted" by its own owner.
  constraint ticket_transfers_distinct_parties check (sender_id <> recipient_id),
  -- Keeps the settled/unsettled distinction from drifting away from the
  -- timestamp that records when it settled.
  constraint ticket_transfers_responded_at_matches_status check (
    (status = 'pending' and responded_at is null)
    or (status <> 'pending' and responded_at is not null)
  )
);

create index ticket_transfers_ticket_id_idx on public.ticket_transfers (ticket_id);
create index ticket_transfers_sender_id_idx on public.ticket_transfers (sender_id);
create index ticket_transfers_recipient_id_idx on public.ticket_transfers (recipient_id);

-- The structural guarantee that a ticket can never have two live offers
-- outstanding, and therefore can never be accepted twice into two different
-- owners. accept_ticket_transfer also re-checks status under a row lock,
-- but this index is what holds even if two requests are created by
-- concurrent transactions that never see each other's uncommitted row.
create unique index ticket_transfers_one_pending_per_ticket_idx
  on public.ticket_transfers (ticket_id)
  where status = 'pending';

-- See 20260820000000_create_events.sql for why search_path is pinned empty.
create function public.set_ticket_transfers_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger ticket_transfers_set_updated_at
  before update on public.ticket_transfers
  for each row
  execute function public.set_ticket_transfers_updated_at();

alter table public.ticket_transfers enable row level security;

-- The blanket revoke first makes the column-level boundary below exact
-- rather than merely additive. This is load-bearing today, not a guard
-- against some future default-privilege change: on this stack a new public
-- table is created with anon=Dxtm/authenticated=Dxtm, so without this line
-- both roles would keep TRUNCATE - which bypasses RLS entirely - along with
-- REFERENCES/TRIGGER/MAINTAIN. What survives this migration is only what is
-- granted explicitly underneath it. Matches the convention established by
-- 20260822010000_create_occurrence_participations.sql. anon is named here
-- so it is visibly closed, not closed by omission.
revoke all on public.ticket_transfers from public, anon, authenticated;

grant select, insert, update, delete on public.ticket_transfers to service_role;
grant select on public.ticket_transfers to authenticated;

-- Answers "may this user see this ticket's transfer history?" for the
-- policy below: the ticket's current owner, or the owner of the acquisition
-- the ticket came from.
--
-- This is SECURITY DEFINER specifically so the lookup does not re-enter
-- tickets' RLS. tickets has a policy that reads ticket_transfers (added
-- below), so a policy on ticket_transfers that read tickets under RLS would
-- form a mutual-recursion cycle between the two. Running as the definer
-- (the table owner, which bypasses RLS) breaks that cycle by construction
-- rather than by relying on Postgres to stop expanding it.
--
-- The subject is always the caller. An earlier revision took the user id as
-- a parameter, which - because this is SECURITY DEFINER and authenticated
-- needs EXECUTE for the policy to work - let any client holding a ticket
-- uuid ask "does user X own, or did X acquire, ticket T?" about an
-- arbitrary X. A cancelled transfer's former recipient keeps such a uuid,
-- so that was reachable, and it is the same leak class this slice
-- deliberately closes for
-- public.ticket_transfer_recipient_is_eligible. Reading auth.uid() inside
-- the body removes the parameter that made it an oracle: a caller can now
-- only ask about themselves, which is what the SELECT policies already tell
-- them. auth.uid() reads a session GUC, so SECURITY DEFINER does not change
-- what it returns.
create function public.can_view_ticket_provenance(
  p_ticket_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tickets t
    join public.ticket_acquisitions a on a.id = t.acquisition_id
    where t.id = p_ticket_id
      and (t.owner_id = auth.uid() or a.owner_id = auth.uid())
  );
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation, and
-- every role (including anon) is implicitly a PUBLIC member, so revoke
-- before granting. RLS policy expressions are evaluated as the calling
-- role, so authenticated genuinely needs EXECUTE for the policy below to
-- work at all.
revoke execute on function public.can_view_ticket_provenance(uuid) from public;
grant execute on function public.can_view_ticket_provenance(uuid) to authenticated;

create policy ticket_transfers_select_involved
  on public.ticket_transfers
  for select
  to authenticated
  using (
    sender_id = auth.uid()
    or recipient_id = auth.uid()
    or public.can_view_ticket_provenance(ticket_id)
  );

-- A pending recipient can read the ticket they are being offered. This is a
-- second permissive SELECT policy on tickets rather than an edit of
-- tickets_select_owner_or_source_acquirer: permissive policies for the same
-- command are OR'd, so adding one here keeps the ticket-side rule in the
-- tickets migration and the transfer-side rule with the transfers it
-- depends on.
--
-- This is not a silent widening of ticket privacy: it is scoped to a ticket
-- whose owner has explicitly offered it to this exact user, and it lapses
-- the moment the transfer stops being pending. Accepting a ticket you are
-- structurally unable to look at would make the required acceptance step
-- meaningless.
--
-- No recursion: ticket_transfers' own policy above resolves the ticket side
-- through the SECURITY DEFINER function, which does not re-enter RLS.
create policy tickets_select_pending_transfer_recipient
  on public.tickets
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.ticket_transfers tr
      where tr.ticket_id = tickets.id
        and tr.recipient_id = auth.uid()
        and tr.status = 'pending'
    )
  );
