-- Issue #633: one active Workflow attempt owns an approved candidate apply.

\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;

select plan(41);

select pg_temp.create_test_user() as creator_id \gset
insert into public.catalog_creators (user_id) values (:'creator_id');

set local role service_role;

insert into public.official_import_runs (source_id)
values ('apply-ownership-fixture')
returning id as run_id \gset

insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, content_hash,
  proposal_version, proposal, plan_fingerprint
)
values (
  :'run_id', 'apply-ownership-fixture', 'event',
  'https://official.example/events/apply-owned', repeat('a', 64),
  'event-v1', '{"title":"apply owned"}'::jsonb, repeat('b', 64)
)
returning id as candidate_id \gset

insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, content_hash,
  proposal_version, proposal, plan_fingerprint
)
values (
  :'run_id', 'apply-ownership-fixture', 'event',
  'https://official.example/events/not-approved', repeat('c', 64),
  'event-v1', '{"title":"not approved"}'::jsonb, repeat('d', 64)
)
returning id as pending_candidate_id \gset

update public.official_import_runs
set status = 'completed', finished_at = now()
where id = :'run_id';

call pg_temp.auth_as_user(:'creator_id');
select is(
  (select review_status from public.review_official_import_candidate(:'candidate_id', 'approved')),
  'approved',
  'fixture candidate is approved through the review boundary'
);
call pg_temp.auth_as_admin();

select has_column(
  'public', 'official_import_candidates', 'active_apply_attempt_token',
  'candidate stores a bounded active apply attempt token'
);
select has_column(
  'public', 'official_import_candidates', 'active_apply_lease_expires_at',
  'candidate stores the active apply lease deadline'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_official_import_candidate_apply(uuid,text,integer)',
    'EXECUTE'
  ),
  'ordinary authenticated clients cannot claim candidate applies'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.complete_official_import_candidate_apply(uuid,text)',
    'EXECUTE'
  ),
  'ordinary authenticated clients cannot complete candidate applies'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.fail_official_import_candidate_apply(uuid,text,text)',
    'EXECUTE'
  ),
  'ordinary authenticated clients cannot fail candidate applies'
);

set local role service_role;

select throws_ok(
  format(
    $$select public.claim_official_import_candidate_apply(%L, ' padded ', 300)$$,
    :'candidate_id'
  ),
  '22023', null, 'claim rejects a non-canonical attempt token'
);
select throws_ok(
  format(
    $$select public.claim_official_import_candidate_apply(%L, 'attempt-a', 1)$$,
    :'candidate_id'
  ),
  '22023', null, 'claim rejects an out-of-bounds lease'
);
select throws_ok(
  $$select public.claim_official_import_candidate_apply(
      '00000000-0000-0000-0000-000000000000', 'attempt-a', 300
    )$$,
  '22023', null, 'claim rejects a missing candidate'
);
select is(
  public.claim_official_import_candidate_apply(
    :'pending_candidate_id', 'pending-attempt', 300
  ),
  'not_approved',
  'an unapproved candidate cannot be claimed'
);
select throws_ok(
  format(
    $$update public.official_import_candidates
      set apply_status = 'queued'
      where id = %L$$,
    :'candidate_id'
  ),
  '23514', null, 'direct service-role UPDATE cannot enter apply state'
);
select is(
  public.claim_official_import_candidate_apply(:'candidate_id', 'attempt-a', 300),
  'claimed',
  'first attempt claims an approved candidate'
);
select is(
  (select apply_status from public.official_import_candidates where id = :'candidate_id'),
  'queued',
  'claim records the queued state'
);
select is(
  (select active_apply_attempt_token
   from public.official_import_candidates where id = :'candidate_id'),
  'attempt-a',
  'claim stores the active attempt token'
);
select ok(
  (select active_apply_lease_expires_at > clock_timestamp()
   from public.official_import_candidates where id = :'candidate_id'),
  'claim stores a future lease deadline'
);
select is(
  public.claim_official_import_candidate_apply(:'candidate_id', 'attempt-a', 300),
  'claimed',
  'the owner can renew its own lease'
);
select is(
  public.claim_official_import_candidate_apply(:'candidate_id', 'attempt-b', 300),
  'busy',
  'an overlapping attempt backs off while the lease is active'
);
select throws_ok(
  format(
    $$update public.official_import_candidates
      set active_apply_attempt_token = 'bypass',
          active_apply_lease_expires_at = now() + interval '5 minutes'
      where id = %L$$,
    :'candidate_id'
  ),
  '23514', null, 'direct service-role UPDATE cannot steal apply ownership'
);
select throws_ok(
  format(
    $$update public.official_import_candidates
      set apply_status = 'applied', applied_at = now(),
          active_apply_attempt_token = null,
          active_apply_lease_expires_at = null
      where id = %L$$,
    :'candidate_id'
  ),
  '23514', null, 'direct completion cannot bypass the owner RPC'
);
select is(
  public.complete_official_import_candidate_apply(:'candidate_id', 'attempt-b'),
  'not_owner',
  'a competing attempt cannot complete the candidate'
);
select is(
  public.fail_official_import_candidate_apply(
    :'candidate_id', 'attempt-b', 'unexpected'
  ),
  'not_owner',
  'a competing attempt cannot fail the candidate'
);
select throws_ok(
  format(
    $$select public.fail_official_import_candidate_apply(
      %L, 'attempt-a', 'unbounded-detail'
    )$$,
    :'candidate_id'
  ),
  '22023', null, 'failure rejects an unbounded classification'
);
select is(
  public.complete_official_import_candidate_apply(:'candidate_id', 'attempt-a'),
  'applied',
  'the owner completes the candidate'
);
select ok(
  (select applied_at is not null
   from public.official_import_candidates where id = :'candidate_id'),
  'completion records the apply timestamp'
);
select is(
  (select active_apply_attempt_token
   from public.official_import_candidates where id = :'candidate_id'),
  null::text,
  'completion clears apply ownership'
);
select is(
  public.claim_official_import_candidate_apply(:'candidate_id', 'late-attempt', 300),
  'applied',
  'a retry observes an already applied candidate without claiming'
);
select is(
  public.fail_official_import_candidate_apply(
    :'candidate_id', 'attempt-a', 'unexpected'
  ),
  'applied',
  'a late failure cannot overwrite an applied candidate'
);

insert into public.official_import_runs (source_id)
values ('apply-failure-fixture')
returning id as failure_run_id \gset
insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, content_hash,
  proposal_version, proposal, plan_fingerprint
)
values (
  :'failure_run_id', 'apply-failure-fixture', 'event',
  'https://official.example/events/apply-failure', repeat('e', 64),
  'event-v1', '{"title":"apply failure"}'::jsonb, repeat('f', 64)
)
returning id as failure_candidate_id \gset
update public.official_import_runs
set status = 'completed', finished_at = now()
where id = :'failure_run_id';
call pg_temp.auth_as_user(:'creator_id');
select is(
  (select review_status from public.review_official_import_candidate(
    :'failure_candidate_id', 'approved'
  )),
  'approved',
  'failure fixture is approved'
);
call pg_temp.auth_as_admin();
set local role service_role;
select is(
  public.claim_official_import_candidate_apply(
    :'failure_candidate_id', 'failure-owner', 300
  ),
  'claimed',
  'failure fixture is claimed'
);
select is(
  public.fail_official_import_candidate_apply(
    :'failure_candidate_id', 'failure-owner', 'source_changed'
  ),
  'failed',
  'the owner records a bounded failure'
);
select is(
  (select failure_classification
   from public.official_import_candidates where id = :'failure_candidate_id'),
  'source_changed',
  'failure preserves its bounded classification'
);
select is(
  (select active_apply_attempt_token
   from public.official_import_candidates where id = :'failure_candidate_id'),
  null::text,
  'failure clears apply ownership'
);
select throws_ok(
  format(
    $$update public.official_import_candidates
      set failure_classification = 'unexpected'
      where id = %L$$,
    :'failure_candidate_id'
  ),
  '23514', null, 'direct failure evidence rewrite is rejected'
);
select is(
  public.claim_official_import_candidate_apply(
    :'failure_candidate_id', 'retry-owner', 300
  ),
  'claimed',
  'a failed candidate can be claimed for retry'
);
select is(
  (select failure_classification
   from public.official_import_candidates where id = :'failure_candidate_id'),
  null::text,
  'retry clears the previous failure classification'
);

insert into public.official_import_runs (source_id)
values ('apply-expiry-fixture')
returning id as expiry_run_id \gset
insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, content_hash,
  proposal_version, proposal, plan_fingerprint
)
values (
  :'expiry_run_id', 'apply-expiry-fixture', 'event',
  'https://official.example/events/apply-expiry', repeat('1', 64),
  'event-v1', '{"title":"apply expiry"}'::jsonb, repeat('2', 64)
)
returning id as expiry_candidate_id \gset
update public.official_import_runs
set status = 'completed', finished_at = now()
where id = :'expiry_run_id';
call pg_temp.auth_as_user(:'creator_id');
select is(
  (select review_status from public.review_official_import_candidate(
    :'expiry_candidate_id', 'approved'
  )),
  'approved',
  'expiry fixture is approved'
);
call pg_temp.auth_as_admin();
set local role service_role;
select is(
  public.claim_official_import_candidate_apply(
    :'expiry_candidate_id', 'expired-owner', 300
  ),
  'claimed',
  'expiry fixture is claimed'
);
select set_config(
  'stage_tracker.official_import_apply_candidate_id',
  :'expiry_candidate_id',
  true
) as apply_candidate_scope \gset
select set_config(
  'stage_tracker.official_import_apply_attempt_token',
  'expired-owner',
  true
) as apply_token_scope \gset
update public.official_import_candidates
set active_apply_lease_expires_at = clock_timestamp() - interval '1 second'
where id = :'expiry_candidate_id';
select is(
  public.claim_official_import_candidate_apply(
    :'expiry_candidate_id', 'takeover-owner', 300
  ),
  'claimed',
  'a new attempt takes over an expired lease'
);
select is(
  (select active_apply_attempt_token
   from public.official_import_candidates where id = :'expiry_candidate_id'),
  'takeover-owner',
  'lease takeover replaces the stale owner token'
);
select is(
  public.complete_official_import_candidate_apply(
    :'expiry_candidate_id', 'expired-owner'
  ),
  'not_owner',
  'the expired owner cannot complete after takeover'
);
select is(
  public.complete_official_import_candidate_apply(
    :'expiry_candidate_id', 'takeover-owner'
  ),
  'applied',
  'the takeover owner completes the candidate'
);

select * from finish();
rollback;
