-- import_update_event: atomic operator-import update path, the update-side
-- counterpart to import_event_with_occurrences' create path (Issue #88).
--
-- scripts/import-catalog-events.mjs's "update" plan branch previously
-- applied an existing event's field changes, new occurrences, and end-time
-- fixes as separate sequential requests (no shared transaction needed,
-- since none of those could produce a mid-sequence containment violation
-- before Event range existed). Once a re-imported seed's official
-- startsOn/endsOn can differ from what is currently persisted
-- (product-rules.md "Event 開催期間（Event range）" backfill-correction
-- note), a range change and the occurrence writes that go with it need the
-- same deferred-constraint atomicity reschedule_event gives the
-- owner-authenticated UI path
-- (20260825000400_create_reschedule_event_rpc.sql) - just without an
-- auth.uid()-based ownership check, since the caller here is always
-- service_role (already trusted; ownership was checked once, by the
-- calling script, against source_key/owner_id at plan time).
--
-- SECURITY INVOKER, like import_event_with_occurrences: service_role
-- already carries full table privileges and BYPASSRLS, so running as the
-- caller keeps this from becoming a privilege-escalation surface if the
-- EXECUTE grant were ever loosened.
create function public.import_update_event(
  p_event_id uuid,
  p_title text,
  p_starts_on date,
  p_ends_on date,
  p_venue text default null,
  p_source_url text default null,
  p_memo text default null,
  p_new_occurrences jsonb default '[]'::jsonb,
  p_occurrence_fixes jsonb default '[]'::jsonb
) returns public.events
language plpgsql
set search_path = ''
as $$
declare
  v_event public.events;
  v_new_inserted integer;
  v_new_expected integer;
  v_fixed integer;
  v_fix_expected integer;
begin
  if p_event_id is null then
    raise exception 'event id is required' using errcode = '22004';
  end if;

  set constraints
    public.event_occurrences_within_event_range,
    public.events_range_contains_occurrences
    deferred;

  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then
    raise exception 'event % not found', p_event_id using errcode = '22023';
  end if;

  -- Conditional, not unconditional: an UPDATE that writes back the same
  -- values still counts as a real update to events_set_updated_at
  -- (20260820000000_create_events.sql), so an occurrence-only re-import
  -- (new occurrences and/or end/doors-time fixes, with the event's own
  -- descriptive fields and range unchanged) must not silently bump
  -- events.updated_at.
  if v_event.title is distinct from p_title
    or v_event.venue is distinct from p_venue
    or v_event.source_url is distinct from p_source_url
    or v_event.memo is distinct from p_memo
    or v_event.starts_on is distinct from p_starts_on
    or v_event.ends_on is distinct from p_ends_on
  then
    update public.events
    set title = p_title,
        venue = p_venue,
        source_url = p_source_url,
        memo = p_memo,
        starts_on = p_starts_on,
        ends_on = p_ends_on
    where id = p_event_id
    returning * into v_event;
  end if;

  insert into public.event_occurrences (event_id, starts_at, ends_at, doors_at)
  select
    p_event_id,
    (elem ->> 'startsAt')::timestamptz,
    (elem ->> 'endsAt')::timestamptz,
    (elem ->> 'doorsAt')::timestamptz
  from jsonb_array_elements(p_new_occurrences) as elem;

  get diagnostics v_new_inserted = row_count;
  v_new_expected := jsonb_array_length(p_new_occurrences);
  if v_new_inserted <> v_new_expected then
    raise exception 'expected % new occurrences, inserted %', v_new_expected, v_new_inserted
      using errcode = '23514';
  end if;

  -- Fills a blank, never clears a value already there - the same rule the
  -- calling script already applies to end-time fixes (see its
  -- endsAtFixes comment): a null endsAt/doorsAt in a fix element means
  -- "the seed does not know this value", not "clear it".
  --
  -- Scoped to this event (oc.event_id = p_event_id), and the affected row
  -- count is checked against the payload length below - this RPC runs as
  -- service_role (bypasses RLS entirely), so an occurrence id that belongs
  -- to a different event or does not exist must not silently succeed or
  -- silently mutate a row this call was never meant to touch, even though
  -- the current caller (scripts/import-catalog-events.mjs) always builds
  -- this payload from occurrences it already scoped to p_event_id itself.
  update public.event_occurrences oc
  set ends_at = coalesce((elem ->> 'endsAt')::timestamptz, oc.ends_at),
      doors_at = coalesce((elem ->> 'doorsAt')::timestamptz, oc.doors_at)
  from jsonb_array_elements(p_occurrence_fixes) as elem
  where oc.id = (elem ->> 'id')::uuid
    and oc.event_id = p_event_id;

  get diagnostics v_fixed = row_count;
  v_fix_expected := jsonb_array_length(p_occurrence_fixes);
  if v_fixed <> v_fix_expected then
    raise exception 'expected % occurrence fixes, updated %', v_fix_expected, v_fixed
      using errcode = '23514';
  end if;

  return v_event;
end;
$$;

revoke execute on function public.import_update_event(
  uuid, text, date, date, text, text, text, jsonb, jsonb
) from public;
revoke execute on function public.import_update_event(
  uuid, text, date, date, text, text, text, jsonb, jsonb
) from anon, authenticated;
grant execute on function public.import_update_event(
  uuid, text, date, date, text, text, text, jsonb, jsonb
) to service_role;
