-- A reviewed Event binding is separate from immutable source evidence.
-- Only the guarded review RPC may turn a blocked ticket candidate into approved.
create table public.official_import_ticket_event_bindings (
  source_id text not null,
  ticket_source_key text not null,
  event_id uuid not null references public.events (id) on delete cascade,
  event_source_key text not null,
  candidate_id uuid not null,
  reviewer uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (source_id, ticket_source_key)
);

alter table public.official_import_ticket_event_bindings enable row level security;
revoke all on public.official_import_ticket_event_bindings from public, anon, authenticated;
grant select on public.official_import_ticket_event_bindings to service_role;

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

create function public.bind_official_import_ticket_candidate(
  p_candidate_id uuid,
  p_event_id uuid
) returns public.official_import_candidates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_candidate public.official_import_candidates;
  v_event_source_key text;
  v_existing_event_id uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.catalog_creators where user_id = v_actor
  ) then
    raise exception 'review is restricted to designated catalog creators'
      using errcode = '42501';
  end if;

  select candidate.* into v_candidate
  from public.official_import_candidates as candidate
  join public.official_import_runs as run on run.id = candidate.run_id
  where candidate.id = p_candidate_id
    and candidate.candidate_kind = 'ticket_opportunity'
    and candidate.review_status = 'blocked_for_identity_review'
    and candidate.apply_status = 'not_started'
    and run.status = 'completed'
  for update of candidate;
  if not found or nullif(v_candidate.proposal ->> 'sourceKey', '') is null then
    raise exception 'ticket candidate is missing or no longer reviewable'
      using errcode = '22023';
  end if;

  select event.source_key into v_event_source_key
  from public.events as event
  where event.id = p_event_id and event.canceled_at is null
  for key share;
  if not found or v_event_source_key is null then
    raise exception 'selected Event is unavailable or has no official identity'
      using errcode = '22023';
  end if;

  insert into public.official_import_ticket_event_bindings (
    source_id, ticket_source_key, event_id, event_source_key,
    candidate_id, reviewer
  ) values (
    v_candidate.source_id, v_candidate.proposal ->> 'sourceKey',
    p_event_id, v_event_source_key, p_candidate_id, v_actor
  ) on conflict (source_id, ticket_source_key) do nothing;

  select binding.event_id into v_existing_event_id
  from public.official_import_ticket_event_bindings as binding
  where binding.source_id = v_candidate.source_id
    and binding.ticket_source_key = v_candidate.proposal ->> 'sourceKey'
  for update;
  if v_existing_event_id is distinct from p_event_id then
    raise exception 'ticket source is already bound to another Event'
      using errcode = '22023';
  end if;

  update public.official_import_ticket_event_bindings as binding
  set candidate_id = p_candidate_id,
      reviewer = v_actor
  where binding.source_id = v_candidate.source_id
    and binding.ticket_source_key = v_candidate.proposal ->> 'sourceKey';

  perform set_config(
    'stage_tracker.official_import_manual_candidate_id',
    p_candidate_id::text,
    true
  );
  update public.official_import_candidates
  set review_status = 'approved', reviewer = v_actor, reviewed_at = now()
  where id = p_candidate_id
  returning * into v_candidate;
  perform set_config('stage_tracker.official_import_manual_candidate_id', '', true);
  return v_candidate;
end;
$$;

revoke execute on function public.bind_official_import_ticket_candidate(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.bind_official_import_ticket_candidate(uuid, uuid)
  to authenticated;
