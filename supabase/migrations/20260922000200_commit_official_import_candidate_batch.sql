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

  -- The delete guard admits identity-blocked rows only while this locked run
  -- is being replaced by this RPC. Direct service-role deletes remain denied.
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
  );

  get diagnostics v_candidate_count = row_count;

  update public.official_import_runs as run
  set status = 'completed',
      finished_at = now()
  where run.id = p_run_id;

  return v_candidate_count;
end;
$$;

-- Preserve the existing state guard for INSERT/UPDATE, while giving DELETE a
-- narrow retry-cleanup rule. The custom transaction-local setting is written
-- only by the locked batch RPC above; outside that RPC the P2 deletion
-- boundary remains unchanged.
drop trigger official_import_candidates_state_guard
  on public.official_import_candidates;

create trigger official_import_candidates_state_guard
  before update on public.official_import_candidates
  for each row
  execute function public.enforce_official_import_candidate_state();

create function public.enforce_official_import_candidate_insert() returns trigger
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
begin
  select run.status, run.source_id
    into v_run_status, v_run_source_id
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

create trigger official_import_candidates_insert_guard
  before insert on public.official_import_candidates
  for each row
  execute function public.enforce_official_import_candidate_insert();

create function public.enforce_official_import_candidate_delete() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_run_status text;
  v_cleanup_run_id text := current_setting(
    'stage_tracker.official_import_batch_run_id',
    true
  );
begin
  select run.status
    into v_run_status
  from public.official_import_runs as run
  where run.id = old.run_id
  for update;

  if not found then
    raise exception 'candidate parent import run is missing'
      using errcode = '23514';
  end if;

  if v_run_status <> 'running'
    or old.apply_status <> 'not_started'
    or (
      old.review_status <> 'pending'
      and not (
        old.review_status = 'blocked_for_identity_review'
        and v_cleanup_run_id is not null
        and v_cleanup_run_id = old.run_id::text
      )
    ) then
    raise exception 'only replaceable candidates in running runs may be deleted'
      using errcode = '23514';
  end if;

  return old;
end;
$$;

create trigger official_import_candidates_delete_guard
  before delete on public.official_import_candidates
  for each row
  execute function public.enforce_official_import_candidate_delete();

revoke execute on function public.commit_official_import_candidate_batch(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_official_import_candidate_batch(uuid, text, jsonb)
  to service_role;
