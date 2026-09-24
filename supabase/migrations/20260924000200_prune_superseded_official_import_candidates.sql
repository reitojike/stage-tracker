-- Issue #634: a newer candidate for the same official source identity replaces
-- older, unapplied review proposals. Applied, queued, failed, and rejected rows
-- remain as audit/operational evidence. This never deletes catalog Events or
-- TicketOpportunities. The batch insert and pruning are one transaction;
-- completed import runs remain intact.
--
-- Migration ordering: additive. The RPC signature and result are unchanged;
-- a zero candidate count and an empty review queue were already valid.

begin;

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

  -- Preserve the existing retry cleanup for an unfinished run.
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

  if v_run_status = 'completed'
    and old.apply_status = 'not_started'
    and old.review_status in (
      'pending', 'approved', 'blocked_for_identity_review'
    )
    and (
      -- Used only by this migration while holding the table's write lock.
      (v_superseding_run_id = 'migration-cleanup' and current_user = 'postgres')
      or exists (
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

  -- Validate before unchanged-content suppression can filter either version.
  if exists (
    select 1
    from jsonb_to_recordset(p_candidates) as candidate(
      candidate_kind text,
      canonical_url text,
      official_external_id text
    )
    group by candidate.candidate_kind,
      (candidate.official_external_id is null),
      coalesce(candidate.official_external_id, candidate.canonical_url)
    having count(*) > 1
  ) then
    raise exception 'official import batch contains duplicate source identities'
      using errcode = '22023';
  end if;

  perform set_config(
    'stage_tracker.official_import_batch_run_id', p_run_id::text, true
  );
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

  -- A new candidate and removal of its older unapplied proposals must commit
  -- together. Applied or in-flight rows are never deletion targets.
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
    and prior.review_status in (
      'pending', 'approved', 'blocked_for_identity_review'
    );
  perform set_config(
    'stage_tracker.official_import_superseding_run_id', '', true
  );

  update public.official_import_runs as run
  set status = 'completed', finished_at = now()
  where run.id = p_run_id;

  return v_candidate_count;
end;
$$;

-- A one-time cleanup also removes stale pre-migration proposals already shown
-- in Production. Rank completed-run identities first, then delete only older
-- review proposals that have never entered apply. The lock prevents a scan or
-- review transition racing this bounded cleanup.
lock table public.official_import_candidates in access exclusive mode;
select set_config(
  'stage_tracker.official_import_superseding_run_id',
  'migration-cleanup',
  true
);
with ranked as (
  select candidate.id,
    row_number() over (
      partition by candidate.source_id, candidate.candidate_kind,
        (candidate.official_external_id is null),
        coalesce(candidate.official_external_id, candidate.canonical_url)
      order by run.finished_at desc, candidate.observed_at desc,
        candidate.created_at desc, candidate.id desc
    ) as position
  from public.official_import_candidates as candidate
  join public.official_import_runs as run on run.id = candidate.run_id
  where run.status = 'completed'
)
delete from public.official_import_candidates as candidate
using ranked
where candidate.id = ranked.id
  and ranked.position > 1
  and candidate.apply_status = 'not_started'
  and candidate.review_status in (
    'pending', 'approved', 'blocked_for_identity_review'
  );
select set_config(
  'stage_tracker.official_import_superseding_run_id',
  '',
  true
);

commit;
