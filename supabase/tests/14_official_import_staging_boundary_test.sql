-- Issue #628: official import staging/review boundary.
--
-- This suite is the finite bounded lifecycle/immutability matrix for the
-- staging boundary. It uses real Postgres roles and auth claims.
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;

select plan(70);

select pg_temp.create_test_user() as creator_id \gset
select pg_temp.create_test_user() as second_creator_id \gset
select pg_temp.create_test_user() as other_id \gset

insert into public.catalog_creators (user_id)
values (:'creator_id'), (:'second_creator_id');

insert into public.events (owner_id, title, starts_on, ends_on)
values (:'creator_id', 'P2 staging product fixture event', '2026-11-01', '2026-11-01')
returning id as event_id \gset

insert into public.event_occurrences (event_id, starts_at)
values (:'event_id', '2026-11-01T18:00:00+09:00')
returning id as occurrence_id \gset

insert into public.events (owner_id, title, starts_on, ends_on)
values (:'creator_id', 'P2 staging cleanup fixture event', '2026-11-02', '2026-11-02')
returning id as cleanup_event_id \gset

insert into public.event_occurrences (event_id, starts_at)
values (:'cleanup_event_id', '2026-11-02T18:00:00+09:00')
returning id as cleanup_occurrence_id \gset

insert into public.ticket_opportunities (event_id, target_scope, display_name, source_key)
values (:'cleanup_event_id', 'event_wide', 'P2 staging cleanup opportunity', 'p2-staging-cleanup')
returning id as opportunity_id \gset

set local role service_role;

select throws_ok(
  $$insert into public.official_import_runs
      (source_id, status, finished_at)
    values ('fixture-source', 'completed', now())$$,
  '23514', null, 'reject INSERT completed run'
);
select throws_ok(
  $$insert into public.official_import_runs
      (source_id, status, finished_at, failure_classification)
    values ('fixture-source', 'failed', now(), 'source_fetch')$$,
  '23514', null, 'reject INSERT failed run'
);

insert into public.official_import_runs (source_id)
values ('fixture-source')
returning id as run_id \gset
insert into public.official_import_runs (source_id)
values ('completed-source')
returning id as completed_run_id \gset
update public.official_import_runs
set status = 'completed', finished_at = now()
where id = :'completed_run_id';
insert into public.official_import_runs (source_id)
values ('failed-source')
returning id as failed_run_id \gset
update public.official_import_runs
set status = 'failed', finished_at = now(), failure_classification = 'source_parse'
where id = :'failed_run_id';
insert into public.official_import_runs (source_id)
values ('empty-running-source')
returning id as empty_running_run_id \gset

select throws_ok(format($$update public.official_import_runs set id = gen_random_uuid() where id = %L$$, :'run_id'),
  '23514', null, 'reject running run id mutation');
select throws_ok(format($$update public.official_import_runs set source_id = 'changed-source' where id = %L$$, :'run_id'),
  '23514', null, 'reject running run source_id mutation');
select throws_ok(format($$update public.official_import_runs set started_at = started_at + interval '1 minute' where id = %L$$, :'run_id'),
  '23514', null, 'reject running run started_at mutation');
select throws_ok(format($$update public.official_import_runs set created_at = created_at + interval '1 minute' where id = %L$$, :'run_id'),
  '23514', null, 'reject running run created_at mutation');
select is((select status from public.official_import_runs where id = :'completed_run_id'),
  'completed', 'running -> completed is allowed');
select is((select status from public.official_import_runs where id = :'failed_run_id'),
  'failed', 'running -> failed is allowed');
select throws_ok(format($$update public.official_import_runs set status = 'completed' where id = %L$$, :'completed_run_id'),
  '23514', null, 'reject completed run same-state UPDATE');
select throws_ok(format($$update public.official_import_runs set failure_classification = 'unexpected' where id = %L$$, :'failed_run_id'),
  '23514', null, 'reject failed run same-state rewrite');
delete from public.official_import_runs where id = :'empty_running_run_id';
select is((select count(*) from public.official_import_runs where id = :'empty_running_run_id'),
  0::bigint, 'allow DELETE empty running run');
select throws_ok(format($$delete from public.official_import_runs where id = %L$$, :'completed_run_id'),
  '23514', null, 'reject DELETE completed run');
select throws_ok(format($$delete from public.official_import_runs where id = %L$$, :'failed_run_id'),
  '23514', null, 'reject DELETE failed run');
select hasnt_column('public', 'official_import_runs', 'candidate_count',
  'candidate_count is removed as redundant derived state');

insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, official_external_id,
  content_hash, proposal_version, proposal, evidence_locator,
  resolved_event_id, resolved_ticket_opportunity_id, plan_summary, plan_fingerprint
)
values (
  :'run_id', 'fixture-source', 'event', 'https://official.example/events/1',
  'official-event-1', repeat('a', 64), 'event-v1',
  '{"title":"P2 applied proposal"}'::jsonb, '{"page":1}'::jsonb,
  :'cleanup_event_id', :'opportunity_id', '{"operation":"unchanged"}'::jsonb, repeat('b', 64)
)
returning id as candidate_id \gset

insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, official_external_id,
  content_hash, proposal_version, proposal, evidence_locator, plan_fingerprint
)
values (:'run_id', 'fixture-source', 'event', 'https://official.example/events/2',
  'official-event-2', repeat('c', 64), 'event-v1',
  '{"title":"P2 pending proposal"}'::jsonb, '{"page":2}'::jsonb, repeat('d', 64))
returning id as pending_update_candidate_id \gset

insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, official_external_id,
  content_hash, proposal_version, proposal, evidence_locator, plan_fingerprint
)
values (:'run_id', 'fixture-source', 'event', 'https://official.example/events/3',
  'official-event-3', repeat('e', 64), 'event-v1',
  '{"title":"P2 blocked proposal"}'::jsonb, '{"page":3}'::jsonb, repeat('f', 64))
returning id as blocked_candidate_id \gset

insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, official_external_id,
  content_hash, proposal_version, proposal, evidence_locator, plan_fingerprint
)
values (:'run_id', 'fixture-source', 'event', 'https://official.example/events/4',
  'official-event-4', repeat('1', 64), 'event-v1',
  '{"title":"P2 rejected proposal"}'::jsonb, '{"page":4}'::jsonb, repeat('2', 64))
returning id as rejected_candidate_id \gset

insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, official_external_id, content_hash,
  proposal_version, proposal, evidence_locator, plan_fingerprint
)
values (:'run_id', 'fixture-source', 'event', 'https://official.example/events/5',
  'official-event-5', repeat('3', 64), 'event-v1',
  '{"title":"P2 failed proposal"}'::jsonb, '{"page":5}'::jsonb, repeat('4', 64))
returning id as failed_candidate_id \gset

insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, official_external_id, content_hash,
  proposal_version, proposal, evidence_locator, resolved_event_id, plan_fingerprint
)
values (:'run_id', 'fixture-source', 'event', 'https://official.example/events/owner-guard',
  'official-event-owner-guard', repeat('a', 64), 'event-v1',
  '{"title":"Owner guard proposal"}'::jsonb, '{"page":8}'::jsonb,
  :'event_id', repeat('b', 64))
returning id as owner_guard_candidate_id \gset

insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, official_external_id, content_hash,
  proposal_version, proposal, evidence_locator, plan_fingerprint
)
values (:'run_id', 'fixture-source', 'event', 'https://official.example/events/6',
  'official-event-6', repeat('5', 64), 'event-v1',
  '{"title":"P2 delete proposal"}'::jsonb, '{"page":6}'::jsonb, repeat('6', 64))
returning id as deletable_candidate_id \gset

insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, official_external_id, content_hash,
  proposal_version, proposal, evidence_locator, plan_fingerprint
)
values (:'run_id', 'fixture-source', 'event', 'https://official.example/events/7',
  'official-event-7', repeat('7', 64), 'event-v1',
  '{"title":"P2 bypass proposal"}'::jsonb, '{"page":7}'::jsonb, repeat('8', 64))
returning id as bypass_candidate_id \gset

select throws_ok(format($$insert into public.official_import_candidates
  (run_id, source_id, candidate_kind, canonical_url, content_hash, proposal_version, proposal, plan_fingerprint)
  values (%L, 'completed-source', 'event', 'https://official.example/late-completed', %L, 'event-v1', '{"title":"late"}', %L)$$,
  :'completed_run_id', repeat('9', 64), repeat('a', 64)),
  '23514', null, 'reject candidate INSERT against completed run');
select throws_ok(format($$insert into public.official_import_candidates
  (run_id, source_id, candidate_kind, canonical_url, content_hash, proposal_version, proposal, plan_fingerprint)
  values (%L, 'failed-source', 'event', 'https://official.example/late-failed', %L, 'event-v1', '{"title":"late"}', %L)$$,
  :'failed_run_id', repeat('b', 64), repeat('c', 64)),
  '23514', null, 'reject candidate INSERT against failed run');
select throws_ok(format($$insert into public.official_import_candidates
  (run_id, source_id, candidate_kind, canonical_url, content_hash, proposal_version, proposal, plan_fingerprint)
  values (%L, 'wrong-source', 'event', 'https://official.example/mismatch', %L, 'event-v1', '{"title":"mismatch"}', %L)$$,
  :'run_id', repeat('d', 64), repeat('e', 64)),
  '23514', null, 'reject candidate source_id/run mismatch');

select throws_ok(format($$update public.official_import_candidates set id = gen_random_uuid() where id = %L$$, :'pending_update_candidate_id'),
  '23514', null, 'reject candidate id mutation');
select throws_ok(format($$update public.official_import_candidates set run_id = %L where id = %L$$, :'completed_run_id', :'pending_update_candidate_id'),
  '23514', null, 'reject candidate run_id mutation');
select throws_ok(format($$update public.official_import_candidates set source_id = 'changed-source' where id = %L$$, :'pending_update_candidate_id'),
  '23514', null, 'reject candidate source_id mutation');
select throws_ok(format($$update public.official_import_candidates set created_at = created_at + interval '1 minute' where id = %L$$, :'pending_update_candidate_id'),
  '23514', null, 'reject pending candidate created_at mutation');
update public.official_import_candidates
set proposal = '{"title":"P2 pending content updated"}'::jsonb
where id = :'pending_update_candidate_id';
select is((select proposal ->> 'title' from public.official_import_candidates where id = :'pending_update_candidate_id'),
  'P2 pending content updated', 'allow pending content update while parent run is running');

update public.official_import_candidates
set review_status = 'blocked_for_identity_review'
where id = :'blocked_candidate_id';
select is((select review_status from public.official_import_candidates where id = :'blocked_candidate_id'),
  'blocked_for_identity_review', 'allow pending -> blocked trusted transition');
select throws_ok(format($$update public.official_import_candidates set review_status = 'pending' where id = %L$$, :'blocked_candidate_id'),
  '23514', null, 'reject blocked -> pending transition');
select throws_ok(format($$update public.official_import_candidates set review_status = 'approved' where id = %L$$, :'blocked_candidate_id'),
  '23514', null, 'reject blocked -> approved transition');

select throws_ok(format($$update public.official_import_candidates
  set review_status = 'approved', reviewer = %L, reviewed_at = now() where id = %L$$,
  :'creator_id', :'bypass_candidate_id'),
  '42501', null, 'reject direct service-role approve bypass');
select throws_ok(format($$update public.official_import_candidates
  set review_status = 'rejected', reviewer = %L, reviewed_at = now() where id = %L$$,
  :'creator_id', :'bypass_candidate_id'),
  '42501', null, 'reject direct service-role reject bypass');

delete from public.official_import_candidates where id = :'deletable_candidate_id';
select is((select count(*) from public.official_import_candidates where id = :'deletable_candidate_id'),
  0::bigint, 'allow DELETE pending/not_started candidate in running run');
select throws_ok(format($$delete from public.official_import_candidates where id = %L$$, :'blocked_candidate_id'),
  '23514', null, 'reject DELETE blocked candidate');

call pg_temp.auth_as_user(:'creator_id');
select throws_ok(format($$select public.review_official_import_candidate(%L, 'approved')$$, :'candidate_id'),
  '22023', null, 'reject review while parent import run is incomplete');
call pg_temp.auth_as_admin();
update public.official_import_runs set status = 'completed', finished_at = now() where id = :'run_id';
call pg_temp.auth_as_user(:'second_creator_id');
select throws_ok(format($$select public.review_official_import_candidate(%L, 'approved')$$, :'owner_guard_candidate_id'),
  '42501', null, 'another designated creator cannot approve an existing Event owner import');
call pg_temp.auth_as_user(:'creator_id');
select is((select review_status from public.review_official_import_candidate(:'owner_guard_candidate_id', 'approved')),
  'approved', 'matched Event owner can approve the same still-pending candidate');
select is((select review_status from public.review_official_import_candidate(:'candidate_id', 'approved')),
  'approved', 'review RPC approves pending candidate');
select is((select reviewer from public.official_import_candidates where id = :'candidate_id'),
  :'creator_id'::uuid, 'reviewer is derived from auth.uid()');
select is((select review_status from public.review_official_import_candidate(:'rejected_candidate_id', 'rejected')),
  'rejected', 'review RPC rejects pending candidate');
select throws_ok(format($$select public.review_official_import_candidate(%L, 'approved')$$, :'rejected_candidate_id'),
  '22023', null, 'reject rejected -> approved reopen');
select throws_ok(format($$select public.review_official_import_candidate(%L, 'rejected')$$, :'candidate_id'),
  '22023', null, 'reject approved -> rejected reopen');
select throws_ok(format($$update public.official_import_candidates
  set proposal = '{"title":"post-review rewrite"}'::jsonb where id = %L$$, :'candidate_id'),
  '42501', null, 'ordinary creator cannot table-update reviewed candidate');

call pg_temp.auth_as_admin();
select throws_ok(format($$update public.official_import_candidates
  set apply_status = 'applied', applied_at = now() where id = %L$$, :'rejected_candidate_id'),
  '23514', null, 'reject not_started -> applied and rejected apply');
select is(public.claim_official_import_candidate_apply(:'candidate_id', 'p2-apply-owner', 300),
  'claimed', 'approved not_started -> queued is owned by the apply RPC');
select is(public.complete_official_import_candidate_apply(:'candidate_id', 'p2-apply-owner'),
  'applied', 'queued -> applied is owned by the apply RPC');
select throws_ok(format($$update public.official_import_candidates set apply_status = 'queued' where id = %L$$, :'candidate_id'),
  '23514', null, 'reject applied -> queued');
select throws_ok(format($$update public.official_import_candidates set apply_status = 'failed' where id = %L$$, :'candidate_id'),
  '23514', null, 'reject applied -> failed');
select throws_ok(format($$update public.official_import_candidates set applied_at = now() + interval '1 minute' where id = %L$$, :'candidate_id'),
  '23514', null, 'reject applied_at rewrite');

call pg_temp.auth_as_user(:'creator_id');
select is((select review_status from public.review_official_import_candidate(:'failed_candidate_id', 'approved')),
  'approved', 'failed lifecycle candidate is approved through RPC');
call pg_temp.auth_as_admin();
select is(public.claim_official_import_candidate_apply(:'failed_candidate_id', 'p2-failure-owner', 300),
  'claimed', 'approved candidate enters an owned queued state');
select is(public.fail_official_import_candidate_apply(
    :'failed_candidate_id', 'p2-failure-owner', 'validation'),
  'failed', 'the apply owner records queued -> failed');
select is((select failure_classification from public.official_import_candidates where id = :'failed_candidate_id'),
  'validation', 'failed state retains failure classification');
select throws_ok(format($$update public.official_import_candidates
  set failure_classification = 'unexpected' where id = %L$$, :'failed_candidate_id'),
  '23514', null, 'reject failed same-state failure rewrite');
select throws_ok(format($$update public.official_import_candidates
  set apply_status = 'queued' where id = %L$$, :'failed_candidate_id'),
  '23514', null, 'reject failed -> queued without clearing failure classification');
select is(public.claim_official_import_candidate_apply(:'failed_candidate_id', 'p2-retry-owner', 300),
  'claimed', 'allow failed -> queued retry with cleared classification');
select is((select failure_classification from public.official_import_candidates where id = :'failed_candidate_id'),
  null::text, 'retry clears failed classification');

select throws_ok(format($$delete from public.official_import_candidates where id = %L$$, :'candidate_id'),
  '23514', null, 'reject DELETE applied/reviewed candidate');

select throws_ok(format($$update public.official_import_candidates
  set proposal = '{"title":"late rewrite"}'::jsonb where id = %L$$, :'pending_update_candidate_id'),
  '23514', null, 'reject pending content rewrite after parent terminal');
select throws_ok(format($$delete from public.official_import_candidates where id = %L$$, :'pending_update_candidate_id'),
  '23514', null, 'reject DELETE candidate after parent terminal');

delete from public.ticket_opportunities where id = :'opportunity_id';
select is((select resolved_ticket_opportunity_id from public.official_import_candidates where id = :'candidate_id'),
  null::uuid, 'allow TicketOpportunity FK cleanup on true deletion');
call pg_temp.auth_as_user(:'creator_id');
select lives_ok(format($$select public.delete_event(%L)$$, :'cleanup_event_id'),
  'allow Event deletion with reviewed/applied staging reference');
select is((select resolved_event_id from public.official_import_candidates where id = :'candidate_id'),
  null::uuid, 'allow Event FK cleanup on true deletion');

select hasnt_column('public', 'official_import_candidates', 'raw_html', 'candidate table has no raw HTML');
select hasnt_column('public', 'official_import_candidates', 'raw_pdf', 'candidate table has no raw PDF');
select hasnt_column('public', 'official_import_candidates', 'raw_body', 'candidate table has no raw source body');
call pg_temp.auth_as_user(:'other_id');
select is((select count(*) from public.official_import_runs), 0::bigint, 'ordinary non-creator cannot read runs');
select is((select count(*) from public.official_import_candidates), 0::bigint, 'ordinary non-creator cannot read candidates');
select throws_ok($$insert into public.official_import_runs (source_id) values ('ordinary')$$,
  '42501', null, 'ordinary user cannot insert run');
select throws_ok($$insert into public.official_import_candidates default values$$,
  '42501', null, 'ordinary user cannot insert candidate');
select throws_ok(format($$select public.review_official_import_candidate(%L, 'approved')$$, :'bypass_candidate_id'),
  '42501', null, 'review RPC rejects non-creator');
call pg_temp.auth_as_user(:'creator_id');
select is((select title from public.events where id = :'event_id'),
  'P2 staging product fixture event', 'review/apply does not mutate Event');
select is((select starts_at from public.event_occurrences where id = :'occurrence_id'),
  '2026-11-01 09:00:00+00'::timestamptz, 'review/apply does not mutate Occurrence');

call pg_temp.auth_as_admin();
set local role postgres;
select is((select count(*) from information_schema.role_table_grants
  where grantee = 'authenticated' and table_schema = 'public'
    and table_name in ('official_import_runs', 'official_import_candidates')),
  2::bigint, 'authenticated has exactly two direct staging grants');
select is((select count(*) from information_schema.role_table_grants
  where grantee = 'authenticated' and table_schema = 'public'
    and table_name in ('official_import_runs', 'official_import_candidates')
    and privilege_type = 'SELECT'),
  2::bigint, 'authenticated has SELECT only on staging tables');

select * from finish();
rollback;
