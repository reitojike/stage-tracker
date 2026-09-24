-- Issue #634: only the latest unapplied proposal for an official identity
-- remains actionable. A completed run and applied/in-flight records survive.
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select pg_temp.create_test_user() as creator_id \gset
insert into public.catalog_creators (user_id) values (:'creator_id');

create function pg_temp.supersession_payload(
  p_external_id text,
  p_url text,
  p_hash text,
  p_plan text
) returns jsonb
language sql
as $$
  select jsonb_build_array(jsonb_build_object(
    'candidate_kind', 'event',
    'canonical_url', p_url,
    'official_external_id', p_external_id,
    'observed_at', clock_timestamp(),
    'content_hash', p_hash,
    'proposal_version', 'event-v1',
    'proposal', jsonb_build_object('title', 'fixture'),
    'evidence_locator', '{}'::jsonb,
    'deterministic_match_status', 'unresolved',
    'semantic_match_status', 'not_used',
    'plan_summary', '{}'::jsonb,
    'plan_fingerprint', p_plan,
    'review_status', 'pending'
  ));
$$;

set local role service_role;

insert into public.official_import_runs (source_id)
values ('supersession-a') returning id as first_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'first_run', 'supersession-a',
    pg_temp.supersession_payload(
      'play-1', 'https://official.example/play/1', repeat('a', 64), 'plan-a'
    )
  ),
  1,
  'first scan stages a candidate'
);
select id as first_candidate from public.official_import_candidates
where run_id = :'first_run' \gset
select throws_ok(
  format('delete from public.official_import_candidates where id = %L', :'first_candidate'),
  '23514', null,
  'a completed candidate cannot be deleted directly'
);

call pg_temp.auth_as_user(:'creator_id');
select is(
  (select review_status from public.review_official_import_candidate(
    :'first_candidate', 'approved'
  )),
  'approved',
  'operator can approve the first proposal'
);
call pg_temp.auth_as_admin();
set local role service_role;

insert into public.official_import_runs (source_id)
values ('supersession-a') returning id as second_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'second_run', 'supersession-a',
    pg_temp.supersession_payload(
      'play-1', 'https://official.example/play/renamed', repeat('b', 64), 'plan-b'
    )
  ),
  1,
  'changed source stages the replacement under the stable external ID'
);
select is(
  (select count(*) from public.official_import_candidates where id = :'first_candidate'),
  0::bigint,
  'the earlier approved but unapplied proposal is removed'
);
select is(
  (select count(*) from public.official_import_candidates
   where source_id = 'supersession-a' and official_external_id = 'play-1'),
  1::bigint,
  'one proposal remains for the official identity'
);
select is(
  (select status from public.official_import_runs where id = :'first_run'),
  'completed',
  'supersession retains the previous run record'
);

insert into public.official_import_runs (source_id)
values ('supersession-b') returning id as other_source_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'other_source_run', 'supersession-b',
    pg_temp.supersession_payload(
      'play-1', 'https://official.example/play/1', repeat('c', 64), 'plan-c'
    )
  ),
  1,
  'another source can stage the same external ID independently'
);

insert into public.official_import_runs (source_id)
values ('supersession-a') returning id as third_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'third_run', 'supersession-a',
    pg_temp.supersession_payload(
      'play-1', 'https://official.example/play/renamed', repeat('b', 64), 'plan-b'
    )
  ),
  0,
  'an unchanged repeat scan does not replace the surviving proposal'
);
select is(
  (select count(*) from public.official_import_candidates
   where source_id = 'supersession-a' and official_external_id = 'play-1'),
  1::bigint,
  'unchanged scan does not grow the queue'
);

select id as second_candidate from public.official_import_candidates
where run_id = :'second_run' \gset
call pg_temp.auth_as_user(:'creator_id');
select is(
  (select review_status from public.review_official_import_candidate(
    :'second_candidate', 'approved'
  )),
  'approved',
  'the surviving proposal can be approved'
);
call pg_temp.auth_as_admin();
set local role service_role;
select is(
  public.claim_official_import_candidate_apply(
    :'second_candidate', 'supersession-apply', 300
  ),
  'claimed',
  'an apply attempt can claim the approved proposal'
);

insert into public.official_import_runs (source_id)
values ('supersession-a') returning id as queued_successor_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'queued_successor_run', 'supersession-a',
    pg_temp.supersession_payload(
      'play-1', 'https://official.example/play/renamed', repeat('f', 64), 'plan-f'
    )
  ),
  1,
  'a changed scan can stage while an older apply is in flight'
);
select is(
  (select apply_status from public.official_import_candidates
   where id = :'second_candidate'),
  'queued',
  'supersession preserves the in-flight apply record'
);
select throws_ok(
  format('delete from public.official_import_candidates where id = %L', :'second_candidate'),
  '23514', null,
  'an in-flight candidate cannot be deleted directly'
);

insert into public.official_import_runs (source_id)
values ('supersession-a') returning id as invalid_run \gset
select throws_ok(
  format(
    'select public.commit_official_import_candidate_batch(%L, %L, %L::jsonb)',
    :'invalid_run', 'supersession-a',
    (pg_temp.supersession_payload(
      'play-1', 'https://official.example/play/renamed', repeat('f', 64), 'plan-f'
    ) || pg_temp.supersession_payload(
      'play-1', 'https://official.example/play/1', repeat('e', 64), 'plan-e'
    ))::text
  ),
  '22023', null,
  'two versions of one identity fail before the unchanged version is suppressed'
);
select is(
  (select count(*) from public.official_import_candidates
   where source_id = 'supersession-a' and official_external_id = 'play-1'),
  2::bigint,
  'failed batch retains both the queued record and current review proposal'
);
select is(
  (select status from public.official_import_runs where id = :'invalid_run'),
  'running',
  'failed batch leaves its run retryable'
);

select * from finish();
rollback;
