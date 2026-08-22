-- Ticket transfer operations (Issue #32).
--
-- These three functions are the only way a normal client can write to
-- public.ticket_transfers or move public.tickets.owner_id: authenticated has
-- no INSERT/UPDATE grant on ticket_transfers at all, and no UPDATE grant on
-- tickets.owner_id. So the ownership transition cannot be assembled
-- client-side out of separate requests, and cannot be half-applied.
--
-- The dangerous part of this slice is concurrency around acceptance, so the
-- locking discipline is deliberate and shared:
--
--   * Every function that decides based on ticket ownership takes the
--     ticket row with SELECT ... FOR UPDATE *first*, then the transfer row.
--     One fixed order across all of them means concurrent transfer
--     operations on the same ticket serialize rather than deadlock.
--   * Every field a decision depends on is re-read after the locks are
--     held. Nothing decides on a value read before locking.
--   * ticket_transfers_one_pending_per_ticket_idx is the structural backstop
--     underneath all of it: even a request that never observes a competing
--     uncommitted row cannot produce a second live offer for one ticket.

create function public.request_ticket_transfer(
  p_ticket_id uuid,
  p_recipient_id uuid
) returns public.ticket_transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_ticket public.tickets;
  v_occurrence_id uuid;
  v_transfer public.ticket_transfers;
begin
  -- Defense-in-depth: EXECUTE is restricted to authenticated below, so this
  -- should be unreachable, but every check underneath compares against
  -- v_actor and must never compare against null.
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select * into v_ticket from public.tickets t where t.id = p_ticket_id for update;
  if not found then
    raise exception 'ticket not found';
  end if;

  -- Read *after* the lock: a transfer accepted a moment ago has already
  -- moved owner_id, and this caller is no longer entitled to offer it.
  if v_ticket.owner_id <> v_actor then
    raise exception 'only the current ticket owner can start a transfer';
  end if;

  if p_recipient_id = v_actor then
    raise exception 'a ticket cannot be transferred to its current owner';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_recipient_id) then
    raise exception 'transfer recipient is not a registered user';
  end if;

  -- Occurrence scope comes from the ticket's source acquisition - the
  -- ticket itself is not occurrence-linked, the acquisition is.
  select a.occurrence_id into v_occurrence_id
  from public.ticket_acquisitions a
  where a.id = v_ticket.acquisition_id;

  -- The Issue #30 integration seam. See
  -- 20260822093300_create_ticket_transfer_eligibility.sql - this currently
  -- fails closed, which is why no transfer can be requested yet.
  if not public.ticket_transfer_recipient_is_eligible(v_occurrence_id, p_recipient_id) then
    raise exception 'transfer recipient is not eligible for this occurrence';
  end if;

  -- Race-safe because the ticket row is already locked above; the partial
  -- unique index would also reject this, but a plain unique violation is a
  -- poor answer to "there is already an offer outstanding".
  if exists (
    select 1 from public.ticket_transfers tr
    where tr.ticket_id = p_ticket_id and tr.status = 'pending'
  ) then
    raise exception 'this ticket already has a pending transfer';
  end if;

  insert into public.ticket_transfers (ticket_id, sender_id, recipient_id)
  values (p_ticket_id, v_actor, p_recipient_id)
  returning * into v_transfer;

  return v_transfer;
end;
$$;

create function public.accept_ticket_transfer(
  p_transfer_id uuid
) returns public.ticket_transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_ticket_id uuid;
  v_ticket public.tickets;
  v_transfer public.ticket_transfers;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  -- Unlocked read purely to find which ticket to lock, so that the ticket
  -- lock is still taken before the transfer lock (see the header comment).
  -- Nothing is decided from this read.
  select tr.ticket_id into v_ticket_id
  from public.ticket_transfers tr
  where tr.id = p_transfer_id;
  if not found then
    raise exception 'transfer not found';
  end if;

  select * into v_ticket from public.tickets t where t.id = v_ticket_id for update;
  -- ticket_transfers.ticket_id is a NOT NULL FK, so this should be
  -- unreachable; without it a missing ticket would leave v_ticket null and
  -- every comparison below would evaluate to null rather than false, i.e.
  -- silently pass.
  if not found then
    raise exception 'ticket not found';
  end if;

  select * into v_transfer
  from public.ticket_transfers tr
  where tr.id = p_transfer_id
  for update;
  -- Symmetric with the ticket lookup above, and for the same reason: the
  -- unlocked read that found this id ran before either lock was held.
  -- Without this guard a vanished row would leave v_transfer null, every
  -- comparison below would evaluate to null rather than false, and control
  -- would reach the ownership update with a null recipient.
  if not found then
    raise exception 'transfer not found';
  end if;

  if v_transfer.recipient_id <> v_actor then
    raise exception 'only the transfer recipient can accept this transfer';
  end if;

  -- The second of two concurrent accepts of the same transfer lands here:
  -- it blocked on the locks above, and by the time it gets them the status
  -- is no longer 'pending'. This is also what makes a cancelled transfer
  -- unacceptable, and a settled one un-re-acceptable.
  if v_transfer.status <> 'pending' then
    raise exception 'transfer is no longer pending';
  end if;

  -- A stale offer from someone who has since lost the ticket must not move
  -- ownership. The partial unique index makes this hard to reach, so treat
  -- it as the invariant check it is rather than an expected path.
  if v_ticket.owner_id <> v_transfer.sender_id then
    raise exception 'transfer sender no longer owns this ticket';
  end if;

  -- Ownership and edit authority move together: owner_id is what
  -- tickets_update_own gates on.
  --
  -- Assignment is cleared rather than inherited: it records the *previous*
  -- owner's expectation of who would use the ticket, and the new owner
  -- re-decides it.
  --
  -- This clearing is the *second* half of the assignment-privacy boundary,
  -- not the whole of it, and removing either half re-opens the leak. PO
  -- decision on Issue #32: a pending recipient is not shown the previous
  -- owner's assignment - neither assigned_to_user_id nor
  -- assignee_external_name - before they accept.
  --
  -- The first half lives in 20260822093200_create_ticket_transfers.sql: a
  -- pending recipient has no SELECT policy on public.tickets at all, and
  -- sees only public.pending_ticket_transfer_offer's projection, which
  -- withholds both columns. Clearing here is what stops the assignment from
  -- surviving into the row once the recipient *does* gain access to it as
  -- the new owner.
  --
  -- So: do not re-add a recipient-facing SELECT policy on tickets, and do
  -- not drop this clearing. Either one alone would expose the previous
  -- holder's named external companion, who never agreed to be disclosed.
  update public.tickets
  set owner_id = v_transfer.recipient_id,
      assigned_to_user_id = null,
      assignee_external_name = null
  where id = v_ticket_id;

  update public.ticket_transfers
  set status = 'accepted',
      responded_at = now()
  where id = p_transfer_id
  returning * into v_transfer;

  -- Note what is absent: nothing here touches participation. A transfer
  -- never changes anyone's participation status.
  return v_transfer;
end;
$$;

create function public.cancel_ticket_transfer(
  p_transfer_id uuid
) returns public.ticket_transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_transfer public.ticket_transfers;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  -- Cancellation does not touch the ticket row, so it takes only the
  -- transfer lock. Holding a single lock cannot complete a cycle with
  -- accept's ticket-then-transfer order, so the two cannot deadlock: one of
  -- them simply settles the row first and the other finds it no longer
  -- pending.
  select * into v_transfer
  from public.ticket_transfers tr
  where tr.id = p_transfer_id
  for update;
  if not found then
    raise exception 'transfer not found';
  end if;

  if v_transfer.sender_id <> v_actor then
    raise exception 'only the transfer sender can cancel this transfer';
  end if;

  -- This is the whole "accept 後、sender が一方的に ticket を取り戻すことは
  -- できません" rule: once the recipient has accepted, the transfer is no
  -- longer pending and there is no path back through this function. There is
  -- deliberately no reclaim/undo operation anywhere in this slice.
  if v_transfer.status <> 'pending' then
    raise exception 'transfer is no longer pending';
  end if;

  update public.ticket_transfers
  set status = 'cancelled',
      responded_at = now()
  where id = p_transfer_id
  returning * into v_transfer;

  return v_transfer;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation; every
-- role (including anon) is implicitly a member of PUBLIC, so this must be
-- revoked explicitly before granting only to authenticated.
revoke execute on function public.request_ticket_transfer(uuid, uuid) from public;
grant execute on function public.request_ticket_transfer(uuid, uuid) to authenticated;

revoke execute on function public.accept_ticket_transfer(uuid) from public;
grant execute on function public.accept_ticket_transfer(uuid) to authenticated;

revoke execute on function public.cancel_ticket_transfer(uuid) from public;
grant execute on function public.cancel_ticket_transfer(uuid) to authenticated;
