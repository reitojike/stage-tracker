-- A catalog creator may approve an identity-blocked ticket only while recording
-- the exact existing Event they reviewed. Other review paths remain closed.
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select pg_temp.create_test_user() as creator_id \gset
select pg_temp.create_test_user() as other_id \gset
insert into public.catalog_creators (user_id) values (:'creator_id');

set local role service_role;
insert into public.events (owner_id, title, venue, source_key, starts_on, ends_on)
values (:'creator_id', '九月博多座特別公演', '博多座', 'kabuki-bito:hakataza:play:999', '2026-09-03', '2026-09-14')
returning id as event_id \gset
insert into public.official_import_runs (source_id)
values ('ticket.shochiku.schedule') returning id as run_id \gset
select is(
  public.commit_official_import_candidate_batch(
    :'run_id', 'ticket.shochiku.schedule',
    jsonb_build_array(jsonb_build_object(
      'candidate_kind', 'ticket_opportunity',
      'canonical_url', 'https://www1.ticket-web-shochiku.com/t/info/sale_schedule_west.html',
      'official_external_id', '2026:hakataza:play:general',
      'observed_at', clock_timestamp(),
      'content_hash', repeat('a', 64),
      'proposal_version', 'ticket_opportunity.v1',
      'proposal', jsonb_build_object(
        'eventSourceKey', 'unresolved:shochiku:2026:hakataza',
        'sourceKey', 'shochiku:2026:hakataza:play:general',
        'displayName', '一般販売',
        'targetScope', 'event_wide'
      ),
      'evidence_locator', '{}'::jsonb,
      'deterministic_match_status', 'unresolved',
      'semantic_match_status', 'low_confidence',
      'plan_summary', jsonb_build_object('action', 'create'),
      'plan_fingerprint', 'unresolved-plan',
      'review_status', 'blocked_for_identity_review'
    ))
  ), 1, 'blocked ticket is staged'
);
select id as candidate_id from public.official_import_candidates
where run_id = :'run_id' \gset

call pg_temp.auth_as_user(:'other_id');
select throws_ok(
  format('select public.bind_official_import_ticket_candidate(%L, %L)', :'candidate_id', :'event_id'),
  '42501', null, 'ordinary user cannot bind a ticket'
);
call pg_temp.auth_as_user(:'creator_id');
select throws_ok(
  format('select public.bind_official_import_ticket_candidate(%L, %L)', :'candidate_id', '11111111-1111-4111-8111-111111111111'),
  '22023', null, 'nonexistent Event cannot be selected'
);
select throws_ok(
  format('update public.official_import_candidates set review_status = %L, reviewer = %L, reviewed_at = now() where id = %L', 'approved', :'creator_id', :'candidate_id'),
  '42501', null, 'direct candidate approval is not allowed'
);
select is(
  (select review_status from public.bind_official_import_ticket_candidate(:'candidate_id', :'event_id')),
  'approved', 'creator can bind and approve in one transaction'
);
call pg_temp.auth_as_admin();
select ok(
  has_table_privilege('service_role', 'public.official_import_ticket_event_bindings', 'SELECT'),
  'trusted ingestion can read the binding'
);
select ok(
  not has_table_privilege('authenticated', 'public.official_import_ticket_event_bindings', 'SELECT'),
  'ordinary authenticated clients cannot read binding rows directly'
);
select is(
  (select event_id from public.official_import_ticket_event_bindings
   where source_id = 'ticket.shochiku.schedule'
     and ticket_source_key = 'shochiku:2026:hakataza:play:general'),
  :'event_id'::uuid, 'binding keeps the reviewed Event identity'
);
select is(
  (select candidate_id from public.official_import_ticket_event_bindings
   where source_id = 'ticket.shochiku.schedule'
     and ticket_source_key = 'shochiku:2026:hakataza:play:general'),
  :'candidate_id'::uuid, 'binding keeps the review candidate identity'
);
select is(
  (select reviewer from public.official_import_ticket_event_bindings
   where source_id = 'ticket.shochiku.schedule'
     and ticket_source_key = 'shochiku:2026:hakataza:play:general'),
  :'creator_id'::uuid, 'binding records the actor'
);
call pg_temp.auth_as_user(:'creator_id');
select throws_ok(
  format('select public.bind_official_import_ticket_candidate(%L, %L)', :'candidate_id', :'event_id'),
  '22023', null, 'reviewed candidate cannot be bound again'
);
select throws_ok(
  format('select public.review_official_import_candidate(%L, %L)', :'candidate_id', 'rejected'),
  '22023', null, 'manual approval is terminal for review'
);

select * from finish();
rollback;
