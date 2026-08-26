-- Event / Occurrence hard deletion (Issue #124).
--
-- Product semantics (product-rules.md "Deletion", materialized here): hard
-- delete corrects mis-registration ("should never have been created"), never a
-- content change (use existing edit/update) and never a cancellation (Issue
-- #125, deliberately out of scope).
--
-- Why SECURITY DEFINER RPCs (not RLS DELETE policies):
-- No DELETE grant/policy has ever existed on events/event_occurrences. Adding
-- one for `authenticated` would let clients bypass this guarded RPC entirely
-- via raw `.from(...).delete()` calls, landing on Postgres's own FK violation
-- instead of a classifiable one, and breaking atomic Event+children delete's
-- all-or-nothing guarantee (a second client could delete a child out from under
-- an in-flight Event delete through that ungoverned path). SECURITY DEFINER
-- keeps deletion capability ONLY reachable through these guarded RPCs - the
-- same reasoning create_event, invite_to_occurrence, and ticket-transfer RPCs
-- use for privileges the caller has no direct table grant for.
--
-- Race-safety: plain (NO ACTION) FKs from occurrence_participations /
-- occurrence_invitations / ticket_acquisitions to event_occurrences, and from
-- event_occurrences to events, already structurally backstop this design - a
-- concurrent INSERT into a table referencing the locked row will be caught by
-- Postgres's own FK enforcement, transactionally, so nothing is ever lost.
-- The `for update` locking here adds determinism: without it, a downstream row
-- inserted in the narrow window between this function's guard check and its
-- DELETE would still fail (transaction rolls back, nothing lost), but as a raw
-- constraint error rather than this function's own friendly, classifiable one.
-- Locking the row(s) being checked BEFORE the guard query closes that window:
-- any concurrent INSERT's own FK check needs FOR KEY SHARE on the referenced
-- row, and FOR KEY SHARE conflicts with FOR UPDATE - so once this function
-- holds FOR UPDATE, no new downstream reference can complete until this
-- transaction ends. Same discipline request_ticket_transfer already documents
-- (20260822093400), and same row-lock conflict reasoning check_occurrence_
-- within_event_range (20260825000200) already relies on.
--
-- Downstream guard scope: occurrence_participations, occurrence_invitations,
-- and ticket_acquisitions are checked directly by occurrence_id. tickets and
-- ticket_transfers are not checked directly: a ticket_acquisitions row (NO
-- ACTION) can never be deleted while tickets reference it, so "zero
-- ticket_acquisitions rows for this occurrence" already implies zero
-- tickets/ticket_transfers descend from it transitively.
--
-- Error convention (mirrors reschedule_event / classifyWriteError):
-- - 42501 (insufficient_privilege): not found OR not owned, deliberately not
--   distinguished (non-owner must not learn existence from error shape alone).
-- - 90001 (application-defined, custom downstream-block condition, see below):
--   rejected because occurrence_participations / occurrence_invitations /
--   ticket_acquisitions exists. Distinct from other 23503 (FK violations in
--   range-containment checks, which stay 'validation' kind).

-- Custom SQLSTATE 90001: application-defined condition for delete-blocked due
-- to downstream data. This is NOT PostgreSQL's own FK violation (23503).
-- We raise it explicitly to be distinguishable from other FK-shaped errors.
-- PostgREST will propagate this code to the client's error.code field.

create function public.delete_event_occurrence(p_occurrence_id uuid)
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
    or exists (select 1 from public.ticket_acquisitions where occurrence_id = p_occurrence_id)
  then
    raise exception
      'occurrence cannot be deleted: participation, invitation, or ticket acquisition data exists'
      using errcode = '90001';
  end if;

  delete from public.event_occurrences where id = p_occurrence_id;
end;
$$;

revoke execute on function public.delete_event_occurrence(uuid) from public;
revoke execute on function public.delete_event_occurrence(uuid) from anon;
grant execute on function public.delete_event_occurrence(uuid) to authenticated;

-- Atomic Event + every safe child Occurrence delete. Rejects the whole
-- operation if ANY child has downstream data (product-rules.md: "全child が
-- safe-delete 条件を満たす場合に限り"). The loop below raises on the first
-- unsafe child it finds, which aborts and rolls back this function's entire
-- transaction, so no partial delete is ever observable. A 0-occurrence event
-- has an empty loop and deletes cleanly.

create function public.delete_event(p_event_id uuid)
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
      or exists (select 1 from public.ticket_acquisitions where occurrence_id = v_occurrence_id)
    then
      raise exception
        'event cannot be deleted: a child occurrence has participation, invitation, or ticket acquisition data'
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
