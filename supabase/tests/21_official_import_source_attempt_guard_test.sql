-- Issue #634: distinct runs of the same source share a live attempt boundary.

begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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
select throws_ok(
  format(
    $$select public.commit_owned_official_import_candidate_batch(
      %L, 'source-attempt-fixture', 'first-attempt', '[]'::jsonb
    )$$,
    :'first_run'
  ),
  '55000', null,
  'a displaced earlier run cannot publish after another run takes ownership'
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

select * from finish();
rollback;
