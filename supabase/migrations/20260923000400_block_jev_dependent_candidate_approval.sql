-- Jev results are supporting evidence, not an apply-capable identity. Keep
-- the authenticated approval RPC aligned with the reviewed apply Workflow:
-- only candidates whose semantic match was not used may be approved. This
-- also protects pending candidates staged before the new UI eligibility rule.
--
-- Migration ordering: additive

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

  select * into v_candidate
  from public.official_import_candidates
  where id = p_candidate_id and review_status = 'pending'
  for update;

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
    and candidate.review_status = 'pending'
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

revoke execute on function public.review_official_import_candidate(uuid, text)
  from public, anon, authenticated;
grant execute on function public.review_official_import_candidate(uuid, text)
  to authenticated;
