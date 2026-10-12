-- Issue #780: compatibility expand, with zero existing-function replacements.
-- Reader #789 deployment must precede this second run FK.
-- Metadata is inert; current eligibility and standalone routes are retained.

create sequence public.official_import_kabuki_publication_ordinal_seq
  as bigint increment by 1 minvalue 1 no maxvalue start with 1 cache 1 no cycle;
revoke all on sequence public.official_import_kabuki_publication_ordinal_seq
  from public, anon, authenticated;
grant usage on sequence public.official_import_kabuki_publication_ordinal_seq to service_role;

alter table public.official_import_runs
  add column publication_ordinal bigint,
  add constraint official_import_runs_publication_ordinal_check check (
    publication_ordinal is null or (
      publication_ordinal > 0 and source_id = 'event.kabuki-bito.schedule'
      and status = 'completed'
    )
  );
alter sequence public.official_import_kabuki_publication_ordinal_seq
  owned by public.official_import_runs.publication_ordinal;
create unique index official_import_runs_kabuki_publication_ordinal_idx
  on public.official_import_runs (publication_ordinal)
  where publication_ordinal is not null;

alter table public.official_import_candidates
  add column recovery_review_required boolean not null default false,
  add column recovery_hold_run_id uuid references public.official_import_runs(id),
  add constraint official_import_candidates_recovery_marker_check check (
    (not recovery_review_required and recovery_hold_run_id is null)
    or (recovery_review_required and source_id = 'event.kabuki-bito.schedule'
      and candidate_kind = 'event')
  );
comment on column public.official_import_runs.publication_ordinal is
  'Reserved Kabuki publication order; NULL remains unchanged until guard activation. No historical backfill.';
comment on column public.official_import_candidates.recovery_review_required is
  'Reserved recovery review marker; current writers leave false until guard activation.';
comment on column public.official_import_candidates.recovery_hold_run_id is
  'Reserved recovery hold reference; current writers leave NULL until guard activation.';

create function public.apply_official_import_kabuki_event_candidate(
  p_candidate_id uuid,
  p_attempt_token text,
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
  p_expected_current jsonb,
  p_expected_proposed_groups jsonb
) returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  v_candidate public.official_import_candidates;
  v_event public.events;
  v_transition text;
begin
  if p_candidate_id is null or p_attempt_token is null
    or p_attempt_token is distinct from btrim(p_attempt_token)
    or char_length(p_attempt_token) not between 1 and 256 then
    raise exception 'invalid Kabuki atomic apply identity' using errcode = '22023';
  end if;

  select * into v_candidate from public.official_import_candidates where id = p_candidate_id;
  if not found or v_candidate.source_id <> 'event.kabuki-bito.schedule'
    or v_candidate.candidate_kind <> 'event' then
    raise exception 'Kabuki atomic apply candidate is missing or out of scope' using errcode = '22023';
  end if;
  if v_candidate.apply_status = 'applied' then return 'applied'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('official-import-candidates:' || v_candidate.source_id, 0)
  );
  -- Event first: owner deletion takes Event then FK-updates candidates.
  if p_event_id is not null then
    select * into v_event from public.events where id = p_event_id for update;
    if not found then
      raise exception 'reviewed Event no longer exists' using errcode = '40001';
    end if;
    if v_event.canceled_at is not null then
      raise exception 'reviewed Event is canceled' using errcode = '40001';
    end if;
  end if;
  select * into v_candidate from public.official_import_candidates where id = p_candidate_id for update;
  if not found or v_candidate.source_id <> 'event.kabuki-bito.schedule'
    or v_candidate.candidate_kind <> 'event' then
    raise exception 'Kabuki atomic apply candidate is missing or out of scope' using errcode = '22023';
  end if;
  if v_candidate.apply_status = 'applied' then return 'applied'; end if;
  if v_candidate.review_status <> 'approved' or v_candidate.reviewer is null
    or v_candidate.apply_status <> 'queued'
    or v_candidate.active_apply_attempt_token is distinct from p_attempt_token
    or v_candidate.active_apply_lease_expires_at <= clock_timestamp() then
    raise exception 'Kabuki atomic apply attempt no longer owns the candidate' using errcode = '55000';
  end if;
  if v_candidate.semantic_match_status <> 'not_used'
    or v_candidate.deterministic_match_status not in ('matched', 'unmatched')
    or (v_candidate.deterministic_match_status = 'matched' and v_candidate.resolved_event_id is null)
    or (v_candidate.deterministic_match_status = 'unmatched' and v_candidate.resolved_event_id is not null) then
    raise exception 'Kabuki atomic apply identity is not deterministic' using errcode = '22023';
  end if;
  if p_owner_id is distinct from v_candidate.reviewer
    or p_source_key is distinct from v_candidate.proposal ->> 'sourceKey'
    or p_title is distinct from v_candidate.proposal ->> 'title'
    or p_starts_on is distinct from (v_candidate.proposal ->> 'startsOn')::date
    or p_ends_on is distinct from (v_candidate.proposal ->> 'endsOn')::date
    or p_venue is distinct from v_candidate.proposal ->> 'venue'
    or p_source_url is distinct from v_candidate.proposal ->> 'sourceUrl'
    or p_memo is distinct from v_candidate.proposal ->> 'memo'
    or (p_set_genre and p_genre_key is distinct from v_candidate.proposal ->> 'genre')
    or (p_set_groups and p_groups is distinct from coalesce(v_candidate.proposal -> 'groups', '[]'::jsonb)) then
    raise exception 'Kabuki atomic apply does not match its reviewed proposal' using errcode = '22023';
  end if;
  if v_candidate.resolved_event_id is not null then
    if p_event_id is distinct from v_candidate.resolved_event_id or p_action = 'create'
      or (coalesce(v_event.source_key like 'kabuki-bito:%', false)
        and v_event.source_key is distinct from p_source_key) then
      raise exception 'Kabuki atomic apply target differs from reviewed identity' using errcode = '22023';
    end if;
  elsif p_event_id is not null then
    -- Preserve the existing positively converged create-plan case, but never
    -- permit a different source identity or a mutating substitute target.
    if p_action is distinct from 'unchanged' or v_event.source_key is distinct from p_source_key
      or p_set_genre or p_set_groups or p_occurrences is distinct from '[]'::jsonb
      or p_occurrence_fixes is distinct from '[]'::jsonb then
      raise exception 'Kabuki atomic apply target differs from reviewed identity' using errcode = '22023';
    end if;
  elsif p_action is distinct from 'create' then
    raise exception 'Kabuki atomic apply create requires an absent target' using errcode = '22023';
  end if;

  -- New occurrences must be a subset of the reviewed source facts. Existing
  -- child corrections are bound to the reviewed clock and corrected values.
  if p_occurrences is null or jsonb_typeof(p_occurrences) <> 'array'
    or p_occurrence_fixes is null or jsonb_typeof(p_occurrence_fixes) <> 'array' then
    raise exception 'Kabuki atomic apply occurrence arguments are invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_occurrences) as incoming("startsAt" timestamptz, "endsAt" timestamptz, "doorsAt" timestamptz)
    where not exists (
      select 1 from jsonb_to_recordset(coalesce(v_candidate.proposal -> 'occurrences', '[]'::jsonb))
        as reviewed("startsAt" timestamptz, "endsAt" timestamptz, "doorsAt" timestamptz)
      where (incoming."startsAt", incoming."endsAt", incoming."doorsAt")
        is not distinct from (reviewed."startsAt", reviewed."endsAt", reviewed."doorsAt")
    )
  ) or exists (
    select 1 from jsonb_array_elements(p_occurrence_fixes) fix
    where not exists (
      select 1 from public.event_occurrences occurrence
      cross join jsonb_to_recordset(coalesce(v_candidate.proposal -> 'occurrences', '[]'::jsonb))
        as reviewed("startsAt" timestamptz, "endsAt" timestamptz, "doorsAt" timestamptz)
      where occurrence.id = (fix ->> 'id')::uuid and occurrence.event_id = p_event_id
        and occurrence.starts_at = reviewed."startsAt"
        and (not (fix ? 'endsAt') or (fix ->> 'endsAt')::timestamptz is not distinct from reviewed."endsAt")
        and (not (fix ? 'doorsAt') or (fix ->> 'doorsAt')::timestamptz is not distinct from reviewed."doorsAt")
    )
  ) then
    raise exception 'Kabuki atomic apply occurrences differ from reviewed facts' using errcode = '22023';
  end if;

  perform set_config('stage_tracker.official_import_atomic_candidate_id', p_candidate_id::text, true);
  perform set_config('stage_tracker.official_import_atomic_attempt_token', p_attempt_token, true);
  perform set_config('stage_tracker.official_import_atomic_event_id', coalesce(p_event_id::text, ''), true);
  select * into v_event from public.apply_reviewed_import_event_plan(
    p_action, p_owner_id, p_event_id, p_source_key, p_title, p_starts_on, p_ends_on,
    p_occurrences, p_occurrence_fixes, p_venue, p_source_url, p_memo,
    p_set_genre, p_genre_key, p_set_groups, p_groups, p_expected_current, p_expected_proposed_groups
  );
  -- A caller cannot mark an unapplied proposal as converged by supplying false
  -- write flags or omitting a reviewed occurrence. Keep the standard import's
  -- retention of additional existing children and unknown optional end/doors.
  if v_event.title is distinct from p_title or v_event.venue is distinct from p_venue
    or v_event.source_url is distinct from p_source_url or v_event.memo is distinct from p_memo
    or v_event.starts_on is distinct from p_starts_on or v_event.ends_on is distinct from p_ends_on
    or (v_candidate.proposal ? 'genre' and
      (select key from public.genres where id = v_event.genre_id)
        is distinct from v_candidate.proposal ->> 'genre')
    or (v_candidate.proposal ? 'groups' and (
      exists (select key, display_name from public.groups g
        join public.event_groups eg on eg.group_id = g.id where eg.event_id = v_event.id
        except select key, "displayName" from jsonb_to_recordset(v_candidate.proposal -> 'groups')
          as proposed(key text, "displayName" text))
      or exists (select key, "displayName" from jsonb_to_recordset(v_candidate.proposal -> 'groups')
          as proposed(key text, "displayName" text)
        except select key, display_name from public.groups g
          join public.event_groups eg on eg.group_id = g.id where eg.event_id = v_event.id)
    )) or exists (
      select 1 from jsonb_to_recordset(coalesce(v_candidate.proposal -> 'occurrences', '[]'::jsonb))
        as proposed("startsAt" timestamptz, "endsAt" timestamptz, "doorsAt" timestamptz)
      where not exists (select 1 from public.event_occurrences actual
        where actual.event_id = v_event.id and actual.starts_at = proposed."startsAt"
          and (proposed."endsAt" is null or actual.ends_at = proposed."endsAt")
          and (proposed."doorsAt" is null or actual.doors_at = proposed."doorsAt"))
    ) then
    raise exception 'Kabuki atomic apply did not realize its reviewed facts' using errcode = '22023';
  end if;
  v_transition := public.complete_official_import_candidate_apply(p_candidate_id, p_attempt_token);
  if v_transition <> 'applied' then
    raise exception 'Kabuki atomic completion did not commit' using errcode = '55000';
  end if;
  perform set_config('stage_tracker.official_import_atomic_candidate_id', '', true);
  perform set_config('stage_tracker.official_import_atomic_attempt_token', '', true);
  perform set_config('stage_tracker.official_import_atomic_event_id', '', true);
  return 'applied';
end;
$$;
revoke execute on function public.apply_official_import_kabuki_event_candidate(uuid, text, text, uuid, uuid, text, text, date, date, jsonb, jsonb, text, text, text, boolean, text, boolean, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_official_import_kabuki_event_candidate(uuid, text, text, uuid, uuid, text, text, date, date, jsonb, jsonb, text, text, text, boolean, text, boolean, jsonb, jsonb, jsonb) to service_role;
