-- Issue #634: an identity-blocked TicketOpportunity can be declined without
-- making it approvable, and identical later scans reuse that judgment.
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select pg_temp.create_test_user() as creator_id \gset
select pg_temp.create_test_user() as other_id \gset
insert into public.catalog_creators (user_id) values (:'creator_id');

create function pg_temp.ticket_payload(p_plan text)
returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'candidate_kind', 'ticket_opportunity',
    'canonical_url', 'https://official.example/ticket/play-1',
    'official_external_id', 'play-1:general',
    'observed_at', clock_timestamp(),
    'content_hash', repeat('a', 64),
    'proposal_version', 'ticket-v1',
    'proposal', jsonb_build_object('sourceKey', 'shochiku:play-1:general'),
    'evidence_locator', '{}'::jsonb,
    'deterministic_match_status', 'unresolved',
    'semantic_match_status', 'low_confidence',
    'plan_summary', jsonb_build_object('action', 'create'),
    'plan_fingerprint', p_plan,
    'review_status', 'blocked_for_identity_review'
  ));
$$;

set local role service_role;
insert into public.official_import_runs (source_id)
values ('blocked-ticket-source') returning id as first_run_id \gset
select is(
  public.commit_official_import_candidate_batch(
    :'first_run_id', 'blocked-ticket-source', pg_temp.ticket_payload('plan-a')
  ), 1, 'identity-blocked ticket is staged'
);
select id as blocked_ticket_id from public.official_import_candidates
where run_id = :'first_run_id' \gset

call pg_temp.auth_as_user(:'other_id');
select throws_ok(
  format('select public.review_official_import_candidate(%L, %L)', :'blocked_ticket_id', 'rejected'),
  '42501', null, 'only a designated creator may reject the blocked ticket'
);
call pg_temp.auth_as_user(:'creator_id');
select throws_ok(
  format('select public.review_official_import_candidate(%L, %L)', :'blocked_ticket_id', 'approved'),
  '22023', null, 'identity-blocked ticket still cannot be approved'
);
select is(
  (select review_status from public.official_import_candidates where id = :'blocked_ticket_id'),
  'blocked_for_identity_review', 'failed approval leaves the ticket blocked'
);
select is(
  (select review_status from public.review_official_import_candidate(:'blocked_ticket_id', 'rejected')),
  'rejected', 'creator can reject an identity-blocked ticket'
);
select is(
  (select reviewer from public.official_import_candidates where id = :'blocked_ticket_id'),
  :'creator_id'::uuid, 'rejection records its reviewer'
);
select ok(
  (select reviewed_at is not null from public.official_import_candidates where id = :'blocked_ticket_id'),
  'rejection records its review timestamp'
);
select throws_ok(
  format('select public.review_official_import_candidate(%L, %L)', :'blocked_ticket_id', 'rejected'),
  '22023', null, 'rejected ticket cannot be reviewed again'
);

call pg_temp.auth_as_admin();
set local role service_role;
insert into public.official_import_runs (source_id)
values ('blocked-ticket-source') returning id as same_run_id \gset
select is(
  public.commit_official_import_candidate_batch(
    :'same_run_id', 'blocked-ticket-source', pg_temp.ticket_payload('plan-a')
  ), 0, 'identical ticket is not staged after rejection'
);
select is(
  (select count(*) from public.official_import_candidates where id = :'blocked_ticket_id'),
  1::bigint, 'the rejected decision remains as history'
);
insert into public.official_import_runs (source_id)
values ('blocked-ticket-source') returning id as changed_run_id \gset
select is(
  public.commit_official_import_candidate_batch(
    :'changed_run_id', 'blocked-ticket-source', pg_temp.ticket_payload('plan-b')
  ), 1, 'a changed plan is offered for review again'
);
select is(
  (select review_status from public.official_import_candidates where run_id = :'changed_run_id'),
  'blocked_for_identity_review', 'changed ticket still requires identity review'
);

-- An Event identity block is outside this narrow dismissal path.
insert into public.official_import_runs (source_id)
values ('blocked-event-source') returning id as event_run_id \gset
insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, official_external_id,
  content_hash, proposal_version, proposal, plan_fingerprint
) values (
  :'event_run_id', 'blocked-event-source', 'event',
  'https://official.example/event/play-2', 'play-2', repeat('b', 64),
  'event-v1', '{}'::jsonb, 'event-plan-a'
) returning id as blocked_event_id \gset
update public.official_import_candidates
set review_status = 'blocked_for_identity_review'
where id = :'blocked_event_id';
update public.official_import_runs
set status = 'completed', finished_at = now()
where id = :'event_run_id';
call pg_temp.auth_as_user(:'creator_id');
select throws_ok(
  format('select public.review_official_import_candidate(%L, %L)', :'blocked_event_id', 'rejected'),
  '22023', null, 'identity-blocked Event still cannot be rejected'
);

select * from finish();
rollback;
