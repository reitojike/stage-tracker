-- Reviewed ticket identities may point at manually created Events. Their
-- source_key is intentionally null; event_id remains the durable catalog link.
alter table public.official_import_ticket_event_bindings
  alter column event_source_key drop not null;

create or replace function public.bind_official_import_ticket_candidate(
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
  if not found then
    raise exception 'selected Event is unavailable'
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
      reviewer = v_actor,
      event_source_key = v_event_source_key
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
