-- Serialize overlapping apply attempts for one approved official-import
-- candidate. Catalog writes remain in the existing privileged import RPCs;
-- these RPCs own only the candidate apply lifecycle.
--
-- Migration ordering: additive

alter table public.official_import_candidates
  add column active_apply_attempt_token text
    check (
      active_apply_attempt_token is null
      or (
        active_apply_attempt_token = btrim(active_apply_attempt_token)
        and char_length(active_apply_attempt_token) between 1 and 256
      )
    ),
  add column active_apply_lease_expires_at timestamptz,
  add constraint official_import_candidates_apply_lease_pair_check
    check (
      (active_apply_attempt_token is null)
      = (active_apply_lease_expires_at is null)
    ),
  add constraint official_import_candidates_nonqueued_has_no_apply_attempt_check
    check (apply_status = 'queued' or active_apply_attempt_token is null);

create or replace function public.enforce_official_import_candidate_state() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_run_status text;
  v_run_source_id text;
  v_scope_candidate_id text := current_setting(
    'stage_tracker.official_import_apply_candidate_id',
    true
  );
  v_scope_token text := current_setting(
    'stage_tracker.official_import_apply_attempt_token',
    true
  );
  v_apply_changed boolean;
  v_expected_token text;
begin
  if tg_op = 'INSERT' then
    v_run_id := new.run_id;
  else
    v_run_id := old.run_id;
  end if;

  select r.status, r.source_id
    into v_run_status, v_run_source_id
  from public.official_import_runs r
  where r.id = v_run_id
  for update;

  if not found then
    raise exception 'candidate parent import run is missing'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    if v_run_status <> 'running'
      or old.review_status <> 'pending'
      or old.apply_status <> 'not_started' then
      raise exception 'only pending candidates in running runs may be deleted'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if new.source_id is distinct from v_run_source_id then
    raise exception 'candidate source_id must match its import run'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if v_run_status <> 'running'
      or new.review_status <> 'pending'
      or new.reviewer is not null
      or new.reviewed_at is not null
      or new.apply_status <> 'not_started'
      or new.applied_at is not null
      or new.failure_classification is not null
      or new.active_apply_attempt_token is not null
      or new.active_apply_lease_expires_at is not null then
      raise exception 'candidates must enter pending and not_started'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if old.id is distinct from new.id
      or old.run_id is distinct from new.run_id
      or old.source_id is distinct from new.source_id
      or old.created_at is distinct from new.created_at then
      raise exception 'candidate run and source identity are immutable'
        using errcode = '23514';
    end if;

    if (
      old.candidate_kind is distinct from new.candidate_kind
      or old.canonical_url is distinct from new.canonical_url
      or old.official_external_id is distinct from new.official_external_id
      or old.observed_at is distinct from new.observed_at
      or old.content_hash is distinct from new.content_hash
      or old.etag is distinct from new.etag
      or old.last_modified is distinct from new.last_modified
      or old.proposal_version is distinct from new.proposal_version
      or old.proposal is distinct from new.proposal
      or old.evidence_locator is distinct from new.evidence_locator
      or old.deterministic_match_status is distinct from new.deterministic_match_status
      or old.semantic_match_status is distinct from new.semantic_match_status
      or (
        old.resolved_event_id is distinct from new.resolved_event_id
        and not (
          new.resolved_event_id is null
          and old.resolved_event_id is not null
          and not exists (
            select 1 from public.events where id = old.resolved_event_id
          )
        )
      )
      or (
        old.resolved_ticket_opportunity_id is distinct from new.resolved_ticket_opportunity_id
        and not (
          new.resolved_ticket_opportunity_id is null
          and old.resolved_ticket_opportunity_id is not null
          and not exists (
            select 1
            from public.ticket_opportunities
            where id = old.resolved_ticket_opportunity_id
          )
        )
      )
      or old.jev_decision_evidence is distinct from new.jev_decision_evidence
      or old.plan_summary is distinct from new.plan_summary
      or old.plan_fingerprint is distinct from new.plan_fingerprint
    ) then
      if old.review_status <> 'pending' or v_run_status <> 'running' then
        raise exception 'candidate ingestion contents are immutable'
          using errcode = '23514';
      end if;
    end if;

    if old.review_status is distinct from new.review_status then
      if old.review_status <> 'pending' then
        raise exception 'official import review state is terminal'
          using errcode = '23514';
      end if;

      if new.review_status = 'blocked_for_identity_review' then
        if new.reviewer is not null or new.reviewed_at is not null then
          raise exception 'identity-blocked candidates cannot have a reviewer'
            using errcode = '23514';
        end if;
      elsif new.review_status in ('approved', 'rejected') then
        if auth.uid() is null or new.reviewer is distinct from auth.uid() then
          raise exception 'reviewer must be the authenticated actor'
            using errcode = '42501';
        end if;
      else
        raise exception 'invalid official import review transition'
          using errcode = '23514';
      end if;
    elsif old.reviewer is distinct from new.reviewer
      or old.reviewed_at is distinct from new.reviewed_at then
      raise exception 'reviewer fields are immutable outside a review transition'
        using errcode = '23514';
    end if;

    v_apply_changed :=
      old.apply_status is distinct from new.apply_status
      or old.applied_at is distinct from new.applied_at
      or old.failure_classification is distinct from new.failure_classification
      or old.active_apply_attempt_token is distinct from new.active_apply_attempt_token
      or old.active_apply_lease_expires_at is distinct from new.active_apply_lease_expires_at;

    v_expected_token := case
      when new.active_apply_attempt_token is not null
        then new.active_apply_attempt_token
      else old.active_apply_attempt_token
    end;

    if v_apply_changed then
      if v_scope_candidate_id is null
        or v_scope_candidate_id <> old.id::text
        or v_scope_token is null
        or v_scope_token is distinct from v_expected_token then
        raise exception 'candidate apply state may only be changed by its attempt RPC'
          using errcode = '23514';
      end if;
    end if;

    if old.apply_status is distinct from new.apply_status then
      if new.review_status <> 'approved' then
        raise exception 'only approved candidates may enter apply state'
          using errcode = '23514';
      end if;

      if old.apply_status = 'not_started'
        and new.apply_status <> 'queued' then
        raise exception 'not_started candidates may only become queued'
          using errcode = '23514';
      elsif old.apply_status = 'queued'
        and new.apply_status not in ('applied', 'failed') then
        raise exception 'queued candidates may only become applied or failed'
          using errcode = '23514';
      elsif old.apply_status = 'failed'
        and new.apply_status <> 'queued' then
        raise exception 'failed candidates may only be retried as queued'
          using errcode = '23514';
      elsif old.apply_status = 'applied' then
        raise exception 'applied candidates are terminal'
          using errcode = '23514';
      end if;
    end if;

    if old.apply_status = 'failed'
      and new.apply_status = 'failed'
      and old.failure_classification is distinct from new.failure_classification then
      raise exception 'failed candidate evidence is immutable'
        using errcode = '23514';
    end if;

    if old.apply_status = 'applied'
      and (
        old.applied_at is distinct from new.applied_at
        or old.active_apply_attempt_token is distinct from new.active_apply_attempt_token
        or old.active_apply_lease_expires_at is distinct from new.active_apply_lease_expires_at
      ) then
      raise exception 'applied candidates are terminal'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create function public.claim_official_import_candidate_apply(
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

create function public.complete_official_import_candidate_apply(
  p_candidate_id uuid,
  p_attempt_token text
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_candidate public.official_import_candidates;
begin
  if p_candidate_id is null
    or p_attempt_token is null
    or p_attempt_token is distinct from btrim(p_attempt_token)
    or char_length(p_attempt_token) not between 1 and 256 then
    raise exception 'invalid official import candidate apply completion'
      using errcode = '22023';
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
  if v_candidate.apply_status <> 'queued' then
    return v_candidate.apply_status;
  end if;
  if v_candidate.active_apply_attempt_token is distinct from p_attempt_token
    or v_candidate.active_apply_lease_expires_at <= clock_timestamp() then
    return 'not_owner';
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
  set apply_status = 'applied',
      applied_at = clock_timestamp(),
      failure_classification = null,
      active_apply_attempt_token = null,
      active_apply_lease_expires_at = null
  where candidate.id = p_candidate_id;

  perform set_config('stage_tracker.official_import_apply_attempt_token', '', true);
  perform set_config('stage_tracker.official_import_apply_candidate_id', '', true);

  return 'applied';
end;
$$;

create function public.fail_official_import_candidate_apply(
  p_candidate_id uuid,
  p_attempt_token text,
  p_failure_classification text
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_candidate public.official_import_candidates;
begin
  if p_candidate_id is null
    or p_attempt_token is null
    or p_attempt_token is distinct from btrim(p_attempt_token)
    or char_length(p_attempt_token) not between 1 and 256
    or p_failure_classification is null
    or p_failure_classification not in (
      'validation',
      'identity_ambiguous',
      'source_changed',
      'target_missing',
      'write_conflict',
      'provider_unavailable',
      'policy_blocked',
      'unexpected'
    ) then
    raise exception 'invalid official import candidate apply failure'
      using errcode = '22023';
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
  if v_candidate.apply_status <> 'queued' then
    return v_candidate.apply_status;
  end if;
  if v_candidate.active_apply_attempt_token is distinct from p_attempt_token
    or v_candidate.active_apply_lease_expires_at <= clock_timestamp() then
    return 'not_owner';
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
  set apply_status = 'failed',
      applied_at = null,
      failure_classification = p_failure_classification,
      active_apply_attempt_token = null,
      active_apply_lease_expires_at = null
  where candidate.id = p_candidate_id;

  perform set_config('stage_tracker.official_import_apply_attempt_token', '', true);
  perform set_config('stage_tracker.official_import_apply_candidate_id', '', true);

  return 'failed';
end;
$$;

revoke execute on function public.claim_official_import_candidate_apply(uuid, text, integer)
  from public, anon, authenticated;
revoke execute on function public.complete_official_import_candidate_apply(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.fail_official_import_candidate_apply(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.claim_official_import_candidate_apply(uuid, text, integer)
  to service_role;
grant execute on function public.complete_official_import_candidate_apply(uuid, text)
  to service_role;
grant execute on function public.fail_official_import_candidate_apply(uuid, text, text)
  to service_role;
