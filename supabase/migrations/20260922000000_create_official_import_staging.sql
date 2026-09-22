-- Official source ingestion staging/review boundary (Issue #628).
--
-- This is an operational candidate store, not a second product catalog. The
-- source registry remains code-owned, and this migration deliberately does
-- not retain fetched HTML, PDF bytes, or any other raw source archive.
--
-- Migration ordering: additive
--
-- The tables and RPC below are new additive objects alongside the existing schema.
-- No currently deployed runtime reads or writes them, and no Event,
-- Occurrence, or TicketOpportunity mutation is performed here.

create table public.official_import_runs (
  id uuid primary key default gen_random_uuid(),
  source_id text not null
    check (char_length(btrim(source_id)) between 1 and 128),
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  candidate_count integer not null default 0
    check (candidate_count >= 0),
  failure_classification text
    check (
      failure_classification is null
      or failure_classification in (
        'source_fetch',
        'source_parse',
        'provider_unavailable',
        'validation',
        'unexpected'
      )
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'running' and finished_at is null)
    or (status in ('completed', 'failed') and finished_at is not null)
  ),
  check (
    (status = 'failed') = (failure_classification is not null)
  )
);

create index official_import_runs_source_id_idx
  on public.official_import_runs (source_id, started_at desc);

create table public.official_import_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.official_import_runs (id),
  source_id text not null
    check (char_length(btrim(source_id)) between 1 and 128),
  candidate_kind text not null
    check (candidate_kind in ('event', 'ticket_opportunity')),
  canonical_url text not null
    check (
      char_length(btrim(canonical_url)) between 1 and 2048
      and canonical_url ~ '^https?://'
    ),
  official_external_id text
    check (official_external_id is null or char_length(official_external_id) <= 512),
  observed_at timestamptz not null default now(),
  content_hash text not null
    check (content_hash ~ '^[0-9a-f]{64}$'),
  etag text
    check (etag is null or char_length(etag) <= 512),
  last_modified text
    check (last_modified is null or char_length(last_modified) <= 128),

  -- These JSON values are deliberately bounded structured payloads. They are
  -- not a raw response/document dump; the size checks make that distinction
  -- executable at the database boundary.
  proposal_version text not null
    check (char_length(btrim(proposal_version)) between 1 and 64),
  proposal jsonb not null
    check (
      jsonb_typeof(proposal) = 'object'
      and octet_length(proposal::text) <= 32768
    ),
  evidence_locator jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(evidence_locator) = 'object'
      and octet_length(evidence_locator::text) <= 2048
    ),

  deterministic_match_status text not null default 'unresolved'
    check (
      deterministic_match_status in ('unresolved', 'matched', 'unmatched', 'ambiguous')
    ),
  semantic_match_status text not null default 'not_used'
    check (
      semantic_match_status in ('not_used', 'matched', 'unmatched', 'ambiguous', 'low_confidence')
    ),
  resolved_event_id uuid references public.events (id) on delete set null,
  resolved_ticket_opportunity_id uuid references public.ticket_opportunities (id) on delete set null,
  jev_decision_evidence jsonb
    check (
      jev_decision_evidence is null
      or (
        jsonb_typeof(jev_decision_evidence) = 'object'
        and octet_length(jev_decision_evidence::text) <= 4096
      )
    ),
  plan_summary jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(plan_summary) = 'object'
      and octet_length(plan_summary::text) <= 8192
    ),
  plan_fingerprint text not null
    check (char_length(btrim(plan_fingerprint)) between 1 and 128),

  -- Review and apply are separate state machines. Review is human-facing;
  -- apply is reserved for the later trusted apply workflow.
  review_status text not null default 'pending'
    check (
      review_status in ('pending', 'approved', 'rejected', 'blocked_for_identity_review')
    ),
  reviewer uuid references auth.users (id),
  reviewed_at timestamptz,
  apply_status text not null default 'not_started'
    check (apply_status in ('not_started', 'queued', 'applied', 'failed')),
  applied_at timestamptz,
  failure_classification text
    check (
      failure_classification is null
      or failure_classification in (
        'validation',
        'identity_ambiguous',
        'source_changed',
        'target_missing',
        'write_conflict',
        'provider_unavailable',
        'policy_blocked',
        'unexpected'
      )
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (review_status in ('pending', 'blocked_for_identity_review')
      and reviewer is null and reviewed_at is null)
    or (review_status in ('approved', 'rejected')
      and reviewer is not null and reviewed_at is not null)
  ),
  check (
    (apply_status = 'applied' and applied_at is not null)
    or (apply_status <> 'applied' and applied_at is null)
  ),
  check (
    (apply_status = 'failed') = (failure_classification is not null)
  ),
  check (apply_status = 'not_started' or review_status = 'approved')
);

create index official_import_candidates_review_queue_idx
  on public.official_import_candidates (review_status, observed_at desc);
create index official_import_candidates_run_id_idx
  on public.official_import_candidates (run_id);
create index official_import_candidates_source_identity_idx
  on public.official_import_candidates (source_id, candidate_kind, official_external_id);

-- Keep operational timestamps database-owned. These functions intentionally
-- remain per-table, matching the repository's existing trigger style rather
-- than introducing generic schema-wide infrastructure.
create function public.set_official_import_runs_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger official_import_runs_set_updated_at
  before update on public.official_import_runs
  for each row
  execute function public.set_official_import_runs_updated_at();

create function public.enforce_official_import_run_state() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.source_id is distinct from new.source_id then
    raise exception 'import run source_id is immutable'
      using errcode = '23514';
  end if;

  if old.status is distinct from new.status then
    if old.status <> 'running' then
      raise exception 'completed or failed import runs are terminal'
        using errcode = '23514';
    end if;
    if new.status not in ('completed', 'failed') then
      raise exception 'running import runs may only complete or fail'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger official_import_runs_state_guard
  before update on public.official_import_runs
  for each row
  execute function public.enforce_official_import_run_state();

create function public.set_official_import_candidates_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger official_import_candidates_set_updated_at
  before update on public.official_import_candidates
  for each row
  execute function public.set_official_import_candidates_updated_at();

-- Enforce the candidate state machine even for the trusted writer. The
-- review RPC is the only authenticated review path and supplies reviewer from
-- auth.uid(); service_role cannot approve/reject by merely updating a row.
create function public.enforce_official_import_candidate_state() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.review_status <> 'pending'
      or new.reviewer is not null
      or new.reviewed_at is not null
      or new.apply_status <> 'not_started'
      or new.applied_at is not null
      or new.failure_classification is not null then
      raise exception 'candidates must enter pending and not_started'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if old.run_id is distinct from new.run_id
      or old.source_id is distinct from new.source_id then
      raise exception 'candidate run and source identity are immutable'
        using errcode = '23514';
    end if;

    if old.review_status <> 'pending'
      and (
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
        or old.resolved_event_id is distinct from new.resolved_event_id
        or old.resolved_ticket_opportunity_id is distinct from new.resolved_ticket_opportunity_id
        or old.jev_decision_evidence is distinct from new.jev_decision_evidence
        or old.plan_summary is distinct from new.plan_summary
        or old.plan_fingerprint is distinct from new.plan_fingerprint
        or old.created_at is distinct from new.created_at
      ) then
      raise exception 'reviewed candidate contents are immutable'
        using errcode = '23514';
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
  end if;

  if new.source_id is distinct from (
    select r.source_id
    from public.official_import_runs r
    where r.id = new.run_id
  ) then
    raise exception 'candidate source_id must match its import run'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger official_import_candidates_state_guard
  before insert or update on public.official_import_candidates
  for each row
  execute function public.enforce_official_import_candidate_state();

alter table public.official_import_runs enable row level security;
alter table public.official_import_candidates enable row level security;

-- No client role can write staging data. Revoke PUBLIC as well as the named
-- Supabase client roles so residual default privileges cannot reopen a path.
revoke all on public.official_import_runs from public, anon, authenticated;
revoke all on public.official_import_candidates from public, anon, authenticated;

grant select, insert, update, delete on public.official_import_runs to service_role;
grant select, insert, update, delete on public.official_import_candidates to service_role;
grant select on public.official_import_runs to authenticated;
grant select on public.official_import_candidates to authenticated;

create policy official_import_runs_select_catalog_creators
  on public.official_import_runs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.catalog_creators cc
      where cc.user_id = auth.uid()
    )
  );

create policy official_import_candidates_select_catalog_creators
  on public.official_import_candidates
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.catalog_creators cc
      where cc.user_id = auth.uid()
    )
  );

-- Narrow authenticated review boundary. The client supplies only the
-- candidate and the bounded decision; reviewer and reviewed_at are derived
-- here. No product table is touched by this function.
create function public.review_official_import_candidate(
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
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_review_status is null or p_review_status not in ('approved', 'rejected') then
    raise exception 'review status must be approved or rejected'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.catalog_creators cc
    where cc.user_id = v_actor
  ) then
    raise exception 'review is restricted to designated catalog creators'
      using errcode = '42501';
  end if;

  update public.official_import_candidates
  set review_status = p_review_status,
      reviewer = v_actor,
      reviewed_at = now()
  where id = p_candidate_id
    and review_status = 'pending'
  returning * into v_candidate;

  if not found then
    raise exception 'official import candidate is missing or no longer reviewable'
      using errcode = '22023';
  end if;

  return v_candidate;
end;
$$;

revoke execute on function public.review_official_import_candidate(uuid, text)
  from public, anon, authenticated;
grant execute on function public.review_official_import_candidate(uuid, text)
  to authenticated;
