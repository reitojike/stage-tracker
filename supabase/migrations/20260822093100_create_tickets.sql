-- Individual tickets (Issue #32): the concrete tickets that a *secured*
-- acquisition produced.
--
-- Product semantics (see .ai-dev-foundation/product-rules.md, "Ticket
-- acquisition / Ticket", and Issue #32):
-- - A ticket and an acquisition are separate concepts. One secured
--   acquisition can yield several tickets, so acquisition_id is a plain FK
--   with no uniqueness.
-- - seat / queue / medium live on the ticket, not on the acquisition, and
--   all three are nullable: a ticket exists before its seat or queue
--   number is known. MVP medium vocabulary is paper / electronic only;
--   delivery / issuance method is deliberately not modelled.
-- - Assignment ("who is expected to use this ticket") is NOT ownership.
--   A ticket may be unassigned, assigned to the owner themselves, assigned
--   to another registered user, or assigned to an external companion who
--   has no stage-tracker account at all - representing that companion must
--   never require creating an account, hence the free-text
--   assignee_external_name column alongside the FK.
-- - Assignment is also independent of invitation: nothing here consults
--   invitation state, and assigning a ticket grants the assignee no
--   authority over it (see the policies below - assignment deliberately
--   confers no read or write access).
-- - owner_id is the *current* owner. It starts as the acquisition owner and
--   only ever moves through accept_ticket_transfer (see
--   20260822093400_create_ticket_transfer_rpcs.sql); it is not grantable on
--   UPDATE, so no client can move ownership directly.
-- - acquisition_id is likewise not grantable on UPDATE: provenance back to
--   the source acquisition survives every transfer.
-- - Deletion is out of scope for this slice: no deleted_at, no DELETE
--   policy.

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  acquisition_id uuid not null references public.ticket_acquisitions (id),
  owner_id uuid not null references auth.users (id),
  seat_label text,
  queue_number text,
  medium text check (medium in ('paper', 'electronic')),
  assigned_to_user_id uuid references auth.users (id),
  assignee_external_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A ticket has at most one expected user. Both null means unassigned;
  -- assigning to a registered user and naming an external companion are
  -- mutually exclusive rather than two independent fields that could
  -- disagree about who is going.
  constraint tickets_single_assignee check (
    assigned_to_user_id is null or assignee_external_name is null
  ),
  -- Without this, '' or '   ' would be a third, silent "assigned to nobody
  -- in particular" state distinct from NULL.
  constraint tickets_external_assignee_name_not_blank check (
    assignee_external_name is null or btrim(assignee_external_name) <> ''
  )
);

create index tickets_acquisition_id_idx on public.tickets (acquisition_id);
create index tickets_owner_id_idx on public.tickets (owner_id);
create index tickets_assigned_to_user_id_idx on public.tickets (assigned_to_user_id);

-- See 20260820000000_create_events.sql for why search_path is pinned empty.
create function public.set_tickets_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tickets_set_updated_at
  before update on public.tickets
  for each row
  execute function public.set_tickets_updated_at();

alter table public.tickets enable row level security;

-- Column-level grants are the system-managed-field boundary, and here they
-- are also the ownership boundary: owner_id and acquisition_id are
-- INSERT-only. Ownership therefore cannot be reassigned by a normal client
-- under any RLS outcome, and a ticket cannot be re-pointed at a different
-- acquisition to launder its provenance.
-- The blanket revoke first makes the column-level boundary below exact
-- rather than merely additive. This is load-bearing today, not a guard
-- against some future default-privilege change: on this stack a new public
-- table is created with anon=Dxtm/authenticated=Dxtm, so without this line
-- both roles would keep TRUNCATE - which bypasses RLS entirely - along with
-- REFERENCES/TRIGGER/MAINTAIN. What survives this migration is only what is
-- granted explicitly underneath it. Matches the convention established by
-- 20260822010000_create_occurrence_participations.sql. anon is named here
-- so it is visibly closed, not closed by omission.
revoke all on public.tickets from public, anon, authenticated;

grant select, insert, update, delete on public.tickets to service_role;

grant select on public.tickets to authenticated;
grant insert (
  acquisition_id, owner_id, seat_label, queue_number, medium,
  assigned_to_user_id, assignee_external_name
) on public.tickets to authenticated;
grant update (
  seat_label, queue_number, medium, assigned_to_user_id, assignee_external_name
) on public.tickets to authenticated;

-- Two distinct readers: the current owner, and the owner of the source
-- acquisition. The latter is what keeps provenance observable after a
-- transfer - "acquisition owner は acquisition 自体を引き続き所有し、どの
-- ticket を誰へ transfer したか確認できる data boundary を持ちます".
--
-- ticket_acquisitions' own SELECT policy is owner_id = auth.uid() and does
-- not reference tickets, so this subquery cannot recurse back into this
-- policy.
--
-- Note what is deliberately absent: assigned_to_user_id is not a reader.
-- Assignment records the owner's expectation about who will use the ticket;
-- product-rules.md does not grant the assignee visibility, and widening
-- read access is the dangerous direction to guess at, so this slice does
-- not.
create policy tickets_select_owner_or_source_acquirer
  on public.tickets
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1
      from public.ticket_acquisitions a
      where a.id = acquisition_id
        and a.owner_id = auth.uid()
    )
  );

-- Tickets only come into existence under an acquisition the caller owns and
-- that has actually been secured, and the initial owner is always that same
-- caller. This is where "ticket は secured な acquisition の結果として
-- 表現される" is enforced for normal clients.
create policy tickets_insert_under_own_secured_acquisition
  on public.tickets
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.ticket_acquisitions a
      where a.id = acquisition_id
        and a.owner_id = auth.uid()
        and a.status = 'secured'
    )
  );

-- Edit authority follows current ownership, not the acquisition: after a
-- transfer the recipient edits the ticket and the original acquirer no
-- longer can, even though they still see it via the policy above.
create policy tickets_update_own
  on public.tickets
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
