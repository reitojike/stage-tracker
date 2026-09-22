-- Issue #633: one approved Event plan must commit its Event/Occurrence and
-- classification facets together.  The existing P1 RPCs remain the owners of
-- their respective validation/write rules; this service-role-only wrapper
-- gives one plan a single PostgreSQL transaction boundary.

create function public.apply_import_event_plan(
  p_action text,
  p_owner_id uuid,
  p_event_id uuid,
  p_source_key text,
  p_title text,
  p_starts_on date,
  p_ends_on date,
  p_occurrences jsonb,
  p_occurrence_fixes jsonb,
  p_venue text,
  p_source_url text,
  p_memo text,
  p_set_genre boolean,
  p_genre_key text,
  p_set_groups boolean,
  p_groups jsonb
) returns public.events
language plpgsql
set search_path = ''
as $$
declare
  v_event public.events;
begin
  if p_action not in ('create', 'update', 'unchanged') then
    raise exception 'unsupported Event import action: %', p_action
      using errcode = '22023';
  end if;

  if p_owner_id is null then
    raise exception 'owner is required' using errcode = '22004';
  end if;

  if p_action = 'create' then
    if p_event_id is not null then
      raise exception 'create action must not supply an Event id'
        using errcode = '22023';
    end if;

    select * into v_event
    from public.import_event_with_occurrences(
      p_owner_id := p_owner_id,
      p_source_key := p_source_key,
      p_title := p_title,
      p_starts_on := p_starts_on,
      p_ends_on := p_ends_on,
      p_occurrences := p_occurrences,
      p_venue := p_venue,
      p_source_url := p_source_url,
      p_memo := p_memo
    );
  else
    if p_event_id is null then
      raise exception '% action requires an Event id', p_action
        using errcode = '22004';
    end if;

    select * into v_event from public.events where id = p_event_id;
    if v_event.id is null then
      raise exception 'event % not found', p_event_id using errcode = '22023';
    end if;
    if v_event.owner_id <> p_owner_id then
      raise exception 'event % is not owned by the requested import owner', p_event_id
        using errcode = '42501';
    end if;

    if p_action = 'update' then
      select * into v_event
      from public.import_update_event(
        p_event_id := p_event_id,
        p_title := p_title,
        p_starts_on := p_starts_on,
        p_ends_on := p_ends_on,
        p_venue := p_venue,
        p_source_url := p_source_url,
        p_memo := p_memo,
        p_new_occurrences := p_occurrences,
        p_occurrence_fixes := p_occurrence_fixes
      );
    end if;
  end if;

  if p_set_genre or p_set_groups then
    select * into v_event
    from public.import_event_classification(
      p_event_id := v_event.id,
      p_set_genre := p_set_genre,
      p_genre_key := p_genre_key,
      p_set_groups := p_set_groups,
      p_groups := p_groups
    );
  end if;

  return v_event;
end;
$$;

revoke execute on function public.apply_import_event_plan(
  text, uuid, uuid, text, text, date, date, jsonb, jsonb, text, text, text,
  boolean, text, boolean, jsonb
) from public;
revoke execute on function public.apply_import_event_plan(
  text, uuid, uuid, text, text, date, date, jsonb, jsonb, text, text, text,
  boolean, text, boolean, jsonb
) from anon, authenticated;
grant execute on function public.apply_import_event_plan(
  text, uuid, uuid, text, text, date, date, jsonb, jsonb, text, text, text,
  boolean, text, boolean, jsonb
) to service_role;
