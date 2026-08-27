-- Atomic operator-import write boundary for TicketOpportunity (Issue #162,
-- PO decision #157).
--
-- This is the *only* write path for ticket_opportunities /
-- ticket_opportunity_target_occurrences / ticket_opportunity_milestones:
-- none of those tables grants authenticated INSERT/UPDATE/DELETE at all
-- (see the three preceding migrations), so ordinary users cannot mutate the
-- shared official schedule, matching #157 "ordinary authenticated user向け
-- generic official schedule mutation UIはcurrent MVPで作らない". The actual
-- crawler/parser/operator script that calls this function is Issue #163's
-- scope, not this one's - this migration only materializes the boundary
-- #163 will consume, mirroring how
-- 20260823040000_create_import_event_with_occurrences_rpc.sql gave the
-- (then still-to-come) event import script its atomic create path.
--
-- Idempotent "replace all" semantics keyed on source_key, matching the
-- product's reviewable-seed workflow (agent reads official source -> local
-- reviewable seed -> operator dry run -> explicit apply, #157 "Import
-- authority"): re-running an import for the same Opportunity should
-- converge on the source's current content, not accumulate stale target
-- occurrences or milestones from a previous run. On conflict, the
-- Opportunity's own columns are updated in place and its target-occurrence
-- relations and milestones are fully replaced from the payload passed this
-- time - never merged, so a milestone or target occurrence removed from the
-- source disappears on the next import rather than lingering.
--
-- SECURITY INVOKER (the default), matching
-- import_event_with_occurrences: this function is only ever reachable by
-- service_role (see the revoke/grant below), which already carries the
-- underlying table privileges and BYPASSRLS, so running as the caller keeps
-- this from becoming a privilege-escalation surface if the EXECUTE grant is
-- ever loosened.
create function public.import_ticket_opportunity(
  p_event_id uuid,
  p_source_key text,
  p_display_name text,
  p_target_scope text,
  p_occurrence_ids uuid[] default null,
  p_source_url text default null,
  p_memo text default null,
  p_milestones jsonb default '[]'::jsonb
) returns public.ticket_opportunities
language plpgsql
set search_path = ''
as $$
declare
  v_opportunity public.ticket_opportunities;
  v_occurrence_ids uuid[];
  v_occurrence_count integer;
  v_matching_event_count integer;
begin
  if p_event_id is null then
    raise exception 'event is required' using errcode = '22004';
  end if;

  if p_source_key is null or btrim(p_source_key) = '' then
    raise exception 'source_key is required for an imported ticket opportunity'
      using errcode = '22004';
  end if;

  if p_display_name is null or btrim(p_display_name) = '' then
    raise exception 'display_name is required' using errcode = '22004';
  end if;

  -- `p_target_scope is null` is checked explicitly rather than folded into
  -- the `not in (...)` below: SQL's three-valued logic makes
  -- `null not in (...)` evaluate to null (neither true nor false), which
  -- would silently skip this guard for a null input instead of rejecting
  -- it, falling through into the `else` branch further down as if
  -- 'selected_occurrences' had been requested.
  if p_target_scope is null or p_target_scope not in ('event_wide', 'selected_occurrences') then
    raise exception 'target_scope must be event_wide or selected_occurrences'
      using errcode = '22023';
  end if;

  if p_target_scope = 'event_wide' then
    if p_occurrence_ids is not null and array_length(p_occurrence_ids, 1) > 0 then
      raise exception
        'an event_wide opportunity must not be given target occurrences'
        using errcode = '22023';
    end if;
  else
    if p_occurrence_ids is null or array_length(p_occurrence_ids, 1) is null then
      raise exception
        'a selected_occurrences opportunity requires at least one target occurrence'
        using errcode = '22023';
    end if;

    -- Deduplicated up front: p_occurrence_ids is caller input, not
    -- necessarily distinct, and both the count-based check below and the
    -- primary-key insert further down need a distinct set to be correct.
    -- Without this, a duplicated id (e.g. [x, x]) would make
    -- array_length() disagree with count(*) (which only ever counts
    -- matching *rows*, i.e. distinct occurrences) and falsely trip the
    -- "must belong to the given event" rejection below even though every
    -- id given is genuinely valid.
    select array_agg(distinct occurrence_id) into v_occurrence_ids
    from unnest(p_occurrence_ids) as occurrence_id;

    v_occurrence_count := array_length(v_occurrence_ids, 1);

    select count(*) into v_matching_event_count
    from public.event_occurrences eo
    where eo.id = any (v_occurrence_ids)
      and eo.event_id = p_event_id;

    -- Cheaper, whole-set version of the per-row check
    -- ticket_opportunity_target_occurrences's own trigger enforces on
    -- insert: rejects the entire import up front (before the opportunity
    -- row is even touched) rather than failing midway through the relation
    -- inserts below, and also catches an occurrence id that does not exist
    -- at all, which the trigger's own JOIN would otherwise treat the same
    -- as "wrong event".
    if v_matching_event_count <> v_occurrence_count then
      raise exception
        'every target occurrence must belong to the given event'
        using errcode = '23514';
    end if;
  end if;

  insert into public.ticket_opportunities
    (event_id, source_key, display_name, target_scope, source_url, memo)
  values
    (p_event_id, p_source_key, p_display_name, p_target_scope, p_source_url, p_memo)
  on conflict (source_key) do update set
    event_id = excluded.event_id,
    display_name = excluded.display_name,
    target_scope = excluded.target_scope,
    source_url = excluded.source_url,
    memo = excluded.memo
  returning * into v_opportunity;

  delete from public.ticket_opportunity_target_occurrences
  where opportunity_id = v_opportunity.id;

  if p_target_scope = 'selected_occurrences' then
    insert into public.ticket_opportunity_target_occurrences (opportunity_id, occurrence_id)
    select v_opportunity.id, occurrence_id
    from unnest(v_occurrence_ids) as occurrence_id;
  end if;

  delete from public.ticket_opportunity_milestones
  where opportunity_id = v_opportunity.id;

  -- Set-based, matching the target-occurrences insert above:
  -- jsonb_array_elements is a strict set-returning function, so
  -- jsonb_array_elements(null) already yields zero rows - no separate
  -- null-guard or per-row loop is needed.
  insert into public.ticket_opportunity_milestones (
    opportunity_id, milestone_type, temporal_precision,
    date_value, at, starts_at, ends_at
  )
  select
    v_opportunity.id,
    element ->> 'milestone_type',
    element ->> 'temporal_precision',
    (element ->> 'date_value')::date,
    (element ->> 'at')::timestamptz,
    (element ->> 'starts_at')::timestamptz,
    (element ->> 'ends_at')::timestamptz
  from jsonb_array_elements(p_milestones) as element;

  return v_opportunity;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation - see
-- 20260823040000_create_import_event_with_occurrences_rpc.sql for why anon/
-- authenticated are also named explicitly rather than relying on the PUBLIC
-- revoke alone.
revoke execute on function public.import_ticket_opportunity(
  uuid, text, text, text, uuid[], text, text, jsonb
) from public;
revoke execute on function public.import_ticket_opportunity(
  uuid, text, text, text, uuid[], text, text, jsonb
) from anon, authenticated;
grant execute on function public.import_ticket_opportunity(
  uuid, text, text, text, uuid[], text, text, jsonb
) to service_role;

-- Deliberately NOT here:
-- - catalog_creators membership validation on p_event_id's owner, unlike
--   import_event_with_occurrences. That check defends the "who may create
--   an Event" boundary; a ticket opportunity has no owner of its own to
--   spoof, and this function requires no p_owner_id at all.
-- - Any validation of individual milestone shape beyond what the table's
--   own CHECK constraints already enforce (milestone_type vocabulary,
--   temporal_precision vocabulary, exactly-one-column-group-populated,
--   window ordering) - re-stating them here would drift from the single
--   source of truth in
--   20260828000100_create_ticket_opportunity_milestones.sql.
