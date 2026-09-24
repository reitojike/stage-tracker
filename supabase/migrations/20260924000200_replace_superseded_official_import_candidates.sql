-- Issue #634: keep one actionable review proposal per official source identity.
-- A changed observation replaces only pending or approved-but-unapplied rows.
-- Applied, queued, failed, and rejected rows remain as history. Catalog rows
-- and completed run records are never removed. No historical bulk cleanup is
-- attempted: existing duplicates need an observed-data decision separately.
-- Rejected decisions are reused only within the current apply epoch; an older
-- rejection cannot hide a new change after another proposal was applied.
--
-- Migration ordering: additive. Existing RPC signatures and results remain.

create or replace function public.enforce_official_import_candidate_delete() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_run_status text;
  v_cleanup_run_id text := current_setting(
    'stage_tracker.official_import_batch_run_id', true
  );
  v_superseding_run_id text := current_setting(
    'stage_tracker.official_import_superseding_run_id', true
  );
begin
  select run.status into v_run_status
  from public.official_import_runs as run
  where run.id = old.run_id
  for update;

  if not found then
    raise exception 'candidate parent import run is missing'
      using errcode = '23514';
  end if;

  -- Preserve the same-run retry cleanup rule.
  if v_run_status = 'running'
    and old.apply_status = 'not_started'
    and (
      old.review_status = 'pending'
      or (
        old.review_status = 'blocked_for_identity_review'
        and v_cleanup_run_id = old.run_id::text
      )
    ) then
    return old;
  end if;

  -- A completed proposal may be removed only inside the batch transaction
  -- that has already inserted its exact-source replacement candidate.
  if v_run_status = 'completed'
    and old.apply_status = 'not_started'
    and old.review_status in ('pending', 'approved', 'blocked_for_identity_review')
    and exists (
      select 1
      from public.official_import_candidates as replacement
      join public.official_import_runs as replacement_run
        on replacement_run.id = replacement.run_id
      where replacement.run_id::text = v_superseding_run_id
        and replacement_run.status = 'running'
        and replacement.source_id = old.source_id
        and replacement.candidate_kind = old.candidate_kind
        and (
          (old.official_external_id is not null
            and replacement.official_external_id = old.official_external_id)
          or (old.official_external_id is null
            and replacement.official_external_id is null
            and replacement.canonical_url = old.canonical_url)
        )
    ) then
    return old;
  end if;

  raise exception 'only replaceable candidates may be deleted'
    using errcode = '23514';
end;
$$;

create or replace function public.commit_official_import_candidate_batch(
  p_run_id uuid,
  p_source_id text,
  p_candidates jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run_status text;
  v_run_source_id text;
  v_candidate_count integer;
begin
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'official import candidates must be a JSON array'
      using errcode = '22023';
  end if;

  select run.status, run.source_id into v_run_status, v_run_source_id
  from public.official_import_runs as run
  where run.id = p_run_id
  for update;

  if not found then
    raise exception 'official import run is missing'
      using errcode = '22023';
  end if;
  if v_run_source_id is distinct from p_source_id then
    raise exception 'official import run source does not match'
      using errcode = '22023';
  end if;
  if v_run_status = 'completed' then
    select count(*)::integer into v_candidate_count
    from public.official_import_candidates as candidate
    where candidate.run_id = p_run_id;
    return v_candidate_count;
  end if;
  if v_run_status <> 'running' then
    raise exception 'official import run is not writable'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('official-import-candidates:' || p_source_id, 0)
  );

  -- One observation per source identity is required even when one of the
  -- duplicate versions would otherwise be suppressed as unchanged.
  if exists (
    select 1
    from jsonb_to_recordset(p_candidates) as candidate(
      candidate_kind text, canonical_url text, official_external_id text
    )
    group by candidate.candidate_kind,
      (candidate.official_external_id is null),
      coalesce(candidate.official_external_id, candidate.canonical_url)
    having count(*) > 1
  ) then
    raise exception 'official import batch contains duplicate source identities'
      using errcode = '22023';
  end if;

  perform set_config('stage_tracker.official_import_batch_run_id', p_run_id::text, true);
  delete from public.official_import_candidates as candidate
  where candidate.run_id = p_run_id;

  insert into public.official_import_candidates (
    run_id, source_id, candidate_kind, canonical_url, official_external_id,
    observed_at, content_hash, etag, last_modified, proposal_version,
    proposal, evidence_locator, deterministic_match_status,
    semantic_match_status, resolved_event_id, resolved_ticket_opportunity_id,
    jev_decision_evidence, plan_summary, plan_fingerprint, review_status
  )
  select
    p_run_id, p_source_id, candidate.candidate_kind, candidate.canonical_url,
    candidate.official_external_id, candidate.observed_at,
    candidate.content_hash, candidate.etag, candidate.last_modified,
    candidate.proposal_version, candidate.proposal, candidate.evidence_locator,
    candidate.deterministic_match_status, candidate.semantic_match_status,
    candidate.resolved_event_id, candidate.resolved_ticket_opportunity_id,
    candidate.jev_decision_evidence, candidate.plan_summary,
    candidate.plan_fingerprint, candidate.review_status
  from jsonb_to_recordset(p_candidates) as candidate(
    candidate_kind text, canonical_url text, official_external_id text,
    observed_at timestamptz, content_hash text, etag text, last_modified text,
    proposal_version text, proposal jsonb, evidence_locator jsonb,
    deterministic_match_status text, semantic_match_status text,
    resolved_event_id uuid, resolved_ticket_opportunity_id uuid,
    jev_decision_evidence jsonb, plan_summary jsonb,
    plan_fingerprint text, review_status text
  )
  left join lateral (
    select prior.id, prior.content_hash, prior.proposal_version,
      prior.plan_fingerprint
    from public.official_import_candidates as prior
    join public.official_import_runs as prior_run on prior_run.id = prior.run_id
    where prior_run.status = 'completed'
      and prior.source_id = p_source_id
      and prior.candidate_kind = candidate.candidate_kind
      and (
        (candidate.official_external_id is not null
          and prior.official_external_id = candidate.official_external_id)
        or (candidate.official_external_id is null
          and prior.official_external_id is null
          and prior.canonical_url = candidate.canonical_url)
      )
    order by prior_run.finished_at desc, prior.created_at desc, prior.id desc
    limit 1
  ) as latest on true
  where latest.id is null
    or (latest.content_hash, latest.proposal_version, latest.plan_fingerprint)
      is distinct from
      (candidate.content_hash, candidate.proposal_version, candidate.plan_fingerprint);

  -- The incoming row is temporarily present even when its final outcome is
  -- suppression. This lets the existing delete guard verify the exact source
  -- identity while retiring an obsolete B on an A -> B -> A observation.
  perform set_config(
    'stage_tracker.official_import_superseding_run_id', p_run_id::text, true
  );
  delete from public.official_import_candidates as prior
  using public.official_import_runs as prior_run,
    public.official_import_candidates as replacement
  where prior.run_id = prior_run.id
    and prior_run.status = 'completed'
    and replacement.run_id = p_run_id
    and prior.source_id = p_source_id
    and prior.source_id = replacement.source_id
    and prior.candidate_kind = replacement.candidate_kind
    and (
      (replacement.official_external_id is not null
        and prior.official_external_id = replacement.official_external_id)
      or (replacement.official_external_id is null
        and prior.official_external_id is null
        and prior.canonical_url = replacement.canonical_url)
    )
    and prior.apply_status = 'not_started'
    and prior.review_status in ('pending', 'approved', 'blocked_for_identity_review');
  perform set_config('stage_tracker.official_import_superseding_run_id', '', true);

  -- A reviewed rejection need not be presented again while the catalog's
  -- apply epoch is unchanged. Comparing the plan fingerprint as well as the
  -- source content prevents a different catalog change from being suppressed.
  -- An earlier applied A is not a veto after a later B was applied.
  delete from public.official_import_candidates as incoming
  where incoming.run_id = p_run_id
    and exists (
      select 1
      from public.official_import_candidates as judged
      join public.official_import_runs as judged_run on judged_run.id = judged.run_id
      where judged_run.status = 'completed'
        and judged.source_id = incoming.source_id
        and judged.candidate_kind = incoming.candidate_kind
        and (
          (incoming.official_external_id is not null
            and judged.official_external_id = incoming.official_external_id)
          or (incoming.official_external_id is null
            and judged.official_external_id is null
            and judged.canonical_url = incoming.canonical_url)
        )
        and judged.review_status = 'rejected'
        and judged.content_hash = incoming.content_hash
        and judged.proposal_version = incoming.proposal_version
        and judged.plan_fingerprint = incoming.plan_fingerprint
        and judged.reviewed_at > coalesce(
          (
            select max(applied.applied_at)
            from public.official_import_candidates as applied
            where applied.source_id = incoming.source_id
              and applied.candidate_kind = incoming.candidate_kind
              and (
                (incoming.official_external_id is not null
                  and applied.official_external_id = incoming.official_external_id)
                or (incoming.official_external_id is null
                  and applied.official_external_id is null
                  and applied.canonical_url = incoming.canonical_url)
              )
              and applied.apply_status = 'applied'
          ),
          '-infinity'::timestamptz
        )
    );

  -- Match the existing UI's confirmed-no-change definition. Do not infer a
  -- no-op from action='unchanged' alone: auxiliary Event/Ticket fields can
  -- still change. If an older apply is in flight, keep the new observation;
  -- its catalog comparison may become relevant when that apply completes.
  delete from public.official_import_candidates as incoming
  where incoming.run_id = p_run_id
    and incoming.review_status = 'pending'
    and incoming.deterministic_match_status = 'matched'
    and incoming.semantic_match_status = 'not_used'
    and (
      (incoming.candidate_kind = 'event'
        and incoming.plan_summary @> '{"version":"event_plan.v1","action":"unchanged","detailsChanged":false,"rangeChanged":false,"newOccurrenceCount":0,"endsAtFixCount":0,"doorsAtFixCount":0,"genreChanged":false,"groupsChanged":false}'::jsonb
        and exists (
          select 1 from public.events as event
          where event.id = incoming.resolved_event_id
            and event.source_key = incoming.proposal ->> 'sourceKey'
        ))
      or (incoming.candidate_kind = 'ticket_opportunity'
        and incoming.plan_summary @> '{"version":"ticket_opportunity_plan.v1","action":"unchanged","eventChanged":false,"detailsChanged":false,"occurrencesChanged":false,"milestonesChanged":false}'::jsonb
        and exists (
          select 1 from public.ticket_opportunities as opportunity
          where opportunity.id = incoming.resolved_ticket_opportunity_id
            and opportunity.source_key = incoming.proposal ->> 'sourceKey'
        ))
    )
    and not exists (
      select 1 from public.official_import_candidates as applying
      where applying.source_id = incoming.source_id
        and applying.candidate_kind = incoming.candidate_kind
        and (
          (incoming.official_external_id is not null
            and applying.official_external_id = incoming.official_external_id)
          or (incoming.official_external_id is null
            and applying.official_external_id is null
            and applying.canonical_url = incoming.canonical_url)
        )
        and applying.apply_status = 'queued'
    );

  select count(*)::integer into v_candidate_count
  from public.official_import_candidates as candidate
  where candidate.run_id = p_run_id;

  update public.official_import_runs as run
  set status = 'completed', finished_at = clock_timestamp()
  where run.id = p_run_id;

  return v_candidate_count;
end;
$$;

-- The owned publisher must acquire the source lock before validating the
-- lease. Otherwise it can pass the lease check, pause behind another publish,
-- and commit a stale snapshot after its lease has expired.
create or replace function public.commit_owned_official_import_candidate_batch(
  p_run_id uuid,
  p_source_id text,
  p_attempt_token text,
  p_candidates jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.official_import_runs;
  v_candidate_count integer;
begin
  if p_run_id is null
    or p_source_id is null
    or p_attempt_token is null
    or p_attempt_token is distinct from btrim(p_attempt_token)
    or char_length(p_attempt_token) not between 1 and 256 then
    raise exception 'invalid official import owned batch'
      using errcode = '22023';
  end if;

  select run.* into v_run
  from public.official_import_runs as run
  where run.id = p_run_id
  for update;

  if not found then
    raise exception 'official import run is missing'
      using errcode = '22023';
  end if;
  if v_run.source_id is distinct from p_source_id then
    raise exception 'official import run source does not match'
      using errcode = '22023';
  end if;
  if v_run.status = 'completed' then
    select count(*)::integer into v_candidate_count
    from public.official_import_candidates as candidate
    where candidate.run_id = p_run_id;
    return v_candidate_count;
  end if;
  if v_run.status <> 'running' then
    raise exception 'official import run is not writable'
      using errcode = '55000';
  end if;

  -- Same order as claim: own run row, then source advisory lock. Recheck the
  -- lease with the actual clock only after all prior source commits finish.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('official-import-candidates:' || p_source_id, 0)
  );
  if v_run.active_attempt_token is distinct from p_attempt_token
    or v_run.active_attempt_lease_expires_at <= clock_timestamp() then
    raise exception 'official import attempt no longer owns the run'
      using errcode = '55000';
  end if;

  perform set_config('stage_tracker.official_import_attempt_run_id', p_run_id::text, true);
  perform set_config('stage_tracker.official_import_attempt_token', p_attempt_token, true);

  update public.official_import_runs as run
  set active_attempt_token = null,
      active_attempt_lease_expires_at = null
  where run.id = p_run_id;

  v_candidate_count := public.commit_official_import_candidate_batch(
    p_run_id, p_source_id, p_candidates
  );

  perform set_config('stage_tracker.official_import_attempt_token', '', true);
  perform set_config('stage_tracker.official_import_attempt_run_id', '', true);

  return v_candidate_count;
end;
$$;
