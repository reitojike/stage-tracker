-- Serialize overlapping Workflow attempts for one stable official-import run.
--
-- The current production runtime does not call these staging RPCs. The new
-- nullable columns and owner-aware RPCs therefore land before the P3 runtime,
-- while unclaimed P2 runs keep their existing behavior.
--
-- Migration ordering: additive

alter table public.official_import_runs
  add column active_attempt_token text
    check (
      active_attempt_token is null
      or (
        active_attempt_token = btrim(active_attempt_token)
        and char_length(active_attempt_token) between 1 and 256
      )
    ),
  add column active_attempt_lease_expires_at timestamptz,
  add constraint official_import_runs_attempt_lease_pair_check
    check (
      (active_attempt_token is null)
      = (active_attempt_lease_expires_at is null)
    ),
  add constraint official_import_runs_terminal_has_no_attempt_check
    check (status = 'running' or active_attempt_token is null);

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
begin
  if tg_op = 'INSERT' then
    if new.status <> 'running'
      or new.finished_at is not null
      or new.failure_classification is not null
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

  if old.id is distinct from new.id
    or old.source_id is distinct from new.source_id
    or old.started_at is distinct from new.started_at
    or old.created_at is distinct from new.created_at then
    raise exception 'import run identity and start metadata are immutable'
      using errcode = '23514';
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

create function public.claim_official_import_run_attempt(
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

create function public.release_official_import_run_attempt(
  p_run_id uuid,
  p_source_id text,
  p_attempt_token text
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
    or p_attempt_token is null
    or p_attempt_token is distinct from btrim(p_attempt_token)
    or char_length(p_attempt_token) not between 1 and 256 then
    raise exception 'invalid official import attempt release'
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
  if v_run.status <> 'running' then
    return v_run.status;
  end if;
  if v_run.active_attempt_token is distinct from p_attempt_token then
    return 'not_owner';
  end if;

  perform set_config('stage_tracker.official_import_attempt_run_id', p_run_id::text, true);
  perform set_config('stage_tracker.official_import_attempt_token', p_attempt_token, true);

  update public.official_import_runs as run
  set active_attempt_token = null,
      active_attempt_lease_expires_at = null
  where run.id = p_run_id;

  perform set_config('stage_tracker.official_import_attempt_token', '', true);
  perform set_config('stage_tracker.official_import_attempt_run_id', '', true);

  return 'released';
end;
$$;

create function public.fail_official_import_run_attempt(
  p_run_id uuid,
  p_source_id text,
  p_attempt_token text,
  p_failure_classification text
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
    or p_attempt_token is null
    or p_attempt_token is distinct from btrim(p_attempt_token)
    or char_length(p_attempt_token) not between 1 and 256
    or p_failure_classification is null
    or p_failure_classification not in (
      'source_fetch',
      'source_parse',
      'provider_unavailable',
      'validation',
      'unexpected'
    ) then
    raise exception 'invalid official import attempt failure'
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
  if v_run.status <> 'running' then
    return v_run.status;
  end if;
  if v_run.active_attempt_token is distinct from p_attempt_token
    or v_run.active_attempt_lease_expires_at <= clock_timestamp() then
    return 'not_owner';
  end if;

  perform set_config('stage_tracker.official_import_attempt_run_id', p_run_id::text, true);
  perform set_config('stage_tracker.official_import_attempt_token', p_attempt_token, true);

  update public.official_import_runs as run
  set status = 'failed',
      finished_at = clock_timestamp(),
      failure_classification = p_failure_classification,
      active_attempt_token = null,
      active_attempt_lease_expires_at = null
  where run.id = p_run_id;

  perform set_config('stage_tracker.official_import_attempt_token', '', true);
  perform set_config('stage_tracker.official_import_attempt_run_id', '', true);

  return 'failed';
end;
$$;

create function public.commit_owned_official_import_candidate_batch(
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
  if v_run.active_attempt_token is distinct from p_attempt_token
    or v_run.active_attempt_lease_expires_at <= clock_timestamp() then
    raise exception 'official import attempt no longer owns the run'
      using errcode = '55000';
  end if;

  perform set_config('stage_tracker.official_import_attempt_run_id', p_run_id::text, true);
  perform set_config('stage_tracker.official_import_attempt_token', p_attempt_token, true);

  -- The row lock is held until this transaction ends. Clearing the lease
  -- before delegating lets the existing atomic batch RPC complete the run
  -- without violating the terminal-no-owner constraint, while no competing
  -- claim can observe the intermediate state.
  update public.official_import_runs as run
  set active_attempt_token = null,
      active_attempt_lease_expires_at = null
  where run.id = p_run_id;

  v_candidate_count := public.commit_official_import_candidate_batch(
    p_run_id,
    p_source_id,
    p_candidates
  );

  perform set_config('stage_tracker.official_import_attempt_token', '', true);
  perform set_config('stage_tracker.official_import_attempt_run_id', '', true);

  return v_candidate_count;
end;
$$;

revoke execute on function public.claim_official_import_run_attempt(uuid, text, text, integer)
  from public, anon, authenticated;
revoke execute on function public.release_official_import_run_attempt(uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.fail_official_import_run_attempt(uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.commit_owned_official_import_candidate_batch(uuid, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.claim_official_import_run_attempt(uuid, text, text, integer)
  to service_role;
grant execute on function public.release_official_import_run_attempt(uuid, text, text)
  to service_role;
grant execute on function public.fail_official_import_run_attempt(uuid, text, text, text)
  to service_role;
grant execute on function public.commit_owned_official_import_candidate_batch(uuid, text, text, jsonb)
  to service_role;
