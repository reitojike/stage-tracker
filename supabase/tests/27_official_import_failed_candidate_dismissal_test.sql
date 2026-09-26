-- A failed import candidate can leave the active queue without losing its
-- approval and failure history or becoming applyable again.
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select pg_temp.create_test_user() as creator_id \gset
select pg_temp.create_test_user() as other_id \gset
insert into public.catalog_creators (user_id) values (:'creator_id');

set local role service_role;
insert into public.official_import_runs (source_id)
values ('dismissal-fixture') returning id as run_id \gset
insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, content_hash,
  proposal_version, proposal, plan_fingerprint
) values (
  :'run_id', 'dismissal-fixture', 'event',
  'https://official.example/events/failed', repeat('a', 64),
  'event-v1', '{"title":"failed"}'::jsonb, repeat('b', 64)
) returning id as failed_candidate_id \gset
insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, content_hash,
  proposal_version, proposal, plan_fingerprint
) values (
  :'run_id', 'dismissal-fixture', 'event',
  'https://official.example/events/pending', repeat('c', 64),
  'event-v1', '{"title":"pending"}'::jsonb, repeat('d', 64)
) returning id as pending_candidate_id \gset
update public.official_import_runs
set status = 'completed', finished_at = now()
where id = :'run_id';

call pg_temp.auth_as_user(:'creator_id');
select is(
  (select review_status from public.review_official_import_candidate(
    :'failed_candidate_id', 'approved'
  )), 'approved', 'fixture is approved'
);
select throws_ok(
  format('select public.dismiss_failed_official_import_candidate(%L)', :'failed_candidate_id'),
  '22023', null, 'approved but unapplied candidate cannot be dismissed'
);
select throws_ok(
  format('select public.dismiss_failed_official_import_candidate(%L)', :'pending_candidate_id'),
  '22023', null, 'pending candidate cannot be dismissed'
);

call pg_temp.auth_as_admin();
set local role service_role;
select is(
  public.claim_official_import_candidate_apply(:'failed_candidate_id', 'dismiss-attempt', 300),
  'claimed', 'failed fixture is claimed'
);
select is(
  public.fail_official_import_candidate_apply(
    :'failed_candidate_id', 'dismiss-attempt', 'source_changed'
  ), 'failed', 'failed fixture records its failure'
);
select throws_ok(
  format(
    'update public.official_import_candidates set dismissed_at = now(), dismissed_by = %L where id = %L',
    :'creator_id', :'failed_candidate_id'
  ), '23514', null, 'direct service-role update cannot dismiss a candidate'
);

call pg_temp.auth_as_user(:'other_id');
select throws_ok(
  format('select public.dismiss_failed_official_import_candidate(%L)', :'failed_candidate_id'),
  '42501', null, 'non-creator cannot dismiss a failed candidate'
);
call pg_temp.auth_as_user(:'creator_id');
select is(
  public.dismiss_failed_official_import_candidate(:'failed_candidate_id'),
  true, 'creator can dismiss a failed candidate'
);
select ok(
  (select dismissed_at is not null and dismissed_by = :'creator_id'::uuid
   from public.official_import_candidates where id = :'failed_candidate_id'),
  'dismissal retains its actor and timestamp'
);
select is(
  (select review_status || ':' || apply_status || ':' || failure_classification
   from public.official_import_candidates where id = :'failed_candidate_id'),
  'approved:failed:source_changed', 'original review and failure remain intact'
);
select throws_ok(
  format('select public.dismiss_failed_official_import_candidate(%L)', :'failed_candidate_id'),
  '22023', null, 'a dismissed candidate cannot be dismissed again'
);

call pg_temp.auth_as_admin();
set local role service_role;
select throws_ok(
  format(
    $$select public.claim_official_import_candidate_apply(%L, 'retry', 300)$$,
    :'failed_candidate_id'
  ), '23514', null, 'a dismissed candidate cannot be retried'
);
select ok(
  (select dismissed_at is null from public.official_import_candidates
   where id = :'pending_candidate_id'),
  'other candidates remain available'
);

select * from finish();
rollback;
