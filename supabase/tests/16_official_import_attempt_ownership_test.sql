-- Issue #629: one active Workflow attempt owns a stable import run at a time.

begin;
create extension if not exists pgtap with schema extensions;

select plan(38);

select has_column(
  'public', 'official_import_runs', 'active_attempt_token',
  'run stores a bounded active attempt token'
);
select has_column(
  'public', 'official_import_runs', 'active_attempt_lease_expires_at',
  'run stores the active attempt lease deadline'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_official_import_run_attempt(uuid,text,text,integer)',
    'EXECUTE'
  ),
  'ordinary authenticated clients cannot claim ingestion runs'
);

set local role service_role;

select gen_random_uuid() as run_id \gset

select throws_ok(
  format(
    $$select public.claim_official_import_run_attempt(
      %L, 'ownership-fixture', ' padded-attempt ', 300
    )$$,
    :'run_id'
  ),
  '22023', null, 'claim rejects a non-canonical attempt token'
);
select is(
  public.claim_official_import_run_attempt(:'run_id', 'ownership-fixture', 'attempt-a', 300),
  'claimed',
  'first attempt claims a new stable run'
);
select is(
  (select source_id from public.official_import_runs where id = :'run_id'),
  'ownership-fixture',
  'claim creates the run with its fixed source identity'
);
select is(
  (select active_attempt_token from public.official_import_runs where id = :'run_id'),
  'attempt-a',
  'claim stores the active attempt token'
);
select ok(
  (select active_attempt_lease_expires_at > clock_timestamp()
   from public.official_import_runs where id = :'run_id'),
  'claim stores a future lease deadline'
);
select is(
  public.claim_official_import_run_attempt(:'run_id', 'ownership-fixture', 'attempt-a', 300),
  'claimed',
  'the owner can renew its own lease'
);
select is(
  public.claim_official_import_run_attempt(:'run_id', 'ownership-fixture', 'attempt-b', 300),
  'busy',
  'an overlapping attempt backs off while the lease is active'
);
select throws_ok(
  format(
    $$update public.official_import_runs
      set active_attempt_token = 'bypass',
          active_attempt_lease_expires_at = now() + interval '5 minutes'
      where id = %L$$,
    :'run_id'
  ),
  '23514', null, 'direct service-role UPDATE cannot steal ownership'
);
select throws_ok(
  format(
    $$update public.official_import_runs
      set status = 'failed', finished_at = now(), failure_classification = 'unexpected'
      where id = %L$$,
    :'run_id'
  ),
  '23514', null, 'direct failure cannot terminate a claimed run'
);
select throws_ok(
  format(
    $$select public.claim_official_import_run_attempt(
      %L, 'wrong-source', 'attempt-a', 300
    )$$,
    :'run_id'
  ),
  '22023', null, 'claim rejects a source mismatch'
);
select is(
  public.release_official_import_run_attempt(
    :'run_id', 'ownership-fixture', 'attempt-b'
  ),
  'not_owner',
  'a competing attempt cannot release the owner'
);
select is(
  public.release_official_import_run_attempt(
    :'run_id', 'ownership-fixture', 'attempt-a'
  ),
  'released',
  'the owner can release a transiently failed attempt'
);
select is(
  (select active_attempt_token from public.official_import_runs where id = :'run_id'),
  null::text,
  'release clears the attempt token'
);
select is(
  public.claim_official_import_run_attempt(:'run_id', 'ownership-fixture', 'attempt-b', 300),
  'claimed',
  'a retry can claim the released run'
);
select throws_ok(
  format(
    $$select public.commit_official_import_candidate_batch(
      %L, 'ownership-fixture', '[]'::jsonb
    )$$,
    :'run_id'
  ),
  '55000', null, 'the unowned legacy batch RPC cannot bypass an active claim'
);
select throws_ok(
  format(
    $$select public.commit_owned_official_import_candidate_batch(
      %L, 'ownership-fixture', 'attempt-a', '[]'::jsonb
    )$$,
    :'run_id'
  ),
  '55000', null, 'a stale attempt cannot publish after ownership changes'
);
select throws_ok(
  format(
    $$select public.commit_owned_official_import_candidate_batch(
      %L,
      'ownership-fixture',
      'attempt-b',
      '[{
        "candidate_kind":"event",
        "canonical_url":"not-an-official-url",
        "observed_at":"2026-09-22T00:00:00Z",
        "content_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "proposal_version":"event-v1",
        "proposal":{"title":"invalid"},
        "evidence_locator":{},
        "deterministic_match_status":"unresolved",
        "semantic_match_status":"not_used",
        "plan_summary":{},
        "plan_fingerprint":"invalid-plan",
        "review_status":"pending"
      }]'::jsonb
    )$$,
    :'run_id'
  ),
  '23514', null, 'invalid owned publication rolls back atomically'
);
select is(
  (select status from public.official_import_runs where id = :'run_id'),
  'running',
  'failed publication leaves the run retryable'
);
select is(
  (select active_attempt_token from public.official_import_runs where id = :'run_id'),
  'attempt-b',
  'failed publication preserves the owner for a bounded retry'
);
select is(
  public.commit_owned_official_import_candidate_batch(
    :'run_id',
    'ownership-fixture',
    'attempt-b',
    '[{
      "candidate_kind":"event",
      "canonical_url":"https://official.example/events/owned",
      "observed_at":"2026-09-22T00:00:00Z",
      "content_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "proposal_version":"event-v1",
      "proposal":{"title":"owned"},
      "evidence_locator":{},
      "deterministic_match_status":"unresolved",
      "semantic_match_status":"not_used",
      "plan_summary":{},
      "plan_fingerprint":"owned-plan",
      "review_status":"pending"
    }]'::jsonb
  ),
  1,
  'the current owner publishes the candidate batch'
);
select is(
  (select status from public.official_import_runs where id = :'run_id'),
  'completed',
  'owned publication completes the run'
);
select is(
  (select active_attempt_token from public.official_import_runs where id = :'run_id'),
  null::text,
  'terminal completion clears ownership'
);
select is(
  public.claim_official_import_run_attempt(:'run_id', 'ownership-fixture', 'attempt-c', 300),
  'completed',
  'a later retry observes completed without claiming'
);
select is(
  public.commit_owned_official_import_candidate_batch(
    :'run_id', 'ownership-fixture', 'attempt-c', '[]'::jsonb
  ),
  1,
  'a completed retry reuses the committed candidate count'
);
select is(
  public.fail_official_import_run_attempt(
    :'run_id', 'ownership-fixture', 'attempt-a', 'unexpected'
  ),
  'completed',
  'a late failure cannot overwrite a completed run'
);

select gen_random_uuid() as failed_run_id \gset
select is(
  public.claim_official_import_run_attempt(
    :'failed_run_id', 'failure-fixture', 'failure-owner', 300
  ),
  'claimed',
  'failure fixture is claimed'
);
select is(
  public.fail_official_import_run_attempt(
    :'failed_run_id', 'failure-fixture', 'other-attempt', 'validation'
  ),
  'not_owner',
  'a competing failure cannot terminate the run'
);
select is(
  public.fail_official_import_run_attempt(
    :'failed_run_id', 'failure-fixture', 'failure-owner', 'validation'
  ),
  'failed',
  'the active owner can record a terminal failure'
);
select is(
  (select failure_classification
   from public.official_import_runs where id = :'failed_run_id'),
  'validation',
  'terminal failure preserves its bounded classification'
);
select is(
  public.claim_official_import_run_attempt(
    :'failed_run_id', 'failure-fixture', 'later-attempt', 300
  ),
  'failed',
  'a later retry observes terminal failure without claiming'
);

select gen_random_uuid() as expired_run_id \gset
select is(
  public.claim_official_import_run_attempt(
    :'expired_run_id', 'expiry-fixture', 'expired-owner', 300
  ),
  'claimed',
  'expiry fixture is claimed'
);
select set_config(
  'stage_tracker.official_import_attempt_run_id',
  :'expired_run_id',
  true
) as attempt_run_scope \gset
select set_config(
  'stage_tracker.official_import_attempt_token',
  'expired-owner',
  true
) as attempt_token_scope \gset
update public.official_import_runs
set active_attempt_lease_expires_at = clock_timestamp() - interval '1 second'
where id = :'expired_run_id';
select is(
  public.claim_official_import_run_attempt(
    :'expired_run_id', 'expiry-fixture', 'takeover-owner', 300
  ),
  'claimed',
  'a new attempt takes over an expired lease'
);
select is(
  (select active_attempt_token
   from public.official_import_runs where id = :'expired_run_id'),
  'takeover-owner',
  'lease takeover replaces the stale owner token'
);
select is(
  public.release_official_import_run_attempt(
    :'expired_run_id', 'expiry-fixture', 'expired-owner'
  ),
  'not_owner',
  'the expired owner cannot release its successor'
);
select is(
  public.release_official_import_run_attempt(
    :'expired_run_id', 'expiry-fixture', 'takeover-owner'
  ),
  'released',
  'the takeover owner can release the run'
);

select * from finish();
rollback;
