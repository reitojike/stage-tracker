-- Remove the legacy acquired-ticket inventory/transfer model (Issue #234).
--
-- TicketOpportunity and UserTicketOpportunityState are a separate, current
-- planning model and remain in the schema. This migration only removes the
-- acquired-ticket model that is no longer part of the product surface.

-- The Event hard-delete RPCs are still a live capability. Replace their
-- bodies before removing the legacy tables so the function dependency graph
-- remains valid throughout the forward migration. CREATE OR REPLACE keeps
-- the existing signatures, SECURITY DEFINER/search_path, grants, owner-only
-- opacity boundary, row locking, and atomic Event+children behavior.
create or replace function public.delete_event_occurrence(p_occurrence_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_event_id uuid;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select eo.event_id into v_event_id
  from public.event_occurrences eo
  where eo.id = p_occurrence_id
  for update;

  if v_event_id is null or not exists (
    select 1 from public.events e where e.id = v_event_id and e.owner_id = v_actor
  ) then
    raise exception 'occurrence not found or not owned by the caller' using errcode = '42501';
  end if;

  if exists (select 1 from public.occurrence_participations where occurrence_id = p_occurrence_id)
    or exists (select 1 from public.occurrence_invitations where occurrence_id = p_occurrence_id)
  then
    raise exception
      'occurrence cannot be deleted: participation or invitation data exists'
      using errcode = '90001';
  end if;

  delete from public.event_occurrences where id = p_occurrence_id;
end;
$$;

revoke execute on function public.delete_event_occurrence(uuid) from public;
revoke execute on function public.delete_event_occurrence(uuid) from anon;
grant execute on function public.delete_event_occurrence(uuid) to authenticated;

create or replace function public.delete_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_owner_id uuid;
  v_occurrence_id uuid;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select owner_id into v_owner_id from public.events where id = p_event_id for update;

  if v_owner_id is null or v_owner_id <> v_actor then
    raise exception 'event not found or not owned by the caller' using errcode = '42501';
  end if;

  for v_occurrence_id in
    select id from public.event_occurrences where event_id = p_event_id order by id for update
  loop
    if exists (select 1 from public.occurrence_participations where occurrence_id = v_occurrence_id)
      or exists (select 1 from public.occurrence_invitations where occurrence_id = v_occurrence_id)
    then
      raise exception
        'event cannot be deleted: a child occurrence has participation or invitation data'
        using errcode = '90001';
    end if;
  end loop;

  delete from public.event_occurrences where event_id = p_event_id;
  delete from public.events where id = p_event_id;
end;
$$;

revoke execute on function public.delete_event(uuid) from public;
revoke execute on function public.delete_event(uuid) from anon;
grant execute on function public.delete_event(uuid) to authenticated;

-- The production preflight recorded zero rows in all three legacy tables.
-- Keep a database-side fence as well: if a row appears between that
-- read-only check and operator-applied migration, fail before any legacy row
-- can be destroyed instead of silently discarding it.
do $$
begin
  if exists (select 1 from public.ticket_transfers)
    or exists (select 1 from public.tickets)
    or exists (select 1 from public.ticket_acquisitions)
  then
    raise exception
      'legacy Ticket rows must be empty before Issue #234 cleanup migration';
  end if;
end;
$$;

-- Drop RPCs before the helper functions and their tables.
drop function public.request_ticket_transfer(uuid, uuid);
drop function public.accept_ticket_transfer(uuid);
drop function public.cancel_ticket_transfer(uuid);

-- Drop transfer/provenance helpers after every policy/RPC that calls them is
-- gone. The policy is removed first because it references the provenance
-- helper, and the tickets policy is removed before ticket_transfers itself.
drop function public.pending_ticket_transfer_offer(uuid);
drop policy ticket_transfers_select_involved on public.ticket_transfers;
drop function public.can_view_ticket_provenance(uuid);
drop function public.ticket_transfer_recipient_is_eligible(uuid, uuid);

-- Remove cancellation and secured-acquisition maintenance machinery that is
-- owned exclusively by the legacy tables.
drop trigger ticket_acquisitions_reject_insert_when_canceled on public.ticket_acquisitions;
drop function public.check_ticket_acquisition_insert_not_canceled();
drop trigger ticket_acquisitions_keep_secured_with_tickets on public.ticket_acquisitions;
drop function public.enforce_secured_acquisition_keeps_tickets();

drop trigger ticket_transfers_set_updated_at on public.ticket_transfers;
drop function public.set_ticket_transfers_updated_at();
drop trigger tickets_set_updated_at on public.tickets;
drop function public.set_tickets_updated_at();
drop trigger ticket_acquisitions_set_updated_at on public.ticket_acquisitions;
drop function public.set_ticket_acquisitions_updated_at();

-- Remove every legacy table policy explicitly. Table-owned indexes,
-- constraints, foreign keys, and grants disappear with their owning table;
-- no CASCADE is used, so an unexpected dependency fails the migration.
drop policy tickets_select_owner_or_source_acquirer on public.tickets;
drop policy tickets_insert_under_own_secured_acquisition on public.tickets;
drop policy tickets_update_own on public.tickets;
drop policy ticket_acquisitions_select_own on public.ticket_acquisitions;
drop policy ticket_acquisitions_insert_own on public.ticket_acquisitions;
drop policy ticket_acquisitions_update_own on public.ticket_acquisitions;

-- Child-first removal follows the FK graph: transfers -> tickets ->
-- acquisitions -> event_occurrences. TicketOpportunity tables are not part
-- of this graph and are intentionally untouched.
drop table public.ticket_transfers;
drop table public.tickets;
drop table public.ticket_acquisitions;
