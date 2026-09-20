-- Issue #579 / parent #576: protect the explicit selected-target scope of
-- TicketOpportunity during standalone Occurrence hard-delete.
--
-- The runtime prerequisite (#578 / PR #577) is already deployed and accepts
-- the existing privacy-safe SQLSTATE 90001 for this additional blocker.
--
-- This changes ONLY delete_event_occurrence. Whole-Event delete remains
-- intentionally unchanged: deleting an Event removes its TicketOpportunities
-- and dependent personal planning state as one Event-level lifecycle action.
--
-- Keep the existing opacity and race-safety boundary:
-- - 42501 hides not-found vs not-owned;
-- - 90001 remains the single delete-blocked classification;
-- - FOR UPDATE locks the Occurrence before downstream checks, closing the
--   check-then-delete race in the same way as the existing participation /
--   invitation blockers.
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

  if exists (
    select 1
    from public.occurrence_participations
    where occurrence_id = p_occurrence_id
  )
    or exists (
      select 1
      from public.occurrence_invitations
      where occurrence_id = p_occurrence_id
    )
    or exists (
      select 1
      from public.ticket_opportunity_target_occurrences
      where occurrence_id = p_occurrence_id
    )
  then
    raise exception
      'occurrence cannot be deleted: dependent data exists'
      using errcode = '90001';
  end if;

  delete from public.event_occurrences where id = p_occurrence_id;
end;
$$;

revoke execute on function public.delete_event_occurrence(uuid) from public;
revoke execute on function public.delete_event_occurrence(uuid) from anon;
grant execute on function public.delete_event_occurrence(uuid) to authenticated;
