-- Issue #761 / parent #634: terminal-only bounded failure clues.
-- Migration ordering: additive. The original four-argument RPC is unchanged.
-- Deploy/verify the seven-argument overload and schema cache before new callers.

alter table public.official_import_runs
  add column failure_phase text check (failure_phase in ('acquisition', 'planning', 'publication')),
  add column failure_reason text check (failure_reason in ('source_fetch', 'unsupported_format', 'request_limit', 'provider_unavailable', 'validation', 'unexpected')),
  add column failure_url text check (failure_url is null or (failure_phase <> 'publication' and (char_length(failure_url) between 1 and 2048 and (case source_id
      when 'event.kabuki-bito.schedule' then failure_url ~ '^https://www[.]kabuki-bito[.]jp/(schedule/|theaters/[a-z-]{1,64}/play/[0-9]{1,10}/?)$'
      when 'ticket.shochiku.schedule' then failure_url ~ '^https://www[.]kabuki-bito[.]jp/(schedule/|theaters/[a-z-]{1,64}/play/[0-9]{1,10}/?)$' or failure_url ~ '^https://www1[.]ticket-web-shochiku[.]com/t/info/(schedule|sale_schedule_east|sale_schedule_west)[.]html$'
      when 'event.takarazuka.revue' then failure_url ~ '^https://kageki[.]hankyu[.]co[.]jp/(sp/)?revue/(index[.]html|[0-9]{4}/[a-z0-9_-]{1,80}/(index|schedule_takarazuka|schedule_tokyo|ticket_takarazuka|ticket_tokyo)[.]html)$'
      when 'ticket.takarazuka.revue-general-sale' then failure_url ~ '^https://kageki[.]hankyu[.]co[.]jp/(sp/)?revue/(index[.]html|[0-9]{4}/[a-z0-9_-]{1,80}/(index|schedule_takarazuka|schedule_tokyo|ticket_takarazuka|ticket_tokyo)[.]html)$' and failure_url like 'https://kageki.hankyu.co.jp/sp/revue/%'
      else false end)))),
  add constraint official_import_runs_terminal_clues_check check (
    (failure_phase is null and failure_reason is null and failure_url is null)
    or (status = 'failed' and failure_phase is not null and failure_reason is not null
      and (failure_reason = failure_classification
        or (failure_classification = 'source_parse' and failure_reason in ('unsupported_format', 'request_limit'))))
  );

comment on column public.official_import_runs.failure_phase is 'Optional terminal-failure phase; never coverage or transient-attempt history.';
comment on column public.official_import_runs.failure_reason is 'Optional bounded clue; failure_classification remains authoritative.';
comment on column public.official_import_runs.failure_url is 'Optional allowlisted official page locator, without credentials, query, fragment or raw content.';

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
      or new.failure_phase is not null
      or new.failure_reason is not null
      or new.failure_url is not null
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

create function public.fail_official_import_run_attempt(
  p_run_id uuid,
  p_source_id text,
  p_attempt_token text,
  p_failure_classification text,
  p_failure_phase text,
  p_failure_reason text,
  p_failure_url text
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.official_import_runs;
  v_phase text;
  v_reason text;
  v_url text;
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

  -- Optional diagnostics are normalized only after the original ownership gate.
  -- No extra query, lock, request, wait, lease renewal or retry is introduced.
  if p_failure_phase in ('acquisition', 'planning', 'publication')
    and ((p_failure_classification = 'source_parse' and p_failure_reason in ('unsupported_format', 'request_limit'))
      or (p_failure_classification <> 'source_parse' and p_failure_reason = p_failure_classification)) then
    v_phase := p_failure_phase;
    v_reason := p_failure_reason;
    if v_phase <> 'publication' and char_length(p_failure_url) between 1 and 2048 and (case p_source_id
      when 'event.kabuki-bito.schedule' then p_failure_url ~ '^https://www[.]kabuki-bito[.]jp/(schedule/|theaters/[a-z-]{1,64}/play/[0-9]{1,10}/?)$'
      when 'ticket.shochiku.schedule' then p_failure_url ~ '^https://www[.]kabuki-bito[.]jp/(schedule/|theaters/[a-z-]{1,64}/play/[0-9]{1,10}/?)$' or p_failure_url ~ '^https://www1[.]ticket-web-shochiku[.]com/t/info/(schedule|sale_schedule_east|sale_schedule_west)[.]html$'
      when 'event.takarazuka.revue' then p_failure_url ~ '^https://kageki[.]hankyu[.]co[.]jp/(sp/)?revue/(index[.]html|[0-9]{4}/[a-z0-9_-]{1,80}/(index|schedule_takarazuka|schedule_tokyo|ticket_takarazuka|ticket_tokyo)[.]html)$'
      when 'ticket.takarazuka.revue-general-sale' then p_failure_url ~ '^https://kageki[.]hankyu[.]co[.]jp/(sp/)?revue/(index[.]html|[0-9]{4}/[a-z0-9_-]{1,80}/(index|schedule_takarazuka|schedule_tokyo|ticket_takarazuka|ticket_tokyo)[.]html)$' and p_failure_url like 'https://kageki.hankyu.co.jp/sp/revue/%'
      else false end) then
      v_url := p_failure_url;
    end if;
  end if;

  perform set_config('stage_tracker.official_import_attempt_run_id', p_run_id::text, true);
  perform set_config('stage_tracker.official_import_attempt_token', p_attempt_token, true);

  update public.official_import_runs as run
  set status = 'failed',
      finished_at = clock_timestamp(),
      failure_classification = p_failure_classification,
      failure_phase = v_phase,
      failure_reason = v_reason,
      failure_url = v_url,
      active_attempt_token = null,
      active_attempt_lease_expires_at = null
  where run.id = p_run_id;

  perform set_config('stage_tracker.official_import_attempt_token', '', true);
  perform set_config('stage_tracker.official_import_attempt_run_id', '', true);

  return 'failed';
end;
$$;

-- No defaults: four named keys retain the unchanged original RPC; seven keys
-- select this overload. Never retry the old signature after a schema miss.
revoke execute on function public.fail_official_import_run_attempt(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.fail_official_import_run_attempt(uuid, text, text, text, text, text, text) to service_role;
