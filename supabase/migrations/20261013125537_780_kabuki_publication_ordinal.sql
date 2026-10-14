-- Issue #780: assign Kabuki publication order only inside the owned atomic
-- publisher transaction. Legacy NULL rows and direct unowned publications
-- remain unchanged; failed attempts may leave sequence gaps.

create or replace function public.enforce_official_import_run_state() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_scope_run_id text := current_setting(
    'stage_tracker.official_import_attempt_run_id',
    true
  );
  v_scope_token text := current_setting(
    'stage_tracker.official_import_attempt_token',
    true
  );
  v_attempt_changed boolean;
  v_expected_token text;
  v_publication_scope_ordinal text := nullif(
    current_setting('stage_tracker.official_import_publication_ordinal', true),
    ''
  );
begin
  if tg_op = 'INSERT' then
    if new.status <> 'running'
      or new.finished_at is not null
      or new.failure_classification is not null
      or new.failure_phase is not null
      or new.failure_reason is not null
      or new.failure_url is not null
      or new.publication_ordinal is not null
      or new.active_attempt_token is not null
      or new.active_attempt_lease_expires_at is not null then
      raise exception 'import runs must enter in unclaimed running state'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'running' or old.active_attempt_token is not null then
      raise exception 'terminal or claimed import runs cannot be deleted'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if old.status <> 'running' then
    raise exception 'completed or failed import runs are immutable'
      using errcode = '23514';
  end if;

  -- Clues use the same trusted service-role/attempt scope as the transition.
  if new.failure_phase is not null or new.failure_reason is not null or new.failure_url is not null then
    if new.status <> 'failed' or old.active_attempt_token is null
      or v_scope_run_id is distinct from old.id::text
      or v_scope_token is distinct from old.active_attempt_token then
      raise exception 'terminal clues require an owned failure transition' using errcode = '23514';
    end if;
  end if;

  if old.id is distinct from new.id
    or old.source_id is distinct from new.source_id
    or old.started_at is distinct from new.started_at
    or old.created_at is distinct from new.created_at then
    raise exception 'import run identity and start metadata are immutable'
      using errcode = '23514';
  end if;

  if old.publication_ordinal is distinct from new.publication_ordinal then
    if old.publication_ordinal is not null
      or new.publication_ordinal is null
      or old.status <> 'running'
      or new.status <> 'completed'
      or old.source_id <> 'event.kabuki-bito.schedule'
      or new.source_id <> 'event.kabuki-bito.schedule'
      or old.active_attempt_token is null
      or new.active_attempt_token is not null
      or new.active_attempt_lease_expires_at is not null
      or new.finished_at is null
      or v_scope_run_id is distinct from old.id::text
      or v_scope_token is distinct from old.active_attempt_token
      or v_publication_scope_ordinal is distinct from new.publication_ordinal::text then
      raise exception 'publication ordinal requires an owned Kabuki publication completion'
        using errcode = '23514';
    end if;
  end if;

  v_attempt_changed :=
    old.active_attempt_token is distinct from new.active_attempt_token
    or old.active_attempt_lease_expires_at is distinct from new.active_attempt_lease_expires_at;

  v_expected_token := case
    when new.active_attempt_token is not null then new.active_attempt_token
    else old.active_attempt_token
  end;

  if v_attempt_changed or (old.status is distinct from new.status and old.active_attempt_token is not null) then
    if v_scope_run_id is null
      or v_scope_run_id <> old.id::text
      or v_scope_token is null
      or v_scope_token is distinct from v_expected_token then
      raise exception 'claimed import runs may only be changed by their attempt RPC'
        using errcode = '23514';
    end if;
  end if;

  if old.status is distinct from new.status
    and new.status not in ('completed', 'failed') then
    raise exception 'running import runs may only complete or fail'
      using errcode = '23514';
  end if;

  return new;
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
  v_active_attempt_token text;
  v_candidate_count integer;
  v_attempt_scope_run_id text := nullif(
    current_setting('stage_tracker.official_import_attempt_run_id', true), ''
  );
  v_attempt_scope_token text := nullif(
    current_setting('stage_tracker.official_import_attempt_token', true), ''
  );
  v_publication_ordinal_text text := nullif(
    current_setting('stage_tracker.official_import_publication_ordinal', true), ''
  );
  v_publication_ordinal bigint;
  v_owned_attempt boolean;
begin
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'official import candidates must be a JSON array'
      using errcode = '22023';
  end if;

  select run.status, run.source_id, run.active_attempt_token
    into v_run_status, v_run_source_id, v_active_attempt_token
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
  v_owned_attempt :=
    v_active_attempt_token is not null
    and v_attempt_scope_run_id is not distinct from p_run_id::text
    and v_attempt_scope_token is not null
    and v_attempt_scope_token is not distinct from v_active_attempt_token;

  if v_active_attempt_token is not null and not v_owned_attempt then
    raise exception 'claimed import runs must use the owned batch RPC'
      using errcode = '55000';
  end if;

  if v_publication_ordinal_text is not null then
    if not v_owned_attempt
      or p_source_id is distinct from 'event.kabuki-bito.schedule' then
      raise exception 'publication ordinal is outside its owned Kabuki publisher scope'
        using errcode = '23514';
    end if;
    v_publication_ordinal := v_publication_ordinal_text::bigint;
    if v_publication_ordinal <= 0 then
      raise exception 'publication ordinal must be positive'
        using errcode = '23514';
    end if;
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

  -- Live scans enter through commit_owned_official_import_candidate_batch.
  -- Their source lease prevents simultaneous acquisition, and that wrapper
  -- rechecks ownership after taking this same source lock. Thus a displaced
  -- older scan cannot reach this deletion after a newer scan commits.
  -- The incoming row is temporarily present even when its final outcome is
  -- suppression, so the delete guard can verify the exact source identity.
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
  set status = 'completed',
      finished_at = clock_timestamp(),
      active_attempt_token = case
        when v_owned_attempt then null
        else run.active_attempt_token
      end,
      active_attempt_lease_expires_at = case
        when v_owned_attempt then null
        else run.active_attempt_lease_expires_at
      end,
      publication_ordinal = case
        when v_publication_ordinal is not null then v_publication_ordinal
        else run.publication_ordinal
      end
  where run.id = p_run_id;

  return v_candidate_count;
end;
$$;

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
  v_publication_ordinal bigint;
  v_latest_publication_ordinal bigint;
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
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'official import candidates must be a JSON array'
      using errcode = '22023';
  end if;

  -- The source lock and fresh lease check above establish this committed
  -- observation's authority. Allocate only now, while holding both locks.
  if p_source_id = 'event.kabuki-bito.schedule' then
    select max(run.publication_ordinal)
      into v_latest_publication_ordinal
    from public.official_import_runs as run
    where run.source_id = p_source_id
      and run.publication_ordinal is not null;

    v_publication_ordinal := pg_catalog.nextval(
      'public.official_import_kabuki_publication_ordinal_seq'::regclass
    );
    if v_latest_publication_ordinal is not null
      and v_publication_ordinal <= v_latest_publication_ordinal then
      raise exception 'Kabuki publication ordinal did not advance'
        using errcode = '23514';
    end if;

    perform set_config(
      'stage_tracker.official_import_publication_ordinal',
      v_publication_ordinal::text,
      true
    );
  else
    perform set_config('stage_tracker.official_import_publication_ordinal', '', true);
  end if;

  perform set_config('stage_tracker.official_import_attempt_run_id', p_run_id::text, true);
  perform set_config('stage_tracker.official_import_attempt_token', p_attempt_token, true);

  v_candidate_count := public.commit_official_import_candidate_batch(
    p_run_id, p_source_id, p_candidates
  );

  perform set_config('stage_tracker.official_import_publication_ordinal', '', true);
  perform set_config('stage_tracker.official_import_attempt_token', '', true);
  perform set_config('stage_tracker.official_import_attempt_run_id', '', true);

  return v_candidate_count;
end;
$$;
