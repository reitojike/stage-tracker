-- Issue #633: an approved staged candidate can be claimed, applied through
-- the existing P1 catalog RPCs, and completed without crossing into personal
-- ticket-planning state.

\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

select pg_temp.create_test_user() as creator_id \gset
select pg_temp.create_test_user() as planning_user_id \gset
insert into public.catalog_creators (user_id) values (:'creator_id');

set local role service_role;

insert into public.official_import_runs (source_id)
values ('approved-apply-event-fixture')
returning id as event_run_id \gset

insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, content_hash,
  proposal_version, proposal, plan_fingerprint
)
values (
  :'event_run_id', 'approved-apply-event-fixture', 'event',
  'https://official.example/events/approved-apply', repeat('1', 64),
  'event.v1', '{"sourceKey":"approved-apply:event"}'::jsonb, repeat('2', 64)
)
returning id as event_candidate_id \gset

update public.official_import_runs
set status = 'completed', finished_at = now()
where id = :'event_run_id';

call pg_temp.auth_as_user(:'creator_id');
select is(
  (select review_status from public.review_official_import_candidate(
    :'event_candidate_id', 'approved'
  )),
  'approved',
  'the Event candidate is approved through the operator review boundary'
);
call pg_temp.auth_as_admin();
set local role service_role;

select is(
  public.claim_official_import_candidate_apply(
    :'event_candidate_id', 'event-attempt', 300
  ),
  'claimed',
  'the approved Event candidate is claimed by one apply attempt'
);

select (public.apply_import_event_plan(
  p_action := 'create',
  p_owner_id := :'creator_id',
  p_event_id := null,
  p_source_key := 'approved-apply:event',
  p_title := '承認反映テスト公演',
  p_starts_on := '2026-10-10'::date,
  p_ends_on := '2026-10-10'::date,
  p_occurrences := '[{"startsAt":"2026-10-10T04:00:00Z","endsAt":"2026-10-10T06:00:00Z","doorsAt":"2026-10-10T03:30:00Z"}]'::jsonb,
  p_occurrence_fixes := '[]'::jsonb,
  p_venue := 'テスト劇場',
  p_source_url := 'https://official.example/events/approved-apply',
  p_memo := 'official import integration fixture',
  p_set_genre := true,
  p_genre_key := 'kabuki',
  p_set_groups := false,
  p_groups := '[]'::jsonb
)).id as event_id \gset

select is(
  (select source_key from public.events where id = :'event_id'),
  'approved-apply:event',
  'the P1 Event RPC writes the approved source identity'
);
select is(
  (select count(*) from public.event_occurrences where event_id = :'event_id'),
  1::bigint,
  'the P1 Event RPC atomically writes its occurrence'
);
select is(
  (select genres.key from public.events join public.genres on genres.id = events.genre_id
   where events.id = :'event_id'),
  'kabuki',
  'the atomic Event plan writes classification in the same call'
);
select throws_ok(
  format($sql$
    select public.apply_import_event_plan(
      p_action := 'update',
      p_owner_id := %L,
      p_event_id := %L,
      p_source_key := 'approved-apply:event',
      p_title := '部分適用されてはいけないタイトル',
      p_starts_on := '2026-10-10'::date,
      p_ends_on := '2026-10-10'::date,
      p_occurrences := '[]'::jsonb,
      p_occurrence_fixes := '[]'::jsonb,
      p_venue := 'テスト劇場',
      p_source_url := 'https://official.example/events/approved-apply',
      p_memo := 'official import integration fixture',
      p_set_genre := true,
      p_genre_key := 'missing-genre',
      p_set_groups := false,
      p_groups := '[]'::jsonb
    )
  $sql$, :'creator_id', :'event_id'),
  '22023',
  'unknown genre key: missing-genre',
  'a classification failure rejects the complete Event plan'
);
select is(
  (select title from public.events where id = :'event_id'),
  '承認反映テスト公演',
  'the failed classification rolls back the preceding Event detail update'
);
select throws_ok(
  format($sql$
    select public.apply_import_event_plan(
      p_action := null,
      p_owner_id := %L,
      p_event_id := %L,
      p_source_key := 'approved-apply:event',
      p_title := 'ignored malformed apply',
      p_starts_on := '2026-10-10'::date,
      p_ends_on := '2026-10-10'::date,
      p_occurrences := '[]'::jsonb,
      p_occurrence_fixes := '[]'::jsonb,
      p_venue := 'テスト劇場',
      p_source_url := 'https://official.example/events/approved-apply',
      p_memo := 'official import integration fixture',
      p_set_genre := false,
      p_genre_key := null,
      p_set_groups := false,
      p_groups := '[]'::jsonb
    )
  $sql$, :'creator_id', :'event_id'),
  '22023',
  null,
  'the atomic Event plan rejects a null action instead of treating it as unchanged'
);
select is(
  public.complete_official_import_candidate_apply(
    :'event_candidate_id', 'event-attempt'
  ),
  'applied',
  'the Event apply owner completes the candidate'
);
select is(
  (select apply_status from public.official_import_candidates
   where id = :'event_candidate_id'),
  'applied',
  'the Event candidate records a completed apply state'
);

select id as occurrence_id
from public.event_occurrences
where event_id = :'event_id'
limit 1 \gset

insert into public.official_import_runs (source_id)
values ('approved-apply-ticket-fixture')
returning id as ticket_run_id \gset

insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, content_hash,
  proposal_version, proposal, plan_fingerprint
)
values (
  :'ticket_run_id', 'approved-apply-ticket-fixture', 'ticket_opportunity',
  'https://official.example/tickets/approved-apply', repeat('3', 64),
  'ticket_opportunity.v1',
  '{"eventSourceKey":"approved-apply:event","sourceKey":"approved-apply:ticket"}'::jsonb,
  repeat('4', 64)
)
returning id as ticket_candidate_id \gset

update public.official_import_runs
set status = 'completed', finished_at = now()
where id = :'ticket_run_id';

call pg_temp.auth_as_user(:'creator_id');
select is(
  (select review_status from public.review_official_import_candidate(
    :'ticket_candidate_id', 'approved'
  )),
  'approved',
  'the TicketOpportunity candidate is approved through operator review'
);
call pg_temp.auth_as_admin();
set local role service_role;

select is(
  public.claim_official_import_candidate_apply(
    :'ticket_candidate_id', 'ticket-attempt', 300
  ),
  'claimed',
  'the approved TicketOpportunity candidate is claimed'
);

select (public.import_ticket_opportunity(
  :'event_id',
  'approved-apply:ticket',
  '一般発売',
  'selected_occurrences',
  array[:'occurrence_id'::uuid],
  'https://official.example/tickets/approved-apply',
  'official import integration fixture',
  '[{"milestone_type":"sale_start","temporal_precision":"datetime","at":"2026-09-20T01:00:00Z"}]'::jsonb
)).id as opportunity_id \gset

select is(
  (select event_id from public.ticket_opportunities where id = :'opportunity_id'),
  :'event_id'::uuid,
  'the P1 TicketOpportunity RPC targets the resolved Event'
);
select is(
  (select count(*) from public.ticket_opportunity_target_occurrences
   where opportunity_id = :'opportunity_id'),
  1::bigint,
  'the P1 TicketOpportunity RPC writes the selected occurrence relation'
);
select is(
  (select temporal_precision from public.ticket_opportunity_milestones
   where opportunity_id = :'opportunity_id' and milestone_type = 'sale_start'),
  'datetime',
  'the P1 TicketOpportunity RPC preserves milestone precision'
);

insert into public.user_ticket_opportunity_states (
  user_id, opportunity_id, status
)
values (:'planning_user_id', :'opportunity_id', 'planned');

-- Simulate a Workflow retry after the catalog write but before candidate
-- completion. The P1 RPC converges by source_key and must leave personal
-- planning state untouched.
select (public.import_ticket_opportunity(
  :'event_id',
  'approved-apply:ticket',
  '一般発売',
  'selected_occurrences',
  array[:'occurrence_id'::uuid],
  'https://official.example/tickets/approved-apply',
  'official import integration fixture',
  '[{"milestone_type":"sale_start","temporal_precision":"datetime","at":"2026-09-20T01:00:00Z"}]'::jsonb
)).id as retried_opportunity_id \gset

select is(
  :'retried_opportunity_id'::uuid,
  :'opportunity_id'::uuid,
  'a retry converges on the same TicketOpportunity identity'
);
select is(
  (select count(*) from public.ticket_opportunity_milestones
   where opportunity_id = :'opportunity_id'),
  1::bigint,
  'a retry replaces shared milestones without duplicating them'
);
select is(
  (select count(*) from public.user_ticket_opportunity_states
   where user_id = :'planning_user_id'
     and opportunity_id = :'opportunity_id'),
  1::bigint,
  'catalog apply does not remove personal TicketOpportunity state'
);
select is(
  (select status from public.user_ticket_opportunity_states
   where user_id = :'planning_user_id'
     and opportunity_id = :'opportunity_id'),
  'planned',
  'catalog apply does not change personal TicketOpportunity status'
);
select is(
  public.complete_official_import_candidate_apply(
    :'ticket_candidate_id', 'ticket-attempt'
  ),
  'applied',
  'the TicketOpportunity apply owner completes the candidate'
);
select is(
  (select apply_status from public.official_import_candidates
   where id = :'ticket_candidate_id'),
  'applied',
  'the TicketOpportunity candidate records a completed apply state'
);

select * from finish();
rollback;
