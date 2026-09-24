-- An apply request reserves its approved candidate before Workflow startup.

\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

select pg_temp.create_test_user() as creator_id \gset
select pg_temp.create_test_user() as outsider_id \gset
insert into public.catalog_creators (user_id) values (:'creator_id');

set local role service_role;
insert into public.official_import_runs (source_id)
values ('apply-reservation-fixture')
returning id as run_id \gset

insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, content_hash,
  proposal_version, proposal, plan_fingerprint
)
values (
  :'run_id', 'apply-reservation-fixture', 'event',
  'https://official.example/events/reserved', repeat('a', 64),
  'event-v1', '{"title":"reserved"}'::jsonb, repeat('b', 64)
)
returning id as candidate_id \gset

insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, content_hash,
  proposal_version, proposal, plan_fingerprint
)
values (
  :'run_id', 'apply-reservation-fixture', 'event',
  'https://official.example/events/pending', repeat('c', 64),
  'event-v1', '{"title":"pending"}'::jsonb, repeat('d', 64)
)
returning id as pending_id \gset

select has_column(
  'public', 'official_import_candidates', 'apply_requested_at',
  'candidate records the first apply request'
);
select ok(
  not has_function_privilege(
    'anon', 'public.reserve_official_import_candidate_apply(uuid)', 'EXECUTE'
  ),
  'anonymous callers cannot reserve applies'
);

select throws_ok(
  format(
    $$update public.official_import_candidates
      set apply_requested_at = now() where id = %L$$,
    :'candidate_id'
  ),
  '23514', null, 'service-role writes cannot forge a reservation'
);

update public.official_import_runs
set status = 'completed', finished_at = now()
where id = :'run_id';

call pg_temp.auth_as_user(:'outsider_id');
select throws_ok(
  format(
    $$select public.reserve_official_import_candidate_apply(%L)$$,
    :'candidate_id'
  ),
  '42501', null, 'non-creators cannot reserve an apply'
);

call pg_temp.auth_as_user(:'creator_id');
select is(
  public.reserve_official_import_candidate_apply(:'pending_id'),
  'not_available',
  'pending candidates cannot be reserved'
);
select is(
  public.reserve_official_import_candidate_apply(
    '00000000-0000-0000-0000-000000000000'
  ),
  'not_available',
  'missing candidates return a stable unavailable result'
);
select is(
  (select review_status from public.review_official_import_candidate(:'candidate_id', 'approved')),
  'approved',
  'fixture candidate is approved by its creator'
);
select is(
  public.reserve_official_import_candidate_apply(:'candidate_id'),
  'ready',
  'creator reserves an approved candidate before starting Workflow'
);
select ok(
  (select apply_requested_at is not null
   from public.official_import_candidates where id = :'candidate_id'),
  'reservation is durable'
);
select is(
  (select apply_status from public.official_import_candidates where id = :'candidate_id'),
  'not_started',
  'reservation does not claim a Workflow lease'
);

call pg_temp.auth_as_admin();
select apply_requested_at as first_requested_at
from public.official_import_candidates where id = :'candidate_id' \gset

call pg_temp.auth_as_user(:'creator_id');
select is(
  public.reserve_official_import_candidate_apply(:'candidate_id'),
  'ready',
  'retrying an uncertain Workflow start is allowed'
);
select is(
  (select apply_requested_at from public.official_import_candidates
   where id = :'candidate_id'),
  :'first_requested_at'::timestamptz,
  'a retry preserves the original reservation timestamp'
);

call pg_temp.auth_as_admin();
set local role service_role;
select throws_ok(
  format(
    $$update public.official_import_candidates
      set apply_requested_at = null where id = %L$$,
    :'candidate_id'
  ),
  '23514', null, 'reservation cannot be cleared by a direct write'
);
select is(
  public.claim_official_import_candidate_apply(:'candidate_id', 'reservation-test', 300),
  'claimed',
  'existing Workflow claim accepts a reserved candidate'
);
select is(
  (select apply_requested_at from public.official_import_candidates
   where id = :'candidate_id'),
  :'first_requested_at'::timestamptz,
  'Workflow claim keeps the reservation'
);

call pg_temp.auth_as_user(:'creator_id');
select is(
  public.reserve_official_import_candidate_apply(:'candidate_id'),
  'busy',
  'another click cannot launch a second Workflow while queued'
);

select * from finish();
rollback;
