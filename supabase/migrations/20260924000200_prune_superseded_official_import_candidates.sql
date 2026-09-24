-- Issue #634: a newer candidate for the same official source identity replaces
-- older, unapplied review proposals. Applied, queued, failed, and rejected rows
-- remain as audit/operational evidence. This never deletes catalog Events or
-- TicketOpportunities. The batch insert and pruning are one transaction;
-- completed import runs remain intact.
--
-- Migration ordering: additive. The RPC signature and result are unchanged;
-- a zero candidate count and an empty review queue were already valid.

create or replace function public.enforce_official_import_candidate_delete() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_run_status text;
  v_cleanup_run_id text := current_setting(
    'stage_tracker.official_import_batch_run_id', true
  );
  v_superseding_run_id text := current_setting(
    'stage_tracker.official_import_superseding_run_id', true
  );
begin
  select run.status into v_run_status
  from public.official_import_runs as run
  where run.id = old.run_id
  for update;

  if not found then
    raise exception 'candidate parent import run is missing'
      using errcode = '23514';
  end if;

  -- Preserve the existing retry cleanup for an unfinished run.
  if v_run_status = 'running'
    and old.apply_status = 'not_started'
    and (
      old.review_status = 'pending'
      or (
        old.review_status = 'blocked_for_identity_review'
        and v_cleanup_run_id = old.run_id::text
      )
    ) then
    return old;
  end if;

  if v_run_status = 'completed'
    and old.apply_status = 'not_started'
    and old.review_status in (
      'pending', 'approved', 'blocked_for_identity_review'
    )
    and (
      -- Used only by this migration while holding the table's write lock.
      (v_superseding_run_id = 'migration-cleanup' and current_user = 'postgres')
      or exists (
        select 1
        from public.official_import_candidates as replacement
        join public.official_import_runs as replacement_run
          on replacement_run.id = replacement.run_id
        where replacement.run_id::text = v_superseding_run_id
          and replacement_run.status = 'running'
          and replacement.source_id = old.source_id
          and replacement.candidate_kind = old.candidate_kind
          and (
            (old.official_external_id is not null
              and replacement.official_external_id = old.official_external_id)
            or (old.official_external_id is null
              and replacement.official_external_id is null
              and replacement.canonical_url = old.canonical_url)
          )
      )
    ) then
    return old;
  end if;

  raise exception 'only replaceable candidates may be deleted'
    using errcode = '23514';
end;
$$;

create function public.prune_superseded_official_import_candidates() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_previous_context text := current_setting(
    'stage_tracker.official_import_superseding_run_id', true
  );
begin
  -- Direct service-role inserts into an unfinished run are not publication.
  if current_setting('stage_tracker.official_import_batch_run_id', true)
    is distinct from new.run_id::text then
    return new;
  end if;

  -- Different versions of one official identity in one batch are ambiguous.
  if exists (
    select 1
    from public.official_import_candidates as sibling
    where sibling.run_id = new.run_id
      and sibling.id <> new.id
      and sibling.candidate_kind = new.candidate_kind
      and (
        (new.official_external_id is not null
          and sibling.official_external_id = new.official_external_id)
        or (new.official_external_id is null
          and sibling.official_external_id is null
          and sibling.canonical_url = new.canonical_url)
      )
  ) then
    raise exception 'official import batch contains duplicate source identities'
      using errcode = '22023';
  end if;

  perform set_config(
    'stage_tracker.official_import_superseding_run_id',
    new.run_id::text,
    true
  );
  delete from public.official_import_candidates as prior
  using public.official_import_runs as prior_run
  where prior.run_id = prior_run.id
    and prior_run.status = 'completed'
    and prior.source_id = new.source_id
    and prior.candidate_kind = new.candidate_kind
    and (
      (new.official_external_id is not null
        and prior.official_external_id = new.official_external_id)
      or (new.official_external_id is null
        and prior.official_external_id is null
        and prior.canonical_url = new.canonical_url)
    )
    and prior.apply_status = 'not_started'
    and prior.review_status in (
      'pending', 'approved', 'blocked_for_identity_review'
    );
  perform set_config(
    'stage_tracker.official_import_superseding_run_id',
    coalesce(v_previous_context, ''),
    true
  );
  return new;
end;
$$;

create trigger official_import_candidates_prune_superseded
  after insert on public.official_import_candidates
  for each row
  execute function public.prune_superseded_official_import_candidates();

-- A one-time cleanup also removes stale pre-migration proposals already shown
-- in Production. Rank completed-run identities first, then delete only older
-- review proposals that have never entered apply. The lock prevents a scan or
-- review transition racing this bounded cleanup.
lock table public.official_import_candidates in access exclusive mode;
select set_config(
  'stage_tracker.official_import_superseding_run_id',
  'migration-cleanup',
  true
);
with ranked as (
  select candidate.id,
    row_number() over (
      partition by candidate.source_id, candidate.candidate_kind,
        (candidate.official_external_id is null),
        coalesce(candidate.official_external_id, candidate.canonical_url)
      order by run.finished_at desc, candidate.observed_at desc,
        candidate.created_at desc, candidate.id desc
    ) as position
  from public.official_import_candidates as candidate
  join public.official_import_runs as run on run.id = candidate.run_id
  where run.status = 'completed'
)
delete from public.official_import_candidates as candidate
using ranked
where candidate.id = ranked.id
  and ranked.position > 1
  and candidate.apply_status = 'not_started'
  and candidate.review_status in (
    'pending', 'approved', 'blocked_for_identity_review'
  );
select set_config(
  'stage_tracker.official_import_superseding_run_id',
  '',
  true
);
