-- reschedule_event: atomic owner-authenticated move of an event's range
-- together with its occurrences (Issue #87 product decision, #88
-- implementation).
--
-- product-rules.md "Mutable / system-managed fields": a legitimate
-- reschedule (both the Event range and its existing occurrences move to a
-- new period) must not be permanently blocked by immediate DB-level
-- enforcement of the containment invariant - updating the range first
-- leaves it not yet containing the still-old occurrences, and updating the
-- occurrences first leaves them outside the still-old range. This RPC
-- defers both containment constraint triggers
-- (20260825000200_add_event_range_containment_triggers.sql) to the end of
-- its own transaction so the range and occurrence updates below can run in
-- either order and only the final state is checked.
--
-- SECURITY INVOKER, not DEFINER: the current owner-edit boundary is direct
-- table UPDATE gated by RLS + column grants (events_update_own,
-- event_occurrences_update_own, and the UPDATE column grants on both
-- tables), and that boundary is sufficient here - running as the caller
-- means this function has no more reach than a caller already has through
-- those two UPDATE statements issued separately, just atomically and with
-- the containment check deferred. No new privilege is needed, so none is
-- granted.
create function public.reschedule_event(
  p_event_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_occurrences jsonb default '[]'::jsonb
) returns setof public.event_occurrences
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated integer;
  v_expected integer;
begin
  -- Explicit ownership check up front rather than relying on RLS to
  -- silently filter the UPDATE below to zero rows: same "denied update"
  -- ambiguity src/infrastructure/supabase/eventCatalogWrite.ts already
  -- documents for plain table UPDATEs, resolved the same way here (fail
  -- with 42501) so a caller gets an unambiguous permission denial rather
  -- than a partially-applied no-op.
  if not exists (
    select 1
    from public.events e
    where e.id = p_event_id
      and e.owner_id = auth.uid()
  ) then
    raise exception 'event not found or not owned by the caller' using errcode = '42501';
  end if;

  if p_occurrences is null or jsonb_typeof(p_occurrences) <> 'array' then
    raise exception 'occurrences must be an array (possibly empty)' using errcode = '22004';
  end if;

  set constraints
    public.event_occurrences_within_event_range,
    public.events_range_contains_occurrences
    deferred;

  update public.events
  set starts_on = p_starts_on, ends_on = p_ends_on
  where id = p_event_id;

  -- Identified by immutable occurrence id (not starts_at, which is exactly
  -- what this call may be changing) - every occurrence the caller intends
  -- to carry into the new period, whether its own time is moving or not,
  -- must be named here: an occurrence left out is left at its old time,
  -- which events_range_contains_occurrences will then reject at commit if
  -- that old time no longer fits the new range.
  update public.event_occurrences oc
  set starts_at = (elem ->> 'startsAt')::timestamptz,
      ends_at = (elem ->> 'endsAt')::timestamptz,
      doors_at = (elem ->> 'doorsAt')::timestamptz
  from jsonb_array_elements(p_occurrences) as elem
  where oc.id = (elem ->> 'id')::uuid
    and oc.event_id = p_event_id;

  get diagnostics v_updated = row_count;
  v_expected := jsonb_array_length(p_occurrences);
  if v_updated <> v_expected then
    -- Most often means an occurrence id in the payload does not belong to
    -- this event (e.g. a stale client). Raised with the containment
    -- constraints' own SQLSTATE so it classifies as 'validation'
    -- (src/domain/eventCatalogWrite.ts's classifyWriteError), not a bare
    -- failure.
    raise exception 'expected to update % occurrence(s), updated %', v_expected, v_updated
      using errcode = '23514';
  end if;

  return query select * from public.event_occurrences where event_id = p_event_id;
end;
$$;

revoke execute on function public.reschedule_event(uuid, date, date, jsonb) from public;
grant execute on function public.reschedule_event(uuid, date, date, jsonb) to authenticated;
