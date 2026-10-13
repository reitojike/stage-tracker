-- Remove a redundant completed Kabuki parent lock from candidate update and
-- supersession-delete guards. Completed runs are immutable; all other paths
-- retain their existing parent lock and eligibility checks.
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

  if tg_op = 'UPDATE' then
    -- Terminal run rows are immutable, so a source-consistent Kabuki parent
    -- cannot change after this unlocked read. Preserve locking and rereading
    -- for running, failed, other-source, and inconsistent parents.
    select r.status, r.source_id
      into v_run_status, v_run_source_id
    from public.official_import_runs r
    where r.id = v_run_id;

    if not found then
      raise exception 'candidate parent import run is missing'
        using errcode = '23514';
    end if;

    if not (
      v_run_status = 'completed'
      and v_run_source_id = 'event.kabuki-bito.schedule'
      and old.source_id = v_run_source_id
      and old.candidate_kind = 'event'
      and new.source_id is not distinct from old.source_id
      and new.candidate_kind is not distinct from old.candidate_kind
    ) then
      select r.status, r.source_id
        into v_run_status, v_run_source_id
      from public.official_import_runs r
      where r.id = v_run_id
      for update;

      if not found then
        raise exception 'candidate parent import run is missing'
          using errcode = '23514';
      end if;
    end if;
  else
    select r.status, r.source_id
      into v_run_status, v_run_source_id
    from public.official_import_runs r
    where r.id = v_run_id
    for update;

    if not found then
      raise exception 'candidate parent import run is missing'
        using errcode = '23514';
    end if;
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
      if old.review_status <> 'pending'
        and not (
          old.review_status = 'blocked_for_identity_review'
          and old.candidate_kind = 'ticket_opportunity'
          and old.apply_status = 'not_started'
          and (
            new.review_status = 'rejected'
            or (
              new.review_status = 'approved'
              and current_setting('stage_tracker.official_import_manual_candidate_id', true) = old.id::text
              and exists (
                select 1 from public.official_import_ticket_event_bindings as binding
                where binding.source_id = old.source_id
                  and binding.ticket_source_key = old.proposal ->> 'sourceKey'
                  and binding.candidate_id = old.id
              )
            )
          )
        ) then
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

create or replace function public.enforce_official_import_candidate_delete() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_run_status text;
  v_run_source_id text;
  v_cleanup_run_id text := current_setting(
    'stage_tracker.official_import_batch_run_id', true
  );
  v_superseding_run_id text := current_setting(
    'stage_tracker.official_import_superseding_run_id', true
  );
begin
  -- Completed run rows are immutable. Skip their row lock only for a
  -- source-consistent Kabuki event candidate; all other paths lock and reread.
  select run.status, run.source_id
    into v_run_status, v_run_source_id
  from public.official_import_runs as run
  where run.id = old.run_id;

  if not found then
    raise exception 'candidate parent import run is missing'
      using errcode = '23514';
  end if;

  if not (
    v_run_status = 'completed'
    and v_run_source_id = 'event.kabuki-bito.schedule'
    and old.source_id = v_run_source_id
    and old.candidate_kind = 'event'
  ) then
    select run.status, run.source_id
      into v_run_status, v_run_source_id
    from public.official_import_runs as run
    where run.id = old.run_id
    for update;

    if not found then
      raise exception 'candidate parent import run is missing'
        using errcode = '23514';
    end if;
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
