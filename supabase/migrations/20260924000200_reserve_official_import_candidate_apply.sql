-- An authenticated apply request must protect its candidate before the
-- asynchronous Workflow has a chance to claim an apply lease. The reservation
-- is monotonic: an uncertain Workflow start can be retried without reopening
-- the candidate to supersession.
--
-- Migration ordering: additive

alter table public.official_import_candidates
  add column apply_requested_at timestamptz;

create function public.enforce_official_import_apply_reservation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.apply_requested_at is not null then
      raise exception 'new candidates cannot reserve an apply'
        using errcode = '23514';
    end if;
  elsif old.apply_requested_at is distinct from new.apply_requested_at then
    if old.apply_requested_at is not null
      or new.apply_requested_at is null
      or new.review_status <> 'approved'
      or new.apply_status <> 'not_started'
      or current_setting(
        'stage_tracker.official_import_apply_reservation_candidate_id', true
      ) is distinct from old.id::text then
      raise exception 'candidate apply reservation may only be set by its request RPC'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger official_import_candidates_apply_reservation_guard
  before insert or update on public.official_import_candidates
  for each row
  execute function public.enforce_official_import_apply_reservation();

create function public.reserve_official_import_candidate_apply(
  p_candidate_id uuid
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate public.official_import_candidates;
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (
    select 1 from public.catalog_creators cc where cc.user_id = v_actor
  ) then
    raise exception 'apply is restricted to designated catalog creators'
      using errcode = '42501';
  end if;

  if p_candidate_id is null then
    raise exception 'candidate id is required' using errcode = '22023';
  end if;

  select candidate.* into v_candidate
  from public.official_import_candidates as candidate
  where candidate.id = p_candidate_id
  for update;

  if not found or v_candidate.review_status <> 'approved' then
    return 'not_available';
  end if;

  if v_candidate.candidate_kind = 'event'
    and v_candidate.resolved_event_id is not null
    and not exists (
      select 1 from public.events e
      where e.id = v_candidate.resolved_event_id and e.owner_id = v_actor
    ) then
    raise exception 'only the matched Event owner may apply its import'
      using errcode = '42501';
  end if;

  if v_candidate.apply_status = 'applied' then
    return 'applied';
  elsif v_candidate.apply_status = 'queued' then
    return 'busy';
  elsif v_candidate.apply_status = 'failed' then
    return 'ready';
  end if;

  if v_candidate.apply_requested_at is null then
    perform set_config(
      'stage_tracker.official_import_apply_reservation_candidate_id',
      p_candidate_id::text,
      true
    );

    update public.official_import_candidates as candidate
    set apply_requested_at = clock_timestamp()
    where candidate.id = p_candidate_id;

    perform set_config(
      'stage_tracker.official_import_apply_reservation_candidate_id', '', true
    );
  end if;

  return 'ready';
end;
$$;

revoke execute on function public.reserve_official_import_candidate_apply(uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_official_import_candidate_apply(uuid)
  to authenticated;
