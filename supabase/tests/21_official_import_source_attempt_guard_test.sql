-- Issue #634: distinct runs of the same source share a live attempt boundary.

begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

set local role service_role;

select gen_random_uuid() as first_run \gset
select gen_random_uuid() as second_run \gset
select gen_random_uuid() as other_source_run \gset

select is(
  public.claim_official_import_run_attempt(
    :'first_run', 'source-attempt-fixture', 'first-attempt', 300
  ),
  'claimed',
  'first run owns the source attempt lease'
);
select is(
  public.claim_official_import_run_attempt(
    :'second_run', 'source-attempt-fixture', 'second-attempt', 300
  ),
  'busy',
  'another run of the same source backs off'
);
select is(
  (select count(*) from public.official_import_runs
   where source_id = 'source-attempt-fixture'
     and active_attempt_token is not null),
  1::bigint,
  'only one same-source run has an active lease'
);
select is(
  public.claim_official_import_run_attempt(
    :'other_source_run', 'other-source-attempt-fixture', 'other-attempt', 300
  ),
  'claimed',
  'a different source can proceed independently'
);
select is(
  public.release_official_import_run_attempt(
    :'first_run', 'source-attempt-fixture', 'first-attempt'
  ),
  'released',
  'owner releases its source lease after a transient failure'
);
select is(
  public.claim_official_import_run_attempt(
    :'second_run', 'source-attempt-fixture', 'second-attempt', 300
  ),
  'claimed',
  'waiting run proceeds after the first owner releases'
);
select is(
  public.claim_official_import_run_attempt(
    :'first_run', 'source-attempt-fixture', 'first-retry', 300
  ),
  'busy',
  'the released run cannot overlap the new source owner'
);
select is(
  public.commit_owned_official_import_candidate_batch(
    :'second_run', 'source-attempt-fixture', 'second-attempt', '[]'::jsonb
  ),
  0,
  'the source owner can complete a zero-candidate run'
);
select is(
  public.claim_official_import_run_attempt(
    :'first_run', 'source-attempt-fixture', 'first-retry', 300
  ),
  'claimed',
  'a prior run can resume after the other run terminates'
);

-- A delayed scan may not publish after its lease expires and a newer scan
-- has claimed and committed the same source. No sleep or second connection is
-- needed: advance only this test fixture's lease into the past.
select gen_random_uuid() as stale_run \gset
select gen_random_uuid() as newer_run \gset
select is(
  public.claim_official_import_run_attempt(
    :'stale_run', 'expired-source-fixture', 'stale-attempt', 300
  ), 'claimed', 'older scan first owns the source'
);
select set_config('stage_tracker.official_import_attempt_run_id', :'stale_run', true);
select set_config('stage_tracker.official_import_attempt_token', 'stale-attempt', true);
update public.official_import_runs
set active_attempt_lease_expires_at = clock_timestamp() - interval '1 second'
where id = :'stale_run';
select set_config('stage_tracker.official_import_attempt_token', '', true);
select set_config('stage_tracker.official_import_attempt_run_id', '', true);
select throws_ok(
  format(
    'select public.commit_official_import_candidate_batch(%L, %L, %L::jsonb)',
    :'stale_run', 'expired-source-fixture', '[]'
  ), '55000', null, 'a claimed run cannot bypass ownership with the base batch RPC'
);
select is(
  public.claim_official_import_run_attempt(
    :'newer_run', 'expired-source-fixture', 'newer-attempt', 300
  ), 'claimed', 'newer scan can take the expired source lease'
);
select is(
  public.commit_owned_official_import_candidate_batch(
    :'newer_run', 'expired-source-fixture', 'newer-attempt',
    jsonb_build_array(jsonb_build_object(
      'candidate_kind', 'event',
      'canonical_url', 'https://official.example/expired-source',
      'official_external_id', 'play-1',
      'observed_at', clock_timestamp(),
      'content_hash', repeat('7', 64),
      'proposal_version', 'event-v1',
      'proposal', jsonb_build_object('title', 'newer'),
      'evidence_locator', '{}'::jsonb,
      'deterministic_match_status', 'unresolved',
      'semantic_match_status', 'not_used',
      'plan_summary', '{}'::jsonb,
      'plan_fingerprint', 'newer-plan',
      'review_status', 'pending'
    ))
  ), 1, 'newer scan publishes its candidate'
);
select throws_ok(
  format(
    'select public.commit_owned_official_import_candidate_batch(%L, %L, %L, %L::jsonb)',
    :'stale_run', 'expired-source-fixture', 'stale-attempt', '[]'
  ), '55000', null, 'expired older scan cannot publish after newer scan'
);
select is(
  (select count(*) from public.official_import_candidates where run_id = :'newer_run'),
  1::bigint, 'the newer candidate remains intact'
);

select * from finish();
rollback;
