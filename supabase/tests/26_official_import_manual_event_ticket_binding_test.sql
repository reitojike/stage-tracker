-- A reviewed TicketOpportunity may target a manually entered Event whose
-- catalog source_key is intentionally absent.
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select pg_temp.create_test_user() as creator_id \gset
insert into public.catalog_creators (user_id) values (:'creator_id');

set local role service_role;
insert into public.events (owner_id, title, venue, starts_on, ends_on)
values (:'creator_id', '俳優祭', '歌舞伎座', '2026-10-26', '2026-10-26')
returning id as event_id \gset
insert into public.official_import_runs (source_id)
values ('ticket.shochiku.schedule') returning id as run_id \gset
select is(
  public.commit_official_import_candidate_batch(
    :'run_id', 'ticket.shochiku.schedule',
    jsonb_build_array(jsonb_build_object(
      'candidate_kind', 'ticket_opportunity',
      'canonical_url', 'https://www1.ticket-web-shochiku.com/t/info/sale_schedule_east.html',
      'official_external_id', '2026:haikusai:general',
      'observed_at', clock_timestamp(),
      'content_hash', repeat('b', 64),
      'proposal_version', 'ticket_opportunity.v1',
      'proposal', jsonb_build_object(
        'eventSourceKey', 'unresolved:shochiku:2026:haikusai',
        'sourceKey', 'shochiku:2026:haikusai:general',
        'displayName', '一般販売',
        'targetScope', 'event_wide'
      ),
      'evidence_locator', '{}'::jsonb,
      'deterministic_match_status', 'ambiguous',
      'semantic_match_status', 'low_confidence',
      'plan_summary', jsonb_build_object('action', 'create'),
      'plan_fingerprint', 'unresolved-plan',
      'review_status', 'blocked_for_identity_review'
    ))
  ), 1, 'blocked ticket is staged'
);
select id as candidate_id from public.official_import_candidates
where run_id = :'run_id' \gset

call pg_temp.auth_as_user(:'creator_id');
select is(
  (select review_status from public.bind_official_import_ticket_candidate(:'candidate_id', :'event_id')),
  'approved', 'creator can review a manual Event binding'
);
call pg_temp.auth_as_admin();
select is(
  (select event_id from public.official_import_ticket_event_bindings
   where ticket_source_key = 'shochiku:2026:haikusai:general'),
  :'event_id'::uuid, 'binding keeps the manual Event id'
);
select ok(
  (select event_source_key is null from public.official_import_ticket_event_bindings
   where ticket_source_key = 'shochiku:2026:haikusai:general'),
  'binding does not fabricate an Event source key'
);
select ok(
  (select source_key is null from public.events where id = :'event_id'),
  'manual Event remains without an import source identity'
);

select * from finish();
rollback;
