-- Issue #633: reviewed plans may be applied only against the catalog facts
-- from which their import-core plan was prepared. Lock the parent and every
-- existing child before comparing; FK inserts need a key-share lock on the
-- parent, while edits/deletes of existing children conflict with their row
-- locks. The subsequent import RPC runs in this same PostgreSQL transaction.

create function public.apply_reviewed_import_event_plan(
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
  p_groups jsonb,
  p_expected_current jsonb
) returns public.events
language plpgsql
set search_path = ''
as $$
declare
  v_event public.events;
begin
  if p_action is null or p_action not in ('create', 'update', 'unchanged') then
    raise exception 'unsupported reviewed Event action' using errcode = '22023';
  end if;

  if p_action = 'create' then
    if p_event_id is not null or p_expected_current is not null then
      raise exception 'create requires an absent Event snapshot' using errcode = '22023';
    end if;
    -- The unique events.source_key constraint remains the final race guard
    -- for a concurrent create under the same official identity.
  else
    if p_event_id is null or p_expected_current is null
      or jsonb_typeof(p_expected_current -> 'event') <> 'object'
      or jsonb_typeof(p_expected_current -> 'occurrences') <> 'array'
      or jsonb_typeof(p_expected_current -> 'groups') <> 'array' then
      raise exception 'reviewed Event snapshot is required' using errcode = '22023';
    end if;

    select * into v_event from public.events where id = p_event_id for update;
    if v_event.id is null then
      raise exception 'reviewed Event no longer exists' using errcode = '40001';
    end if;
    perform 1 from public.event_occurrences
      where event_id = p_event_id for update;
    perform 1 from public.event_groups
      where event_id = p_event_id for update;
    perform 1 from public.groups g
      join public.event_groups eg on eg.group_id = g.id
      where eg.event_id = p_event_id for update of g;
    perform 1 from public.genres
      where id = v_event.genre_id for update;

    if v_event.id is distinct from (p_expected_current #>> '{event,id}')::uuid
      or v_event.source_key is distinct from p_expected_current #>> '{event,source_key}'
      or v_event.owner_id is distinct from (p_expected_current #>> '{event,owner_id}')::uuid
      or v_event.title is distinct from p_expected_current #>> '{event,title}'
      or v_event.venue is distinct from p_expected_current #>> '{event,venue}'
      or v_event.source_url is distinct from p_expected_current #>> '{event,source_url}'
      or v_event.memo is distinct from p_expected_current #>> '{event,memo}'
      or v_event.starts_on is distinct from (p_expected_current #>> '{event,starts_on}')::date
      or v_event.ends_on is distinct from (p_expected_current #>> '{event,ends_on}')::date
      or v_event.genre_id is distinct from (p_expected_current #>> '{event,genre_id}')::uuid
      or (select key from public.genres where id = v_event.genre_id)
           is distinct from p_expected_current ->> 'genreKey'
      or v_event.canceled_at is distinct from (p_expected_current #>> '{event,canceled_at}')::timestamptz
      or exists (
        select id, starts_at, doors_at, ends_at, canceled_at
        from public.event_occurrences where event_id = p_event_id
        except
        select id, starts_at, doors_at, ends_at, canceled_at
        from jsonb_to_recordset(p_expected_current -> 'occurrences')
          as expected(id uuid, starts_at timestamptz, doors_at timestamptz,
                      ends_at timestamptz, canceled_at timestamptz)
      )
      or exists (
        select id, starts_at, doors_at, ends_at, canceled_at
        from jsonb_to_recordset(p_expected_current -> 'occurrences')
          as expected(id uuid, starts_at timestamptz, doors_at timestamptz,
                      ends_at timestamptz, canceled_at timestamptz)
        except
        select id, starts_at, doors_at, ends_at, canceled_at
        from public.event_occurrences where event_id = p_event_id
      )
      or exists (
        select g.key, g.display_name
        from public.event_groups eg join public.groups g on g.id = eg.group_id
        where eg.event_id = p_event_id
        except
        select key, "displayName"
        from jsonb_to_recordset(p_expected_current -> 'groups')
          as expected(key text, "displayName" text)
      )
      or exists (
        select key, "displayName"
        from jsonb_to_recordset(p_expected_current -> 'groups')
          as expected(key text, "displayName" text)
        except
        select g.key, g.display_name
        from public.event_groups eg join public.groups g on g.id = eg.group_id
        where eg.event_id = p_event_id
      ) then
      raise exception 'reviewed Event catalog changed before apply'
        using errcode = '40001';
    end if;
  end if;

  select * into v_event from public.apply_import_event_plan(
    p_action := p_action,
    p_owner_id := p_owner_id,
    p_event_id := p_event_id,
    p_source_key := p_source_key,
    p_title := p_title,
    p_starts_on := p_starts_on,
    p_ends_on := p_ends_on,
    p_occurrences := p_occurrences,
    p_occurrence_fixes := p_occurrence_fixes,
    p_venue := p_venue,
    p_source_url := p_source_url,
    p_memo := p_memo,
    p_set_genre := p_set_genre,
    p_genre_key := p_genre_key,
    p_set_groups := p_set_groups,
    p_groups := p_groups
  );
  return v_event;
end;
$$;

revoke execute on function public.apply_reviewed_import_event_plan(
  text, uuid, uuid, text, text, date, date, jsonb, jsonb, text, text, text,
  boolean, text, boolean, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_reviewed_import_event_plan(
  text, uuid, uuid, text, text, date, date, jsonb, jsonb, text, text, text,
  boolean, text, boolean, jsonb, jsonb
) to service_role;

create function public.apply_reviewed_ticket_opportunity(
  p_action text,
  p_event_id uuid,
  p_source_key text,
  p_display_name text,
  p_target_scope text,
  p_occurrence_ids uuid[],
  p_source_url text,
  p_memo text,
  p_milestones jsonb,
  p_expected_current jsonb
) returns public.ticket_opportunities
language plpgsql
set search_path = ''
as $$
declare
  v_event public.events;
  v_opportunity public.ticket_opportunities;
begin
  if p_action is null or p_action not in ('create', 'update', 'unchanged')
    or p_expected_current is null
    or jsonb_typeof(p_expected_current -> 'event') <> 'object'
    or jsonb_typeof(p_expected_current -> 'targets') <> 'array'
    or jsonb_typeof(p_expected_current -> 'milestones') <> 'array'
    or jsonb_typeof(p_expected_current -> 'targetOccurrences') <> 'array' then
    raise exception 'reviewed Ticket Opportunity snapshot is required'
      using errcode = '22023';
  end if;

  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null
    or v_event.id is distinct from (p_expected_current #>> '{event,id}')::uuid
    or v_event.source_key is distinct from p_expected_current #>> '{event,source_key}'
    or v_event.title is distinct from p_expected_current #>> '{event,title}' then
    raise exception 'reviewed target Event changed before apply'
      using errcode = '40001';
  end if;

  perform 1 from public.event_occurrences
    where id = any(p_occurrence_ids) for update;
  if exists (
    select id, starts_at from public.event_occurrences
    where id = any(p_occurrence_ids) and event_id = p_event_id
    except
    select id, starts_at
    from jsonb_to_recordset(p_expected_current -> 'targetOccurrences')
      as expected(id uuid, starts_at timestamptz)
  ) or exists (
    select id, starts_at
    from jsonb_to_recordset(p_expected_current -> 'targetOccurrences')
      as expected(id uuid, starts_at timestamptz)
    except
    select id, starts_at from public.event_occurrences
    where id = any(p_occurrence_ids) and event_id = p_event_id
  ) then
    raise exception 'reviewed target Occurrence changed before apply'
      using errcode = '40001';
  end if;

  select * into v_opportunity from public.ticket_opportunities
    where source_key = p_source_key for update;
  if p_action = 'create' then
    if v_opportunity.id is not null
      or p_expected_current -> 'opportunity' is distinct from 'null'::jsonb then
      raise exception 'reviewed Ticket Opportunity now exists'
        using errcode = '40001';
    end if;
    -- Reserve the source-key row before checking and replacing its children.
    -- A competing upsert cannot slip between the absence check and import.
    insert into public.ticket_opportunities
      (event_id, source_key, display_name, target_scope, source_url, memo)
    values
      (p_event_id, p_source_key, p_display_name, p_target_scope, p_source_url, p_memo)
    on conflict (source_key) do nothing
    returning * into v_opportunity;
    if v_opportunity.id is null then
      raise exception 'reviewed Ticket Opportunity created concurrently'
        using errcode = '40001';
    end if;
  else
    if v_opportunity.id is null
      or jsonb_typeof(p_expected_current -> 'opportunity') <> 'object'
      or v_opportunity.id is distinct from (p_expected_current #>> '{opportunity,id}')::uuid
      or v_opportunity.event_id is distinct from (p_expected_current #>> '{opportunity,event_id}')::uuid
      or v_opportunity.source_key is distinct from p_expected_current #>> '{opportunity,source_key}'
      or v_opportunity.display_name is distinct from p_expected_current #>> '{opportunity,display_name}'
      or v_opportunity.target_scope is distinct from p_expected_current #>> '{opportunity,target_scope}'
      or v_opportunity.source_url is distinct from p_expected_current #>> '{opportunity,source_url}'
      or v_opportunity.memo is distinct from p_expected_current #>> '{opportunity,memo}' then
      raise exception 'reviewed Ticket Opportunity changed before apply'
        using errcode = '40001';
    end if;
    perform 1 from public.ticket_opportunity_target_occurrences
      where opportunity_id = v_opportunity.id for update;
    perform 1 from public.ticket_opportunity_milestones
      where opportunity_id = v_opportunity.id for update;
    if exists (
      select occurrence_id from public.ticket_opportunity_target_occurrences
      where opportunity_id = v_opportunity.id
      except
      select expected.value::uuid
      from jsonb_array_elements_text(p_expected_current -> 'targets') as expected(value)
    ) or exists (
      select expected.value::uuid
      from jsonb_array_elements_text(p_expected_current -> 'targets') as expected(value)
      except
      select occurrence_id from public.ticket_opportunity_target_occurrences
      where opportunity_id = v_opportunity.id
    ) or exists (
      select milestone_type, temporal_precision, date_value, at, starts_at, ends_at
      from public.ticket_opportunity_milestones where opportunity_id = v_opportunity.id
      except
      select milestone_type, temporal_precision, date_value, at, starts_at, ends_at
      from jsonb_to_recordset(p_expected_current -> 'milestones')
        as expected(milestone_type text, temporal_precision text, date_value date,
                    at timestamptz, starts_at timestamptz, ends_at timestamptz)
    ) or exists (
      select milestone_type, temporal_precision, date_value, at, starts_at, ends_at
      from jsonb_to_recordset(p_expected_current -> 'milestones')
        as expected(milestone_type text, temporal_precision text, date_value date,
                    at timestamptz, starts_at timestamptz, ends_at timestamptz)
      except
      select milestone_type, temporal_precision, date_value, at, starts_at, ends_at
      from public.ticket_opportunity_milestones where opportunity_id = v_opportunity.id
    ) then
      raise exception 'reviewed Ticket Opportunity facts changed before apply'
        using errcode = '40001';
    end if;
  end if;

  if p_action = 'unchanged' then
    return v_opportunity;
  end if;
  select * into v_opportunity from public.import_ticket_opportunity(
    p_event_id := p_event_id,
    p_source_key := p_source_key,
    p_display_name := p_display_name,
    p_target_scope := p_target_scope,
    p_occurrence_ids := p_occurrence_ids,
    p_source_url := p_source_url,
    p_memo := p_memo,
    p_milestones := p_milestones
  );
  return v_opportunity;
end;
$$;

revoke execute on function public.apply_reviewed_ticket_opportunity(
  text, uuid, text, text, text, uuid[], text, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_reviewed_ticket_opportunity(
  text, uuid, text, text, text, uuid[], text, text, jsonb, jsonb
) to service_role;
