-- Issue #761 / parent #634: bounded latest-failure clues, not an item ledger.
-- Migration ordering: additive; existing ingestion RPCs and state are unchanged.

create table public.official_import_failure_observations (
  run_id uuid primary key references public.official_import_runs (id) on delete cascade,
  source_id text not null check (char_length(source_id) between 1 and 128),
  observed_at timestamptz not null default clock_timestamp(),
  phase text not null check (phase in ('acquisition', 'planning', 'publication')),
  reason_code text not null check (reason_code in (
    'source_fetch', 'unsupported_format', 'request_limit',
    'provider_unavailable', 'validation', 'unexpected'
  )),
  canonical_url text check (
    char_length(canonical_url) <= 2048
    and canonical_url ~ '^https://[a-zA-Z0-9.-]+/[a-zA-Z0-9/%_.:-]*$'
  ),
  official_external_id text check (
    char_length(official_external_id) between 1 and 512
    and official_external_id ~ '^[a-zA-Z0-9][a-zA-Z0-9:._-]*$'
  ),
  acquired_draft_count integer check (acquired_draft_count between 0 and 10000),
  validated_candidate_count integer not null check (validated_candidate_count between 0 and 10000),
  held_page_count integer not null check (held_page_count between 0 and 30),
  check (acquired_draft_count is null or validated_candidate_count <= acquired_draft_count),
  check (
    (phase = 'acquisition' and acquired_draft_count is null and validated_candidate_count = 0)
    or (phase <> 'acquisition' and acquired_draft_count is not null)
  )
);

comment on table public.official_import_failure_observations is
  'Latest owned failure clue per run. Counts are provisional, not source completeness or publication evidence; run status remains authoritative.';
comment on column public.official_import_failure_observations.acquired_draft_count is
  'Drafts returned by acquisition in the failing attempt; NULL when acquisition did not return. Not expected source coverage.';
comment on column public.official_import_failure_observations.validated_candidate_count is
  'Candidates validated in memory before failure in this attempt, not committed candidates or complete coverage.';
comment on column public.official_import_failure_observations.held_page_count is
  'Valid holds discovered before failure in this attempt; may be incomplete and are not published by this observation.';

alter table public.official_import_failure_observations enable row level security;
revoke all on public.official_import_failure_observations from public, anon, authenticated, service_role;
grant select on public.official_import_failure_observations to authenticated, service_role;
create policy official_import_failure_observations_select_catalog_creators
  on public.official_import_failure_observations for select to authenticated
  using (exists (select 1 from public.catalog_creators cc where cc.user_id = auth.uid()));

-- Only this RPC may write observations. It locks/checks the existing run lease
-- without changing it; the ownership token is never copied to the record.
create function public.record_owned_official_import_failure_observation(
  p_run_id uuid,
  p_source_id text,
  p_attempt_token text,
  p_phase text,
  p_reason_code text,
  p_canonical_url text default null,
  p_official_external_id text default null,
  p_acquired_draft_count integer default null,
  p_validated_candidate_count integer default null,
  p_held_page_count integer default null
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_run public.official_import_runs;
begin
  if p_run_id is null or p_source_id is null or p_attempt_token is null then
    raise exception 'invalid official import observation identity' using errcode = '22023';
  end if;
  select run.* into v_run from public.official_import_runs run
  where run.id = p_run_id for update;
  if not found or v_run.source_id is distinct from p_source_id then
    raise exception 'official import observation source does not match' using errcode = '22023';
  end if;
  if v_run.status <> 'running'
    or v_run.active_attempt_token is distinct from p_attempt_token
    or v_run.active_attempt_lease_expires_at is null
    or v_run.active_attempt_lease_expires_at <= clock_timestamp() then
    return false;
  end if;

  insert into public.official_import_failure_observations (
    run_id, source_id, phase, reason_code, canonical_url, official_external_id,
    acquired_draft_count, validated_candidate_count, held_page_count
  ) values (
    p_run_id, p_source_id, p_phase, p_reason_code, p_canonical_url, p_official_external_id,
    p_acquired_draft_count, p_validated_candidate_count, p_held_page_count
  ) on conflict (run_id) do update set
    observed_at = clock_timestamp(), phase = excluded.phase, reason_code = excluded.reason_code,
    canonical_url = excluded.canonical_url, official_external_id = excluded.official_external_id,
    acquired_draft_count = excluded.acquired_draft_count,
    validated_candidate_count = excluded.validated_candidate_count,
    held_page_count = excluded.held_page_count;
  return true;
end;
$$;

revoke execute on function public.record_owned_official_import_failure_observation(
  uuid, text, text, text, text, text, text, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.record_owned_official_import_failure_observation(
  uuid, text, text, text, text, text, text, integer, integer, integer
) to service_role;
