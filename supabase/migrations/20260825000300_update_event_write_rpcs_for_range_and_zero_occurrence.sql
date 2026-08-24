-- create_event (renamed from create_event_with_occurrence) and
-- import_event_with_occurrences both change contract for #88:
--
-- - Event range (starts_on/ends_on) becomes required input on both create
--   paths, since events.starts_on/ends_on are now NOT NULL
--   (20260825000000_add_event_range.sql).
-- - The initial/imported occurrence(s) become optional: product-rules.md
--   now allows a 0-occurrence event on both the UI create path and the
--   operator import path.
-- - create_event_with_occurrence is dropped rather than kept as a legacy
--   alias: once occurrence-less create is allowed, that name no longer
--   describes what the function does, and this repository does not carry
--   permanently-unused write boundaries. Nothing outside this migration
--   (RLS policies, grants on other objects) referenced the function by
--   name, so dropping it is safe.
drop function if exists public.create_event_with_occurrence(
  text, timestamptz, text, timestamptz, text, text
);

-- SECURITY DEFINER (unchanged from create_event_with_occurrence): a normal
-- authenticated client still has no INSERT grant on events at all, so this
-- has to run as its owner to perform that insert. owner_id is still derived
-- from auth.uid() only - no input surface for owner spoofing.
create function public.create_event(
  p_title text,
  p_starts_on date,
  p_ends_on date,
  p_venue text default null,
  p_source_url text default null,
  p_memo text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_doors_at timestamptz default null
) returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not exists (
    select 1
    from public.catalog_creators cc
    where cc.user_id = auth.uid()
  ) then
    raise exception 'event creation is restricted to designated catalog creators'
      using errcode = '42501';
  end if;

  -- p_starts_at absent/null means "create with no occurrence yet" (Issue
  -- #87: 0-occurrence events are a legitimate, immediately-catalog-visible
  -- state) - but that state must be unambiguous: every occurrence temporal
  -- field unset, not just starts_at. A caller supplying p_ends_at/
  -- p_doors_at without p_starts_at has no occurrence for those values to
  -- belong to, so this is rejected rather than silently discarding them
  -- (the shipped UI can't reach this - OccurrenceInput.startsAtUtc is
  -- non-nullable - but the RPC itself is reachable directly by any
  -- authenticated designated creator).
  if p_starts_at is null and (p_ends_at is not null or p_doors_at is not null) then
    raise exception
      'p_ends_at/p_doors_at require p_starts_at (an occurrence needs a start time)'
      using errcode = '22004';
  end if;

  insert into public.events (owner_id, title, venue, source_url, memo, starts_on, ends_on)
  values (auth.uid(), p_title, p_venue, p_source_url, p_memo, p_starts_on, p_ends_on)
  returning * into v_event;

  -- event_occurrences_within_event_range
  -- (20260825000200_add_event_range_containment_triggers.sql) still checks
  -- this insert when one is supplied, so a p_starts_at outside
  -- [p_starts_on, p_ends_on] is rejected the same as any other write.
  if p_starts_at is not null then
    insert into public.event_occurrences (event_id, starts_at, ends_at, doors_at)
    values (v_event.id, p_starts_at, p_ends_at, p_doors_at);
  end if;

  return v_event;
end;
$$;

revoke execute on function public.create_event(
  text, date, date, text, text, text, timestamptz, timestamptz, timestamptz
) from public;
grant execute on function public.create_event(
  text, date, date, text, text, text, timestamptz, timestamptz, timestamptz
) to authenticated;

-- import_event_with_occurrences: signature changes (new required
-- p_starts_on/p_ends_on ahead of the existing optional params), so this is
-- a drop + recreate rather than create-or-replace.
drop function if exists public.import_event_with_occurrences(
  uuid, text, text, jsonb, text, text, text
);

create function public.import_event_with_occurrences(
  p_owner_id uuid,
  p_source_key text,
  p_title text,
  p_starts_on date,
  p_ends_on date,
  p_occurrences jsonb,
  p_venue text default null,
  p_source_url text default null,
  p_memo text default null
) returns public.events
language plpgsql
set search_path = ''
as $$
declare
  v_event public.events;
  v_inserted integer;
  v_expected integer;
begin
  if p_owner_id is null then
    raise exception 'owner is required' using errcode = '22004';
  end if;

  if p_source_key is null or btrim(p_source_key) = '' then
    raise exception 'source_key is required for an imported event' using errcode = '22004';
  end if;

  if p_starts_on is null or p_ends_on is null then
    raise exception 'starts_on and ends_on are required' using errcode = '22004';
  end if;

  if p_occurrences is null or jsonb_typeof(p_occurrences) <> 'array' then
    raise exception 'occurrences must be an array (possibly empty)' using errcode = '22004';
  end if;

  if not exists (
    select 1
    from public.catalog_creators cc
    where cc.user_id = p_owner_id
  ) then
    raise exception 'event creation is restricted to designated catalog creators'
      using errcode = '42501';
  end if;

  insert into public.events (owner_id, title, venue, source_url, memo, source_key, starts_on, ends_on)
  values (p_owner_id, p_title, p_venue, p_source_url, p_memo, p_source_key, p_starts_on, p_ends_on)
  returning * into v_event;

  -- Empty p_occurrences (Issue #87: import may create a 0-occurrence event)
  -- makes this insert a no-op, which is exactly what is wanted here - the
  -- row-count check below then compares 0 to 0 and does not raise.
  insert into public.event_occurrences (event_id, starts_at, ends_at, doors_at)
  select
    v_event.id,
    (element ->> 'startsAt')::timestamptz,
    (element ->> 'endsAt')::timestamptz,
    (element ->> 'doorsAt')::timestamptz
  from jsonb_array_elements(p_occurrences) as element;

  get diagnostics v_inserted = row_count;
  v_expected := jsonb_array_length(p_occurrences);
  if v_inserted <> v_expected then
    raise exception 'expected % occurrences, inserted %', v_expected, v_inserted
      using errcode = '23514';
  end if;

  return v_event;
end;
$$;

revoke execute on function public.import_event_with_occurrences(
  uuid, text, text, date, date, jsonb, text, text, text
) from public;
revoke execute on function public.import_event_with_occurrences(
  uuid, text, text, date, date, jsonb, text, text, text
) from anon, authenticated;
grant execute on function public.import_event_with_occurrences(
  uuid, text, text, date, date, jsonb, text, text, text
) to service_role;
