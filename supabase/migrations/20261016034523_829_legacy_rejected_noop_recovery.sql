-- #829: an explicitly rejected legacy proposal is not an unresolved hold when
-- a fresh, deterministic observation is exactly the current catalog. This is a
-- predicate only: it never changes catalog, review, apply, or publication order.
-- Migration ordering: additive (existing false/NULL consumers are compatible).
create or replace function private.official_import_kabuki_legacy_rejected_noop_internal(
  p_candidate public.official_import_candidates
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_path text[];
  v_event public.events;
  v_occurrence jsonb;
  v_starts timestamptz;
  v_ends timestamptz;
  v_doors timestamptz;
  v_seen timestamptz[] := '{}';
begin
  if p_candidate.source_id is distinct from 'event.kabuki-bito.schedule'
    or p_candidate.candidate_kind is distinct from 'event'
    or p_candidate.proposal_version is distinct from 'event.v1'
    or p_candidate.deterministic_match_status is distinct from 'matched'
    or p_candidate.semantic_match_status is distinct from 'not_used'
    or p_candidate.resolved_event_id is null
    or p_candidate.resolved_ticket_opportunity_id is not null
    or p_candidate.recovery_hold_run_id is not null
    or p_candidate.plan_summary is distinct from
      '{"version":"event_plan.v1","action":"unchanged","detailsChanged":false,"rangeChanged":false,"newOccurrenceCount":0,"endsAtFixCount":0,"doorsAtFixCount":0,"keptOccurrenceCount":0,"genreChanged":false,"groupsChanged":false}'::jsonb
    or jsonb_typeof(p_candidate.proposal -> 'occurrences') is distinct from 'array'
    -- Future/unknown fields (including classification changes) fail closed.
    or p_candidate.proposal - array['sourceKey','title','startsOn','endsOn','venue','sourceUrl','memo','occurrences'] <> '{}'::jsonb
    or not (p_candidate.proposal ?& array['sourceKey','title','startsOn','endsOn','venue','sourceUrl','memo','occurrences']) then
    return false;
  end if;

  if exists (select 1 from jsonb_each(p_candidate.proposal) field
    where (field.key in ('sourceKey','title','startsOn','endsOn','sourceUrl')
        and jsonb_typeof(field.value) <> 'string')
      or (field.key in ('venue','memo') and jsonb_typeof(field.value) not in ('string','null'))) then
    return false;
  end if;

  v_path := pg_catalog.regexp_match(p_candidate.canonical_url,
    '^https://www\.kabuki-bito\.jp/theaters/([^/?#]+)/play/([0-9]+)/?$');
  if v_path is null or v_path[2] is distinct from p_candidate.official_external_id
    or p_candidate.proposal ->> 'sourceKey' is distinct from
      ('kabuki-bito:' || v_path[1] || ':play:' || v_path[2])
    or p_candidate.proposal ->> 'sourceUrl' is distinct from p_candidate.canonical_url then
    return false;
  end if;

  -- Callers already hold the source lock. Lock the parent before children so
  -- catalog edits/FK inserts cannot race the equality proof and suppression.
  select * into v_event from public.events where id = p_candidate.resolved_event_id for update;
  if not found or v_event.canceled_at is not null
    or not exists (select 1 from public.catalog_creators where user_id = v_event.owner_id)
    or v_event.source_key is distinct from p_candidate.proposal ->> 'sourceKey'
    or v_event.title is distinct from p_candidate.proposal ->> 'title'
    or v_event.venue is distinct from p_candidate.proposal ->> 'venue'
    or v_event.source_url is distinct from p_candidate.proposal ->> 'sourceUrl'
    or v_event.memo is distinct from p_candidate.proposal ->> 'memo'
    or p_candidate.proposal ->> 'startsOn' is distinct from to_char(v_event.starts_on, 'YYYY-MM-DD')
    or p_candidate.proposal ->> 'endsOn' is distinct from to_char(v_event.ends_on, 'YYYY-MM-DD') then
    return false;
  end if;

  -- Any actual held history or conflicting identity remains a recovery gate,
  -- even when a different episode was previously resolved.
  if exists (select 1 from public.official_import_held_pages h
      where h.source_id = p_candidate.source_id
        and (h.official_external_id = p_candidate.official_external_id
          or h.canonical_url = p_candidate.canonical_url))
    or exists (select 1 from public.official_import_candidates c
      where c.source_id = p_candidate.source_id and c.candidate_kind = 'event'
        and ((c.official_external_id = p_candidate.official_external_id
            and c.canonical_url is distinct from p_candidate.canonical_url)
          or (c.canonical_url = p_candidate.canonical_url
            and c.official_external_id is distinct from p_candidate.official_external_id))) then
    return false;
  end if;

  -- Every non-applied legacy row must be an explicit rejection of this exact
  -- normalized proposal by the current catalog owner. Its old plan can have
  -- been 'create'; catalog convergence, not a fabricated apply, is the proof.
  if not exists (select 1 from public.official_import_candidates c
      join public.official_import_runs r on r.id = c.run_id
      where c.source_id = p_candidate.source_id and c.candidate_kind = 'event'
        and c.official_external_id = p_candidate.official_external_id
        and c.canonical_url = p_candidate.canonical_url
        and r.status = 'completed' and r.publication_ordinal is null and r.source_id = c.source_id
        and c.review_status = 'rejected' and c.apply_status = 'not_started'
        and c.reviewer = v_event.owner_id and c.reviewed_at is not null
        and c.proposal_version = p_candidate.proposal_version
        and c.proposal = p_candidate.proposal)
    or exists (select 1 from public.official_import_candidates c
      join public.official_import_runs r on r.id = c.run_id
      where c.source_id = p_candidate.source_id and c.candidate_kind = 'event'
        and c.official_external_id = p_candidate.official_external_id
        and c.canonical_url = p_candidate.canonical_url
        and r.status = 'completed' and r.publication_ordinal is null
        and c.apply_status <> 'applied'
        and not (r.source_id = c.source_id and c.review_status = 'rejected' and c.apply_status = 'not_started'
          and c.reviewer = v_event.owner_id and c.reviewed_at is not null
          and c.proposal_version = p_candidate.proposal_version
          and c.proposal = p_candidate.proposal))
    -- Do not reinterpret a recovery that a human has already approved or an
    -- apply that is queued/failed. Pending-only metadata repair is separate.
    or exists (select 1 from public.official_import_candidates c
      where c.source_id = p_candidate.source_id and c.candidate_kind = 'event'
        and c.official_external_id = p_candidate.official_external_id
        and c.canonical_url = p_candidate.canonical_url
        and c.recovery_review_required and c.review_status = 'approved'
        and c.apply_status <> 'applied' and c.dismissed_at is null) then
    return false;
  end if;

  perform 1 from public.event_occurrences where event_id = v_event.id for share;
  -- Compare all occurrences, not merely the planner's summary. A duplicate,
  -- missing, extra, canceled, or changed occurrence cannot be a proven no-op.
  for v_occurrence in select value from jsonb_array_elements(p_candidate.proposal -> 'occurrences') loop
    if jsonb_typeof(v_occurrence) is distinct from 'object'
      or v_occurrence - array['startsAt','endsAt','doorsAt'] <> '{}'::jsonb
      or not (v_occurrence ? 'startsAt')
      or coalesce(v_occurrence ->> 'startsAt', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
      or (v_occurrence ->> 'endsAt' is not null and v_occurrence ->> 'endsAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$')
      or (v_occurrence ->> 'doorsAt' is not null and v_occurrence ->> 'doorsAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$') then
      return false;
    end if;
    v_starts := (v_occurrence ->> 'startsAt')::timestamptz;
    v_ends := (v_occurrence ->> 'endsAt')::timestamptz;
    v_doors := (v_occurrence ->> 'doorsAt')::timestamptz;
    if v_starts = any(v_seen) or not exists (
      select 1 from public.event_occurrences o where o.event_id = v_event.id
        and o.starts_at = v_starts and o.ends_at is not distinct from v_ends
        and o.doors_at is not distinct from v_doors and o.canceled_at is null
    ) then
      return false;
    end if;
    v_seen := array_append(v_seen, v_starts);
  end loop;
  return cardinality(v_seen) = (select count(*) from public.event_occurrences where event_id = v_event.id);
exception when invalid_datetime_format or datetime_field_overflow then
  return false;
end;
$$;

revoke all on function private.official_import_kabuki_legacy_rejected_noop_internal(public.official_import_candidates)
  from public, anon, authenticated;
grant execute on function private.official_import_kabuki_legacy_rejected_noop_internal(public.official_import_candidates)
  to service_role;


create or replace function private.official_import_kabuki_recovery_marker_internal(
  p_source_id text,
  p_candidate_kind text,
  p_official_external_id text,
  p_canonical_url text,
  p_content_hash text,
  p_proposal_version text,
  p_plan_fingerprint text
) returns table (
  recovery_review_required boolean,
  recovery_hold_run_id uuid,
  same_open_proposal boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_path text[];
  v_known_hold_run_id uuid;
  v_legacy_unresolved boolean := false;
begin
  if p_source_id is distinct from 'event.kabuki-bito.schedule'
    or p_candidate_kind is distinct from 'event' then
    return query select false, null::uuid, false;
    return;
  end if;

  v_path := pg_catalog.regexp_match(
    p_canonical_url,
    '^https://www\.kabuki-bito\.jp/theaters/([^/?#]+)/play/([0-9]+)/?$'
  );
  if p_official_external_id is null
    or v_path is null
    or v_path[2] is distinct from p_official_external_id then
    raise exception 'Kabuki work identity is not canonical'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.official_import_candidates as prior
    where prior.source_id = p_source_id
      and prior.candidate_kind = p_candidate_kind
      and (
        (prior.official_external_id = p_official_external_id
          and prior.canonical_url is distinct from p_canonical_url)
        or (prior.canonical_url = p_canonical_url
          and prior.official_external_id is distinct from p_official_external_id)
      )
  ) or exists (
    select 1 from public.official_import_held_pages as prior
    where prior.source_id = p_source_id
      and (
        (prior.official_external_id = p_official_external_id
          and prior.canonical_url is distinct from p_canonical_url)
        or (prior.canonical_url = p_canonical_url
          and prior.official_external_id is distinct from p_official_external_id)
      )
  ) then
    raise exception 'Kabuki official ID conflicts with its canonical work URL'
      using errcode = '22023';
  end if;

  select held.run_id into v_known_hold_run_id
  from public.official_import_held_pages as held
  join public.official_import_runs as held_run on held_run.id = held.run_id
  where held.source_id = p_source_id
    and held.official_external_id = p_official_external_id
    and held.canonical_url = p_canonical_url
    and held_run.status = 'completed'
    and held_run.publication_ordinal is not null
    and not exists (
      select 1
      from public.official_import_candidates as resolution
      join public.official_import_runs as resolution_run on resolution_run.id = resolution.run_id
      join public.official_import_runs as resolved_hold on resolved_hold.id = resolution.recovery_hold_run_id
      where resolution.source_id = p_source_id
        and resolution.candidate_kind = p_candidate_kind
        and resolution.official_external_id = p_official_external_id
        and resolution.canonical_url = p_canonical_url
        and resolution.recovery_review_required
        and resolved_hold.publication_ordinal >= held_run.publication_ordinal
        and resolution_run.publication_ordinal > held_run.publication_ordinal
        and (
          resolution.review_status = 'rejected'
          or resolution.apply_status = 'applied'
          or (resolution.apply_status = 'failed' and resolution.dismissed_at is not null)
        )
    )
  order by held_run.publication_ordinal desc
  limit 1;

  select (
    exists (
      select 1
      from public.official_import_held_pages as held
      join public.official_import_runs as held_run on held_run.id = held.run_id
      where held.source_id = p_source_id
        and held.official_external_id = p_official_external_id
        and held.canonical_url = p_canonical_url
        and held_run.status = 'completed'
        and held_run.publication_ordinal is null
    )
    or exists (
      select 1
      from public.official_import_candidates as legacy
      join public.official_import_runs as legacy_run on legacy_run.id = legacy.run_id
      where legacy.source_id = p_source_id
        and legacy.candidate_kind = p_candidate_kind
        and legacy.official_external_id = p_official_external_id
        and legacy.canonical_url = p_canonical_url
        and legacy_run.status = 'completed'
        and legacy_run.publication_ordinal is null
        and legacy.apply_status <> 'applied'
    )
    or exists (
      select 1
      from public.official_import_candidates as open_legacy
      join public.official_import_runs as open_legacy_run on open_legacy_run.id = open_legacy.run_id
      where open_legacy.source_id = p_source_id
        and open_legacy.candidate_kind = p_candidate_kind
        and open_legacy.official_external_id = p_official_external_id
        and open_legacy.canonical_url = p_canonical_url
        and open_legacy.recovery_review_required
        and open_legacy.recovery_hold_run_id is null
        and open_legacy_run.publication_ordinal is not null
        and not (
          open_legacy.review_status = 'rejected'
          or open_legacy.apply_status = 'applied'
          or (open_legacy.apply_status = 'failed' and open_legacy.dismissed_at is not null)
        )
    )
  ) and not exists (
    select 1
    from public.official_import_candidates as resolution
    join public.official_import_runs as resolution_run on resolution_run.id = resolution.run_id
    where resolution.source_id = p_source_id
      and resolution.candidate_kind = p_candidate_kind
      and resolution.official_external_id = p_official_external_id
      and resolution.canonical_url = p_canonical_url
      and resolution.recovery_review_required
      and resolution_run.publication_ordinal is not null
      and (
        resolution.review_status = 'rejected'
        or resolution.apply_status = 'applied'
        or (resolution.apply_status = 'failed' and resolution.dismissed_at is not null)
      )
  ) into v_legacy_unresolved;

  -- A persisted metadata-only reconciliation is valid only while the exact
  -- proposal still equals catalog. Catalog drift restores the freshness gate.
  if v_known_hold_run_id is null and v_legacy_unresolved and exists (
    select 1 from public.official_import_candidates existing
    join public.official_import_runs existing_run on existing_run.id = existing.run_id
    where existing.source_id = p_source_id and existing.candidate_kind = p_candidate_kind
      and existing.official_external_id = p_official_external_id
      and existing.canonical_url = p_canonical_url
      and existing.content_hash = p_content_hash
      and existing.proposal_version = p_proposal_version
      and existing.plan_fingerprint = p_plan_fingerprint
      and not existing.recovery_review_required
      and existing_run.status = 'completed' and existing_run.publication_ordinal is not null
      and private.official_import_kabuki_legacy_rejected_noop_internal(existing)
  ) then
    v_legacy_unresolved := false;
  end if;

  return query
  select (v_known_hold_run_id is not null or v_legacy_unresolved),
    v_known_hold_run_id,
    (v_known_hold_run_id is not null or v_legacy_unresolved) and exists (
      select 1
      from public.official_import_candidates as existing
      join public.official_import_runs as existing_run on existing_run.id = existing.run_id
      where existing.source_id = p_source_id
        and existing.candidate_kind = p_candidate_kind
        and existing.official_external_id = p_official_external_id
        and existing.canonical_url = p_canonical_url
        and existing.recovery_review_required
        -- Force a fresh publication instead of retaining a stale legacy-only
        -- pending marker when catalog has since converged to the rejected facts.
        and not (existing.review_status = 'pending' and existing.apply_status = 'not_started'
          and v_known_hold_run_id is null
          and private.official_import_kabuki_legacy_rejected_noop_internal(existing))
        and existing.recovery_hold_run_id is not distinct from v_known_hold_run_id
        and existing.content_hash = p_content_hash
        and existing.proposal_version = p_proposal_version
        and existing.plan_fingerprint = p_plan_fingerprint
        and existing_run.status = 'completed'
        and existing_run.publication_ordinal is not null
        and (
          v_known_hold_run_id is null
          or existing_run.publication_ordinal > (
            select held_run.publication_ordinal
            from public.official_import_runs as held_run
            where held_run.id = v_known_hold_run_id
          )
        )
        and not (
          existing.review_status = 'rejected'
          or existing.apply_status = 'applied'
          or (existing.apply_status = 'failed' and existing.dismissed_at is not null)
        )
    );
end;
$$;

create or replace function public.enforce_official_import_candidate_insert() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_run_status text;
  v_run_source_id text;
  v_cleanup_run_id text := current_setting(
    'stage_tracker.official_import_batch_run_id',
    true
  );
  v_attempt_run_id text := current_setting('stage_tracker.official_import_attempt_run_id', true);
  v_attempt_token text := current_setting('stage_tracker.official_import_attempt_token', true);
  v_publication_ordinal text := nullif(
    current_setting('stage_tracker.official_import_publication_ordinal', true), ''
  );
  v_run_attempt_token text;
  v_path text[];
  v_recovery record;
begin
  select run.status, run.source_id, run.active_attempt_token
    into v_run_status, v_run_source_id, v_run_attempt_token
  from public.official_import_runs as run
  where run.id = new.run_id
  for update;

  if not found then
    raise exception 'candidate parent import run is missing'
      using errcode = '23514';
  end if;

  if new.source_id is distinct from v_run_source_id then
    raise exception 'candidate source_id must match its import run'
      using errcode = '23514';
  end if;

  if new.source_id = 'event.kabuki-bito.schedule'
    and new.candidate_kind = 'event'
    and v_publication_ordinal is not null then
    if v_attempt_run_id is distinct from new.run_id::text
      or v_attempt_token is null
      or v_run_attempt_token is distinct from v_attempt_token
      or new.official_external_id is null then
      raise exception 'Kabuki recovery metadata requires the owned publisher scope'
        using errcode = '23514';
    end if;
    v_path := pg_catalog.regexp_match(
      new.canonical_url,
      '^https://www\.kabuki-bito\.jp/theaters/([^/?#]+)/play/([0-9]+)/?$'
    );
    if v_path is null
      or v_path[2] is distinct from new.official_external_id
      or new.proposal ->> 'sourceKey' is distinct from
        ('kabuki-bito:' || v_path[1] || ':play:' || v_path[2])
      or new.proposal ->> 'sourceUrl' is distinct from new.canonical_url then
      raise exception 'Kabuki candidate identity does not match its canonical work URL'
        using errcode = '22023';
    end if;
    select * into v_recovery
    from private.official_import_kabuki_recovery_marker_internal(
      new.source_id, new.candidate_kind, new.official_external_id,
      new.canonical_url, new.content_hash, new.proposal_version, new.plan_fingerprint
    );
    new.recovery_review_required := v_recovery.recovery_review_required;
    new.recovery_hold_run_id := v_recovery.recovery_hold_run_id;
    if new.recovery_review_required and new.recovery_hold_run_id is null
      and private.official_import_kabuki_legacy_rejected_noop_internal(new) then
      new.recovery_review_required := false;
    end if;
  elsif new.recovery_review_required or new.recovery_hold_run_id is not null then
    raise exception 'recovery metadata must be derived by the owned Kabuki publisher'
      using errcode = '23514';
  end if;

  if v_run_status <> 'running'
    or (
      new.review_status <> 'pending'
      and not (
        new.review_status = 'blocked_for_identity_review'
        and v_cleanup_run_id is not null
        and v_cleanup_run_id = new.run_id::text
      )
    )
    or new.reviewer is not null
    or new.reviewed_at is not null
    or new.apply_status <> 'not_started'
    or new.applied_at is not null
    or new.failure_classification is not null then
    raise exception 'candidates must enter a non-reviewed and not_started state'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Keep freshness callers compatible with the catalog-locking proof above.
create or replace function public.review_official_import_candidate(
  p_candidate_id uuid,
  p_review_status text
) returns public.official_import_candidates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate public.official_import_candidates;
  v_actor uuid := auth.uid();
  v_source_id text;
  v_candidate_kind text;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_review_status is null or p_review_status not in ('approved', 'rejected') then
    raise exception 'review status must be approved or rejected'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.catalog_creators cc where cc.user_id = v_actor
  ) then
    raise exception 'review is restricted to designated catalog creators'
      using errcode = '42501';
  end if;

  select candidate.source_id, candidate.candidate_kind
    into v_source_id, v_candidate_kind
  from public.official_import_candidates as candidate
  where candidate.id = p_candidate_id;
  if found
    and v_source_id = 'event.kabuki-bito.schedule'
    and v_candidate_kind = 'event' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('official-import-candidates:' || v_source_id, 0)
    );
    -- Freshness can prove a reconciled no-op against catalog. Match atomic
    -- apply's source -> Event -> candidate order so owner deletion's FK
    -- SET NULL cannot wait on a candidate that is itself waiting on Event.
    if p_review_status = 'approved' then
      perform 1
      from public.events as event
      join public.official_import_candidates as candidate
        on candidate.resolved_event_id = event.id
      where candidate.id = p_candidate_id and candidate.review_status = 'pending'
      for update of event;
    end if;
  end if;

  select * into v_candidate
  from public.official_import_candidates
  where id = p_candidate_id
    and (
      review_status = 'pending'
      or (
        p_review_status = 'rejected'
        and candidate_kind = 'ticket_opportunity'
        and review_status = 'blocked_for_identity_review'
      )
    )
  for update;

  if not found then
    raise exception 'official import candidate is missing or no longer reviewable'
      using errcode = '22023';
  end if;
  if p_review_status = 'approved'
    and v_candidate.source_id = 'event.kabuki-bito.schedule'
    and v_candidate.candidate_kind = 'event'
    and not private.official_import_kabuki_candidate_fresh_internal(v_candidate.id) then
    raise exception 'Kabuki candidate is not based on a fresh committed observation'
      using errcode = '40001', detail = 'stage_tracker.kabuki_freshness_refused.v1';
  end if;

  if p_review_status = 'approved'
    and v_candidate.semantic_match_status <> 'not_used' then
    raise exception 'Jev-dependent identity requires deterministic resolution before approval'
      using errcode = '22023';
  end if;

  if p_review_status = 'approved'
    and v_candidate.candidate_kind = 'event'
    and v_candidate.resolved_event_id is not null
    and not exists (
      select 1 from public.events e
      where e.id = v_candidate.resolved_event_id and e.owner_id = v_actor
    ) then
    raise exception 'only the matched Event owner may approve its import'
      using errcode = '42501';
  end if;

  update public.official_import_candidates as candidate
  set review_status = p_review_status,
      reviewer = v_actor,
      reviewed_at = now()
  from public.official_import_runs as run
  where candidate.id = p_candidate_id
    and (
      candidate.review_status = 'pending'
      or (
        p_review_status = 'rejected'
        and candidate.candidate_kind = 'ticket_opportunity'
        and candidate.review_status = 'blocked_for_identity_review'
      )
    )
    and run.id = candidate.run_id
    and run.status = 'completed'
  returning candidate.* into v_candidate;

  if not found then
    raise exception 'official import candidate is missing or no longer reviewable'
      using errcode = '22023';
  end if;

  return v_candidate;
end;
$$;

create or replace function public.claim_official_import_candidate_apply(
  p_candidate_id uuid,
  p_attempt_token text,
  p_lease_seconds integer
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_candidate public.official_import_candidates;
  v_source_id text;
  v_candidate_kind text;
begin
  if p_candidate_id is null
    or p_attempt_token is null
    or p_attempt_token is distinct from btrim(p_attempt_token)
    or char_length(p_attempt_token) not between 1 and 256
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 3600 then
    raise exception 'invalid official import candidate apply claim'
      using errcode = '22023';
  end if;

  select candidate.source_id, candidate.candidate_kind
    into v_source_id, v_candidate_kind
  from public.official_import_candidates as candidate
  where candidate.id = p_candidate_id;
  if found
    and v_source_id = 'event.kabuki-bito.schedule'
    and v_candidate_kind = 'event' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('official-import-candidates:' || v_source_id, 0)
    );
    -- Acquire catalog before candidate, as in review/atomic apply. Applied
    -- replay stays inert and does not acquire an additional catalog lock.
    perform 1
    from public.events as event
    join public.official_import_candidates as candidate
      on candidate.resolved_event_id = event.id
    where candidate.id = p_candidate_id and candidate.review_status = 'approved'
      and candidate.apply_status <> 'applied'
    for update of event;
  end if;

  select candidate.* into v_candidate
  from public.official_import_candidates as candidate
  where candidate.id = p_candidate_id
  for update;

  if not found then
    raise exception 'official import candidate is missing'
      using errcode = '22023';
  end if;

  if v_candidate.apply_status = 'applied' then
    return 'applied';
  end if;
  if v_candidate.review_status = 'approved'
    and v_candidate.source_id = 'event.kabuki-bito.schedule'
    and v_candidate.candidate_kind = 'event'
    and not private.official_import_kabuki_candidate_fresh_internal(v_candidate.id) then
    raise exception 'Kabuki candidate is not based on a fresh committed observation'
      using errcode = '40001', detail = 'stage_tracker.kabuki_freshness_refused.v1';
  end if;
  if v_candidate.review_status <> 'approved' then
    return 'not_approved';
  end if;
  if v_candidate.apply_status = 'queued'
    and v_candidate.active_apply_attempt_token is not null
    and v_candidate.active_apply_attempt_token is distinct from p_attempt_token
    and v_candidate.active_apply_lease_expires_at > clock_timestamp() then
    return 'busy';
  end if;

  perform set_config(
    'stage_tracker.official_import_apply_candidate_id',
    p_candidate_id::text,
    true
  );
  perform set_config(
    'stage_tracker.official_import_apply_attempt_token',
    p_attempt_token,
    true
  );

  update public.official_import_candidates as candidate
  set apply_status = 'queued',
      applied_at = null,
      failure_classification = null,
      active_apply_attempt_token = p_attempt_token,
      active_apply_lease_expires_at =
        clock_timestamp() + p_lease_seconds * interval '1 second'
  where candidate.id = p_candidate_id;

  perform set_config('stage_tracker.official_import_apply_attempt_token', '', true);
  perform set_config('stage_tracker.official_import_apply_candidate_id', '', true);

  return 'claimed';
end;
$$;

-- Reconcile saved pending metadata under the publisher's source lock. The
-- temporary guard exception exists only inside this migration transaction; the
-- exact original trigger definition is restored before commit. No trigger is
-- disabled and there is no persistent maintenance API/GUC permission path.
do $repair$
declare
  v_original text;
  v_scoped text;
  v_candidate public.official_import_candidates;
  v_needle text := $needle$if old.recovery_review_required is distinct from new.recovery_review_required
      or old.recovery_hold_run_id is distinct from new.recovery_hold_run_id then$needle$;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('official-import-candidates:event.kabuki-bito.schedule', 0));
  -- Block concurrent catalog edits while checking complete occurrence equality;
  -- source serialization already blocks publisher/review/apply/hold mutations.
  lock table public.events, public.event_occurrences in share mode;
  lock table public.official_import_candidates in share row exclusive mode;
  select pg_catalog.pg_get_functiondef('public.enforce_official_import_candidate_state()'::regprocedure)
    into v_original;
  if position(v_needle in v_original) = 0
    or position(v_needle in substring(v_original from position(v_needle in v_original) + length(v_needle))) > 0 then
    raise exception 'unexpected candidate recovery guard definition';
  end if;
  v_scoped := replace(v_original, v_needle, $scope$if (
      old.recovery_review_required is distinct from new.recovery_review_required
      or old.recovery_hold_run_id is distinct from new.recovery_hold_run_id
    ) and not (
      current_setting('stage_tracker.legacy_noop_reconcile_candidate', true) = old.id::text
      and old.recovery_review_required and not new.recovery_review_required
      and old.recovery_hold_run_id is null and new.recovery_hold_run_id is null
      and old.review_status = 'pending' and old.apply_status = 'not_started'
      and (to_jsonb(old) - array['recovery_review_required','updated_at'])
        = (to_jsonb(new) - array['recovery_review_required','updated_at'])
      and private.official_import_kabuki_legacy_rejected_noop_internal(old)
    ) then$scope$);
  execute v_scoped;
  for v_candidate in
    select c.* from public.official_import_candidates c
    join public.official_import_runs r on r.id = c.run_id
    where c.source_id = 'event.kabuki-bito.schedule' and c.candidate_kind = 'event'
      and c.review_status = 'pending' and c.apply_status = 'not_started'
      and c.recovery_review_required and c.recovery_hold_run_id is null
      and r.status = 'completed' and r.source_id = c.source_id and r.publication_ordinal is not null
      and private.official_import_kabuki_legacy_rejected_noop_internal(c)
    order by c.id for update of c
  loop
    perform set_config('stage_tracker.legacy_noop_reconcile_candidate', v_candidate.id::text, true);
    update public.official_import_candidates set recovery_review_required = false
      where id = v_candidate.id;
  end loop;
  perform set_config('stage_tracker.legacy_noop_reconcile_candidate', '', true);
  execute v_original;
end;
$repair$;
