-- Issue #634: different Workflow run IDs must not fetch the same source while
-- another run owns a live attempt lease. The existing run-level ownership
-- remains the authority for retries and terminal status.
--
-- Migration ordering: additive. The RPC signature and result vocabulary are
-- unchanged; the deployed Workflow already retries the existing 'busy' result.

create or replace function public.claim_official_import_run_attempt(
  p_run_id uuid,
  p_source_id text,
  p_attempt_token text,
  p_lease_seconds integer
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.official_import_runs;
begin
  if p_run_id is null
    or p_source_id is null
    or char_length(btrim(p_source_id)) not between 1 and 128
    or p_attempt_token is null
    or p_attempt_token is distinct from btrim(p_attempt_token)
    or char_length(p_attempt_token) not between 1 and 256
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 3600 then
    raise exception 'invalid official import attempt claim'
      using errcode = '22023';
  end if;

  insert into public.official_import_runs (id, source_id)
  values (p_run_id, p_source_id)
  on conflict (id) do nothing;

  select run.* into v_run
  from public.official_import_runs as run
  where run.id = p_run_id
  for update;

  if v_run.source_id is distinct from p_source_id then
    raise exception 'official import run source does not match'
      using errcode = '22023';
  end if;

  if v_run.status <> 'running' then
    return v_run.status;
  end if;

  if v_run.active_attempt_token is not null
    and v_run.active_attempt_token is distinct from p_attempt_token
    and v_run.active_attempt_lease_expires_at > clock_timestamp() then
    return 'busy';
  end if;

  -- Keep the lock order consistent with batch publication: own run row first,
  -- then the source advisory lock. It serializes different run IDs without a
  -- new persisted scheduler or a source-wide global bottleneck.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('official-import-candidates:' || p_source_id, 0)
  );

  if exists (
    select 1
    from public.official_import_runs as other_run
    where other_run.source_id = p_source_id
      and other_run.id <> p_run_id
      and other_run.status = 'running'
      and other_run.active_attempt_token is not null
      and other_run.active_attempt_lease_expires_at > clock_timestamp()
  ) then
    return 'busy';
  end if;

  perform set_config(
    'stage_tracker.official_import_attempt_run_id',
    p_run_id::text,
    true
  );
  perform set_config(
    'stage_tracker.official_import_attempt_token',
    p_attempt_token,
    true
  );

  update public.official_import_runs as run
  set active_attempt_token = p_attempt_token,
      active_attempt_lease_expires_at =
        clock_timestamp() + p_lease_seconds * interval '1 second'
  where run.id = p_run_id;

  perform set_config('stage_tracker.official_import_attempt_token', '', true);
  perform set_config('stage_tracker.official_import_attempt_run_id', '', true);

  return 'claimed';
end;
$$;
