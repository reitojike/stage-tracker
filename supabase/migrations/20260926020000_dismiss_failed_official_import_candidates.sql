-- A failed apply may be acknowledged without erasing the approved proposal or
-- its failure evidence. Only a designated catalog creator can close it.
alter table public.official_import_candidates
  add column dismissed_at timestamptz,
  add column dismissed_by uuid references auth.users (id),
  add constraint official_import_candidate_dismissal_pair
    check ((dismissed_at is null) = (dismissed_by is null)),
  add constraint official_import_candidate_dismissal_failed_only
    check (dismissed_at is null or (review_status = 'approved' and apply_status = 'failed'));

create function public.enforce_official_import_candidate_dismissal() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.dismissed_at is not null then
    if new.dismissed_at is distinct from old.dismissed_at
      or new.dismissed_by is distinct from old.dismissed_by
      or new.apply_status is distinct from old.apply_status then
      raise exception 'dismissed official import candidate is terminal'
        using errcode = '23514';
    end if;
  elsif new.dismissed_at is not null or new.dismissed_by is not null then
    if old.review_status <> 'approved'
      or old.apply_status <> 'failed'
      or new.review_status is distinct from old.review_status
      or new.apply_status is distinct from old.apply_status
      or new.dismissed_at is null
      or new.dismissed_by is distinct from auth.uid()
      or current_setting('stage_tracker.official_import_dismiss_candidate_id', true)
        is distinct from old.id::text then
      raise exception 'only a failed candidate may be dismissed by its review RPC'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger official_import_candidate_dismissal_guard
  before update on public.official_import_candidates
  for each row
  execute function public.enforce_official_import_candidate_dismissal();

create function public.dismiss_failed_official_import_candidate(
  p_candidate_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (
    select 1 from public.catalog_creators where user_id = v_actor
  ) then
    raise exception 'dismissal is restricted to designated catalog creators'
      using errcode = '42501';
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

revoke execute on function public.dismiss_failed_official_import_candidate(uuid)
  from public, anon, authenticated;
grant execute on function public.dismiss_failed_official_import_candidate(uuid)
  to authenticated;
