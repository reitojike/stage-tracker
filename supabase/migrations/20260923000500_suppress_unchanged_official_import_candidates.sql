-- Issue #634: repeated successful scans must not grow the review queue when
-- source content and its deterministic plan have not changed.
--
-- Keep completed run records for operational evidence. Only candidate rows
-- are suppressed, and a changed source hash, proposal version, or plan can
-- still create a new review candidate. Existing historical rows are left
-- intact, so this migration is safe even if prior scans already duplicated.
--
-- Migration ordering: additive (replaces one service-role-only RPC body).

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

  select run.status, run.source_id
    into v_run_status, v_run_source_id
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
    select count(*)::integer
      into v_candidate_count
    from public.official_import_candidates as candidate
    where candidate.run_id = p_run_id;
    return v_candidate_count;
  end if;

  if v_run_status <> 'running' then
    raise exception 'official import run is not writable'
      using errcode = '22023';
  end if;

  -- Different run IDs do not share a row lock. Serialize only commits from
  -- the same source so a concurrent scan observes the first committed batch.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('official-import-candidates:' || p_source_id, 0)
  );

  -- A duplicated exact candidate in one source response is malformed input,
  -- not a reason to create several identical review rows in a single run.
  if exists (
    select 1
    from jsonb_to_recordset(p_candidates) as candidate(
      candidate_kind text,
      canonical_url text,
      official_external_id text,
      content_hash text,
      proposal_version text,
      plan_fingerprint text
    )
    group by
      candidate.candidate_kind,
      candidate.official_external_id is null,
      coalesce(candidate.official_external_id, candidate.canonical_url),
      candidate.content_hash,
      candidate.proposal_version,
      candidate.plan_fingerprint
    having count(*) > 1
  ) then
    raise exception 'official import batch contains duplicate candidates'
      using errcode = '22023';
  end if;

  -- Preserve the existing same-run retry cleanup and its narrow delete guard.
  perform set_config(
    'stage_tracker.official_import_batch_run_id',
    p_run_id::text,
    true
  );

  delete from public.official_import_candidates as candidate
  where candidate.run_id = p_run_id;

  insert into public.official_import_candidates (
    run_id,
    source_id,
    candidate_kind,
    canonical_url,
    official_external_id,
    observed_at,
    content_hash,
    etag,
    last_modified,
    proposal_version,
    proposal,
    evidence_locator,
    deterministic_match_status,
    semantic_match_status,
    resolved_event_id,
    resolved_ticket_opportunity_id,
    jev_decision_evidence,
    plan_summary,
    plan_fingerprint,
    review_status
  )
  select
    p_run_id,
    p_source_id,
    candidate.candidate_kind,
    candidate.canonical_url,
    candidate.official_external_id,
    candidate.observed_at,
    candidate.content_hash,
    candidate.etag,
    candidate.last_modified,
    candidate.proposal_version,
    candidate.proposal,
    candidate.evidence_locator,
    candidate.deterministic_match_status,
    candidate.semantic_match_status,
    candidate.resolved_event_id,
    candidate.resolved_ticket_opportunity_id,
    candidate.jev_decision_evidence,
    candidate.plan_summary,
    candidate.plan_fingerprint,
    candidate.review_status
  from jsonb_to_recordset(p_candidates) as candidate(
    candidate_kind text,
    canonical_url text,
    official_external_id text,
    observed_at timestamptz,
    content_hash text,
    etag text,
    last_modified text,
    proposal_version text,
    proposal jsonb,
    evidence_locator jsonb,
    deterministic_match_status text,
    semantic_match_status text,
    resolved_event_id uuid,
    resolved_ticket_opportunity_id uuid,
    jev_decision_evidence jsonb,
    plan_summary jsonb,
    plan_fingerprint text,
    review_status text
  )
  where not exists (
    select 1
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
      and prior.content_hash = candidate.content_hash
      and prior.proposal_version = candidate.proposal_version
      and prior.plan_fingerprint = candidate.plan_fingerprint
  );

  get diagnostics v_candidate_count = row_count;

  update public.official_import_runs as run
  set status = 'completed',
      finished_at = now()
  where run.id = p_run_id;

  return v_candidate_count;
end;
$$;
