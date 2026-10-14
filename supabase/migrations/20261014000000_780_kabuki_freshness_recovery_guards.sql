-- Issue #780: activate Kabuki freshness and recovery on the existing
-- source-serialized publication and candidate-aware application paths.
-- No raw source payload, new table, or client-executable RPC is introduced.

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

  -- Future Kabuki publications must carry owned ordinal authority even when
  -- a caller writes staging tables directly instead of using the batch RPC.
  -- Historical terminal NULL rows remain immutable under the guard above.
  if old.source_id = 'event.kabuki-bito.schedule'
    and new.status = 'completed'
    and new.publication_ordinal is null then
    raise exception 'Kabuki completion requires owned publication authority'
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

create index official_import_held_pages_source_identity_run_idx
  on public.official_import_held_pages (source_id, official_external_id, canonical_url, run_id);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

comment on column public.official_import_runs.publication_ordinal is
  'Commit-ordered Kabuki publication authority. Owned publications allocate under the source lock; legacy NULL remains unknown and is never backfilled.';
comment on column public.official_import_candidates.recovery_review_required is
  'Database-derived unresolved recovery obligation. A fresh review is required until explicit rejection, failed dismissal, or applied evidence settles the episode.';
comment on column public.official_import_candidates.recovery_hold_run_id is
  'Exact committed Kabuki hold run for a known recovery episode. NULL with recovery_review_required=true represents legacy unknown history.';

create function private.official_import_kabuki_recovery_marker_internal(
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

revoke all on function private.official_import_kabuki_recovery_marker_internal(text,text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function private.official_import_kabuki_recovery_marker_internal(text,text,text,text,text,text,text)
  to service_role;

create function private.official_import_kabuki_candidate_fresh_internal(p_candidate_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_candidate public.official_import_candidates;
  v_run_status text;
  v_ordinal bigint;
  v_marker record;
begin
  select candidate.* into v_candidate
  from public.official_import_candidates as candidate
  where candidate.id = p_candidate_id;
  if not found then
    return false;
  end if;
  select run.status, run.publication_ordinal into v_run_status, v_ordinal
  from public.official_import_runs as run where run.id = v_candidate.run_id;
  if v_candidate.source_id <> 'event.kabuki-bito.schedule'
    or v_candidate.candidate_kind <> 'event' then
    return true;
  end if;
  if v_candidate.apply_status = 'applied' then
    return true;
  end if;
  if v_run_status <> 'completed' or v_ordinal is null then
    return false;
  end if;

  select * into v_marker
  from private.official_import_kabuki_recovery_marker_internal(
    v_candidate.source_id,
    v_candidate.candidate_kind,
    v_candidate.official_external_id,
    v_candidate.canonical_url,
    v_candidate.content_hash,
    v_candidate.proposal_version,
    v_candidate.plan_fingerprint
  );

  if v_candidate.recovery_review_required is distinct from v_marker.recovery_review_required
    or v_candidate.recovery_hold_run_id is distinct from v_marker.recovery_hold_run_id then
    return false;
  end if;
  if exists (
    select 1
    from public.official_import_candidates as newer
    join public.official_import_runs as newer_run on newer_run.id = newer.run_id
    where newer.id <> v_candidate.id
      and newer.source_id = v_candidate.source_id
      and newer.candidate_kind = v_candidate.candidate_kind
      and newer.official_external_id = v_candidate.official_external_id
      and newer.canonical_url = v_candidate.canonical_url
      and newer_run.publication_ordinal > v_ordinal
  ) then
    return false;
  end if;
  if v_candidate.recovery_hold_run_id is not null
    and not exists (
      select 1
      from public.official_import_held_pages as held
      join public.official_import_runs as held_run on held_run.id = held.run_id
      where held.run_id = v_candidate.recovery_hold_run_id
        and held.source_id = v_candidate.source_id
        and held.official_external_id = v_candidate.official_external_id
        and held.canonical_url = v_candidate.canonical_url
        and held_run.publication_ordinal < v_ordinal
    ) then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function private.official_import_kabuki_candidate_fresh_internal(uuid)
  from public, anon, authenticated;
grant execute on function private.official_import_kabuki_candidate_fresh_internal(uuid)
  to service_role;


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

    if old.recovery_review_required is distinct from new.recovery_review_required
      or old.recovery_hold_run_id is distinct from new.recovery_hold_run_id then
      raise exception 'candidate recovery metadata is immutable after publication'
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
      if old.source_id = 'event.kabuki-bito.schedule'
        and old.candidate_kind = 'event'
        and old.apply_status = 'queued'
        and new.apply_status = 'applied'
        and (
          current_setting('stage_tracker.official_import_atomic_candidate_id', true)
            is distinct from old.id::text
          or current_setting('stage_tracker.official_import_atomic_attempt_token', true)
            is distinct from old.active_apply_attempt_token
        ) then
        raise exception 'Kabuki candidates require atomic catalog write and completion'
          using errcode = '23514';
      end if;
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

  if p_source_id = 'event.kabuki-bito.schedule'
    and (not v_owned_attempt or v_publication_ordinal is null) then
    raise exception 'Kabuki publication requires the owned ordinal publisher'
      using errcode = '55000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('official-import-candidates:' || p_source_id, 0)
  );

  if p_source_id = 'event.kabuki-bito.schedule' and exists (
    select 1
    from jsonb_to_recordset(p_candidates) as incoming(
      candidate_kind text, canonical_url text, official_external_id text, proposal jsonb
    )
    where incoming.candidate_kind <> 'event'
      or incoming.official_external_id is null
      or (pg_catalog.regexp_match(incoming.canonical_url,
        '^https://www\.kabuki-bito\.jp/theaters/([^/?#]+)/play/([0-9]+)/?$'))[2]
        is distinct from incoming.official_external_id
      or incoming.proposal ->> 'sourceKey' is distinct from
        ('kabuki-bito:' || ((pg_catalog.regexp_match(incoming.canonical_url,
          '^https://www\.kabuki-bito\.jp/theaters/([^/?#]+)/play/([0-9]+)/?$'))[1])
          || ':play:' || incoming.official_external_id)
      or incoming.proposal ->> 'sourceUrl' is distinct from incoming.canonical_url
  ) then
    raise exception 'Kabuki candidate identity is not a verified work identity'
      using errcode = '22023';
  end if;

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
    order by
      case when p_source_id = 'event.kabuki-bito.schedule'
        then prior_run.publication_ordinal end desc nulls last,
      case when p_source_id <> 'event.kabuki-bito.schedule'
        then prior_run.finished_at end desc nulls last,
      case when p_source_id <> 'event.kabuki-bito.schedule'
        then prior.created_at end desc nulls last,
      case when p_source_id <> 'event.kabuki-bito.schedule'
        then prior.id end desc nulls last
    limit 1
  ) as latest on true
  left join lateral private.official_import_kabuki_recovery_marker_internal(
    p_source_id, candidate.candidate_kind, candidate.official_external_id,
    candidate.canonical_url, candidate.content_hash,
    candidate.proposal_version, candidate.plan_fingerprint
  ) as recovery on true
  where latest.id is null
    or (latest.content_hash, latest.proposal_version, latest.plan_fingerprint)
      is distinct from
      (candidate.content_hash, candidate.proposal_version, candidate.plan_fingerprint)
    or (coalesce(recovery.recovery_review_required, false)
      and not coalesce(recovery.same_open_proposal, false));

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
      and not incoming.recovery_review_required
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
    and not incoming.recovery_review_required
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

create or replace function public.commit_owned_official_import_partial_batch(
  p_run_id uuid,
  p_source_id text,
  p_attempt_token text,
  p_candidates jsonb,
  p_held_pages jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.official_import_runs;
begin
  if p_held_pages is null or jsonb_typeof(p_held_pages) <> 'array' then
    raise exception 'official import held pages must be a JSON array'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_held_pages) not between 1 and 30
    or pg_catalog.pg_column_size(p_held_pages) > 32768 then
    raise exception 'official import held page report exceeds its bounds'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_held_pages) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or not (item.value ?& array[
        'canonical_url', 'official_external_id', 'title',
        'starts_on', 'ends_on', 'reason_code'
      ])
  ) then
    raise exception 'official import held page report has an invalid shape'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_held_pages) as held(canonical_url text)
    group by held.canonical_url
    having count(*) > 1
  ) then
    raise exception 'official import held page report contains duplicates'
      using errcode = '22023';
  end if;

  select run.* into v_run
  from public.official_import_runs as run
  where run.id = p_run_id
  for update;
  if not found or v_run.source_id is distinct from p_source_id then
    raise exception 'official import run is missing or source does not match'
      using errcode = '22023';
  end if;
  if v_run.status = 'completed' then
    return public.commit_owned_official_import_candidate_batch(
      p_run_id, p_source_id, p_attempt_token, p_candidates
    );
  end if;

  if p_source_id = 'event.kabuki-bito.schedule'
    and (p_candidates is null or jsonb_typeof(p_candidates) <> 'array') then
    raise exception 'official import candidates must be a JSON array'
      using errcode = '22023';
  end if;
  if p_source_id = 'event.kabuki-bito.schedule'
    and exists (
      select 1
      from jsonb_to_recordset(p_held_pages) as held(canonical_url text, official_external_id text)
      where held.official_external_id is null
        or pg_catalog.regexp_match(held.canonical_url,
          '^https://www\.kabuki-bito\.jp/theaters/([^/?#]+)/play/([0-9]+)/?$') is null
        or (pg_catalog.regexp_match(held.canonical_url,
        '^https://www\.kabuki-bito\.jp/theaters/([^/?#]+)/play/([0-9]+)/?$'))[2]
        is distinct from held.official_external_id
    ) then
    raise exception 'Kabuki held identity is not a verified work identity'
      using errcode = '22023';
  end if;
  if p_source_id = 'event.kabuki-bito.schedule' and (
    exists (
      select 1 from jsonb_to_recordset(p_held_pages) as held(official_external_id text)
      group by held.official_external_id having count(*) > 1
    )
    or exists (
      select 1
      from jsonb_to_recordset(p_candidates) as candidate(
        candidate_kind text, canonical_url text, official_external_id text
      )
      join jsonb_to_recordset(p_held_pages) as held(
        canonical_url text, official_external_id text
      ) on candidate.candidate_kind = 'event'
        and (candidate.official_external_id = held.official_external_id
          or candidate.canonical_url = held.canonical_url)
    )
  ) then
    raise exception 'Kabuki partial batch contains candidate and held identity collision'
      using errcode = '22023';
  end if;

  if v_run.status <> 'running'
    or v_run.active_attempt_token is distinct from p_attempt_token
    or v_run.active_attempt_lease_expires_at <= clock_timestamp() then
    raise exception 'official import attempt no longer owns the run'
      using errcode = '55000';
  end if;

  if p_source_id = 'event.kabuki-bito.schedule' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('official-import-candidates:' || p_source_id, 0)
    );
    select run.* into v_run
    from public.official_import_runs as run
    where run.id = p_run_id
    for update;
    if not found
      or v_run.status <> 'running'
      or v_run.source_id is distinct from p_source_id
      or v_run.active_attempt_token is distinct from p_attempt_token
      or v_run.active_attempt_lease_expires_at <= clock_timestamp() then
      raise exception 'official import attempt no longer owns the run'
        using errcode = '55000';
    end if;
  end if;

  if p_source_id = 'event.kabuki-bito.schedule' and (
    exists (
      select 1
      from jsonb_to_recordset(p_held_pages) as held(canonical_url text, official_external_id text)
      join public.official_import_candidates as prior
        on prior.source_id = p_source_id and prior.candidate_kind = 'event'
        and ((prior.official_external_id = held.official_external_id
            and prior.canonical_url is distinct from held.canonical_url)
          or (prior.canonical_url = held.canonical_url
            and prior.official_external_id is distinct from held.official_external_id))
    ) or exists (
      select 1
      from jsonb_to_recordset(p_held_pages) as held(canonical_url text, official_external_id text)
      join public.official_import_held_pages as prior
        on prior.source_id = p_source_id
        and ((prior.official_external_id = held.official_external_id
            and prior.canonical_url is distinct from held.canonical_url)
          or (prior.canonical_url = held.canonical_url
            and prior.official_external_id is distinct from held.official_external_id))
    )
  ) then
    raise exception 'Kabuki held identity conflicts with its canonical work URL'
      using errcode = '22023';
  end if;

  insert into public.official_import_held_pages (
    run_id, source_id, canonical_url, official_external_id,
    title, starts_on, ends_on, reason_code
  )
  select p_run_id, p_source_id, held.canonical_url,
    held.official_external_id, held.title, held.starts_on,
    held.ends_on, held.reason_code
  from jsonb_to_recordset(p_held_pages) as held(
    canonical_url text,
    official_external_id text,
    title text,
    starts_on date,
    ends_on date,
    reason_code text
  );

  return public.commit_owned_official_import_candidate_batch(
    p_run_id, p_source_id, p_attempt_token, p_candidates
  );
end;
$$;

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

create or replace function public.dismiss_failed_official_import_candidate(
  p_candidate_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_source_id text;
  v_candidate_kind text;
begin
  if v_actor is null or not exists (
    select 1 from public.catalog_creators where user_id = v_actor
  ) then
    raise exception 'dismissal is restricted to designated catalog creators'
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
  end if;

  perform set_config(
    'stage_tracker.official_import_dismiss_candidate_id',
    p_candidate_id::text,
    true
  );
  update public.official_import_candidates as candidate
  set dismissed_at = clock_timestamp(), dismissed_by = v_actor
  from public.official_import_runs as run
  where candidate.id = p_candidate_id
    and candidate.run_id = run.id
    and run.status = 'completed'
    and candidate.review_status = 'approved'
    and candidate.apply_status = 'failed'
    and candidate.dismissed_at is null;

  if not found then
    raise exception 'official import candidate is missing or not dismissible'
      using errcode = '22023';
  end if;
  return true;
end;
$$;

create or replace function public.apply_official_import_kabuki_event_candidate(
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
  if not private.official_import_kabuki_candidate_fresh_internal(v_candidate.id) then
    raise exception 'Kabuki candidate is not based on a fresh committed observation'
      using errcode = '40001', detail = 'stage_tracker.kabuki_freshness_refused.v1';
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
    or (p_set_genre and (not (v_candidate.proposal ? 'genre')
      or p_genre_key is distinct from v_candidate.proposal ->> 'genre'))
    or (p_set_groups and (not (v_candidate.proposal ? 'groups')
      or p_groups is distinct from coalesce(v_candidate.proposal -> 'groups', '[]'::jsonb))) then
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

create or replace function public.apply_reviewed_import_event_plan(
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
  p_expected_proposed_groups jsonb default null
) returns public.events
language plpgsql
set search_path = ''
as $$
declare
  v_event public.events;
  v_group record;
  v_expected_group record;
  v_actual_group public.groups;
  v_atomic_candidate_id text;
  v_atomic_attempt_token text;
begin
  if p_action is null or p_action not in ('create', 'update', 'unchanged') then
    raise exception 'unsupported reviewed Event action' using errcode = '22023';
  end if;

  if p_action = 'create' then
    if p_event_id is not null or p_expected_current is not null then
      raise exception 'create requires an absent Event snapshot' using errcode = '22023';
    end if;
    -- The unique events.source_key constraint remains the final race guard
    -- for a concurrent create under the same official identity.
  else
    if p_event_id is null or p_expected_current is null
      or jsonb_typeof(p_expected_current -> 'event') <> 'object'
      or jsonb_typeof(p_expected_current -> 'occurrences') <> 'array'
      or jsonb_typeof(p_expected_current -> 'groups') <> 'array' then
      raise exception 'reviewed Event snapshot is required' using errcode = '22023';
    end if;

    select * into v_event from public.events where id = p_event_id for update;
    if v_event.id is null then
      raise exception 'reviewed Event no longer exists' using errcode = '40001';
    end if;
    perform 1 from public.event_occurrences
      where event_id = p_event_id for update;
    perform 1 from public.event_groups
      where event_id = p_event_id for update;
    perform 1 from public.groups g
      join public.event_groups eg on eg.group_id = g.id
      where eg.event_id = p_event_id for update of g;
    perform 1 from public.genres
      where id = v_event.genre_id for update;

    if v_event.id is distinct from (p_expected_current #>> '{event,id}')::uuid
      or v_event.source_key is distinct from p_expected_current #>> '{event,source_key}'
      or v_event.owner_id is distinct from (p_expected_current #>> '{event,owner_id}')::uuid
      or v_event.title is distinct from p_expected_current #>> '{event,title}'
      or v_event.venue is distinct from p_expected_current #>> '{event,venue}'
      or v_event.source_url is distinct from p_expected_current #>> '{event,source_url}'
      or v_event.memo is distinct from p_expected_current #>> '{event,memo}'
      or v_event.starts_on is distinct from (p_expected_current #>> '{event,starts_on}')::date
      or v_event.ends_on is distinct from (p_expected_current #>> '{event,ends_on}')::date
      or v_event.genre_id is distinct from (p_expected_current #>> '{event,genre_id}')::uuid
      or (select key from public.genres where id = v_event.genre_id)
           is distinct from p_expected_current ->> 'genreKey'
      or v_event.canceled_at is distinct from (p_expected_current #>> '{event,canceled_at}')::timestamptz
      or exists (
        select id, starts_at, doors_at, ends_at, canceled_at
        from public.event_occurrences where event_id = p_event_id
        except
        select id, starts_at, doors_at, ends_at, canceled_at
        from jsonb_to_recordset(p_expected_current -> 'occurrences')
          as expected(id uuid, starts_at timestamptz, doors_at timestamptz,
                      ends_at timestamptz, canceled_at timestamptz)
      )
      or exists (
        select id, starts_at, doors_at, ends_at, canceled_at
        from jsonb_to_recordset(p_expected_current -> 'occurrences')
          as expected(id uuid, starts_at timestamptz, doors_at timestamptz,
                      ends_at timestamptz, canceled_at timestamptz)
        except
        select id, starts_at, doors_at, ends_at, canceled_at
        from public.event_occurrences where event_id = p_event_id
      )
      or exists (
        select g.key, g.display_name
        from public.event_groups eg join public.groups g on g.id = eg.group_id
        where eg.event_id = p_event_id
        except
        select key, "displayName"
        from jsonb_to_recordset(p_expected_current -> 'groups')
          as expected(key text, "displayName" text)
      )
      or exists (
        select key, "displayName"
        from jsonb_to_recordset(p_expected_current -> 'groups')
          as expected(key text, "displayName" text)
        except
        select g.key, g.display_name
        from public.event_groups eg join public.groups g on g.id = eg.group_id
        where eg.event_id = p_event_id
      ) then
      raise exception 'reviewed Event catalog changed before apply'
        using errcode = '40001';
    end if;
  end if;

  if p_source_key like 'kabuki-bito:%'
    or (p_event_id is not null and v_event.source_key like 'kabuki-bito:%') then
    v_atomic_candidate_id := nullif(
      current_setting('stage_tracker.official_import_atomic_candidate_id', true), ''
    );
    v_atomic_attempt_token := nullif(
      current_setting('stage_tracker.official_import_atomic_attempt_token', true), ''
    );
    if v_atomic_candidate_id is null
      or v_atomic_attempt_token is null
      or coalesce(current_setting('stage_tracker.official_import_atomic_event_id', true), '')
        is distinct from coalesce(p_event_id::text, '')
      or not exists (
        select 1
        from public.official_import_candidates as candidate
        where candidate.id::text = v_atomic_candidate_id
          and candidate.source_id = 'event.kabuki-bito.schedule'
          and candidate.candidate_kind = 'event'
          and candidate.review_status = 'approved'
          and candidate.apply_status = 'queued'
          and candidate.active_apply_attempt_token = v_atomic_attempt_token
          and candidate.active_apply_lease_expires_at > clock_timestamp()
          and candidate.proposal ->> 'sourceKey' = p_source_key
      ) then
      raise exception 'Kabuki reviewed writes require their candidate atomic context'
        using errcode = '55000';
    end if;
    if not private.official_import_kabuki_candidate_fresh_internal(v_atomic_candidate_id::uuid) then
      raise exception 'Kabuki candidate is not based on a fresh committed observation'
        using errcode = '40001', detail = 'stage_tracker.kabuki_freshness_refused.v1';
    end if;
  end if;

  if p_set_groups then
    if p_groups is null or jsonb_typeof(p_groups) <> 'array'
      or p_expected_proposed_groups is null
      or jsonb_typeof(p_expected_proposed_groups) <> 'array'
      or exists (
        select key from jsonb_to_recordset(p_groups) as proposed(key text, "displayName" text)
        except
        select key from jsonb_to_recordset(p_expected_proposed_groups)
          as expected(key text, "displayName" text)
      ) or exists (
        select key from jsonb_to_recordset(p_expected_proposed_groups)
          as expected(key text, "displayName" text)
        except
        select key from jsonb_to_recordset(p_groups) as proposed(key text, "displayName" text)
      ) or (select count(*) from jsonb_to_recordset(p_expected_proposed_groups)
             as expected(key text, "displayName" text))
           <> (select count(distinct key) from jsonb_to_recordset(p_groups)
                 as proposed(key text, "displayName" text)) then
      raise exception 'reviewed proposed Group snapshot is required'
        using errcode = '22023';
    end if;

    -- An Event may add a group that is already canonical for another Event.
    -- Lock every proposed key, not only groups already linked to this Event.
    -- For absent keys, reserve the unique key before applying classification:
    -- ON CONFLICT DO NOTHING waits for a concurrent insert and then fails
    -- closed instead of restoring a label that changed after review.
    for v_group in
      select key, "displayName" from jsonb_to_recordset(p_groups)
        as proposed(key text, "displayName" text)
      order by key
    loop
      select * into v_expected_group
      from jsonb_to_recordset(p_expected_proposed_groups)
        as expected(key text, "displayName" text)
      where key = v_group.key;
      select * into v_actual_group from public.groups
        where key = v_group.key for update;
      if v_expected_group."displayName" is null then
        if v_actual_group.id is not null then
          raise exception 'reviewed proposed Group changed before apply'
            using errcode = '40001';
        end if;
        insert into public.groups (key, display_name)
        values (v_group.key, v_group."displayName")
        on conflict (key) do nothing
        returning * into v_actual_group;
        if v_actual_group.id is null then
          raise exception 'reviewed proposed Group created concurrently'
            using errcode = '40001';
        end if;
      elsif v_actual_group.id is null
        or v_actual_group.display_name is distinct from v_expected_group."displayName" then
        raise exception 'reviewed proposed Group changed before apply'
          using errcode = '40001';
      end if;
    end loop;
  end if;

  select * into v_event from public.apply_import_event_plan(
    p_action := p_action,
    p_owner_id := p_owner_id,
    p_event_id := p_event_id,
    p_source_key := p_source_key,
    p_title := p_title,
    p_starts_on := p_starts_on,
    p_ends_on := p_ends_on,
    p_occurrences := p_occurrences,
    p_occurrence_fixes := p_occurrence_fixes,
    p_venue := p_venue,
    p_source_url := p_source_url,
    p_memo := p_memo,
    p_set_genre := p_set_genre,
    p_genre_key := p_genre_key,
    p_set_groups := p_set_groups,
    p_groups := p_groups
  );
  return v_event;
end;
$$;