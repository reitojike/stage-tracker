-- Publish one canonical official-import candidate batch atomically.
--
-- A Workflow step can be retried while an earlier attempt is still winding
-- down. Locking the stable run row and replacing candidates in the same
-- transaction prevents an overlapping attempt from deleting or duplicating a
-- batch that another attempt is publishing.
--
-- Migration ordering: additive

create function public.commit_official_import_candidate_batch(
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
    plan_fingerprint
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
    candidate.plan_fingerprint
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
    plan_fingerprint text
  );

  get diagnostics v_candidate_count = row_count;

  update public.official_import_runs as run
  set status = 'completed',
      finished_at = now()
  where run.id = p_run_id;

  return v_candidate_count;
end;
$$;

revoke execute on function public.commit_official_import_candidate_batch(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_official_import_candidate_batch(uuid, text, jsonb)
  to service_role;
