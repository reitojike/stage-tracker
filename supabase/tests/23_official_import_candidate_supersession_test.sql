-- Issue #634: candidate cleanup follows current catalog state and the latest
-- apply epoch, while judged and in-flight history remains intact.
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

select pg_temp.create_test_user() as creator_id \gset
insert into public.catalog_creators (user_id) values (:'creator_id');

create function pg_temp.event_plan(p_action text, p_changed boolean)
returns jsonb language sql as $$
  select jsonb_build_object(
    'version', 'event_plan.v1', 'action', p_action,
    'detailsChanged', p_changed, 'rangeChanged', false,
    'newOccurrenceCount', 0, 'endsAtFixCount', 0,
    'doorsAtFixCount', 0, 'keptOccurrenceCount', 0,
    'genreChanged', false, 'groupsChanged', false
  );
$$;

create function pg_temp.event_payload(
  p_external_id text, p_hash text, p_plan text, p_action text,
  p_changed boolean, p_event_id uuid
) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'candidate_kind', 'event',
    'canonical_url', 'https://official.example/play/' || p_external_id,
    'official_external_id', p_external_id,
    'observed_at', clock_timestamp(),
    'content_hash', p_hash,
    'proposal_version', 'event-v1',
    'proposal', jsonb_build_object('sourceKey', 'official:event:1'),
    'evidence_locator', '{}'::jsonb,
    'deterministic_match_status', 'matched',
    'semantic_match_status', 'not_used',
    'resolved_event_id', p_event_id,
    'plan_summary', pg_temp.event_plan(p_action, p_changed),
    'plan_fingerprint', p_plan,
    'review_status', 'pending'
  ));
$$;

set local role service_role;
insert into public.events (owner_id, title, venue, source_key, starts_on, ends_on)
values (:'creator_id', 'A', 'fixture venue', 'official:event:1', '2027-01-01', '2027-01-02')
returning id as event_id \gset

-- A was reviewed and applied. The catalog fixture is already in A state.
insert into public.official_import_runs (source_id)
values ('supersession-source') returning id as run_a \gset
select is(
  public.commit_official_import_candidate_batch(
    :'run_a', 'supersession-source',
    pg_temp.event_payload('play-1', repeat('a', 64), 'plan-a-old', 'update', true, :'event_id')
  ), 1, 'A stages a candidate'
);
select id as candidate_a from public.official_import_candidates
where run_id = :'run_a' \gset
call pg_temp.auth_as_user(:'creator_id');
select is(
  (select review_status from public.review_official_import_candidate(:'candidate_a', 'approved')),
  'approved', 'A can be approved'
);
call pg_temp.auth_as_admin();
set local role service_role;
select is(public.claim_official_import_candidate_apply(:'candidate_a', 'apply-a', 300),
  'claimed', 'A can be claimed for apply');
select is(public.complete_official_import_candidate_apply(:'candidate_a', 'apply-a'),
  'applied', 'A apply is recorded');

-- B is judged and rejected, leaving the catalog at A.
insert into public.official_import_runs (source_id)
values ('supersession-source') returning id as run_b_rejected \gset
select is(
  public.commit_official_import_candidate_batch(
    :'run_b_rejected', 'supersession-source',
    pg_temp.event_payload('play-1', repeat('b', 64), 'plan-b-rejected', 'update', true, :'event_id')
  ), 1, 'B stages after A was applied'
);
select id as candidate_b_rejected from public.official_import_candidates
where run_id = :'run_b_rejected' \gset
call pg_temp.auth_as_user(:'creator_id');
select is(
  (select review_status from public.review_official_import_candidate(:'candidate_b_rejected', 'rejected')),
  'rejected', 'B rejection is recorded'
);
call pg_temp.auth_as_admin();
set local role service_role;

insert into public.official_import_runs (source_id)
values ('supersession-source') returning id as run_a_return \gset
select is(
  public.commit_official_import_candidate_batch(
    :'run_a_return', 'supersession-source',
    pg_temp.event_payload('play-1', repeat('a', 64), 'plan-a-current', 'unchanged', false, :'event_id')
  ), 0, 'A -> applied, B -> rejected, A: no new candidate is stored'
);
select is(
  (select count(*) from public.official_import_candidates
   where source_id = 'supersession-source'),
  2::bigint, 'applied A and rejected B are retained as judged history'
);

insert into public.official_import_runs (source_id)
values ('supersession-source') returning id as run_b_pending \gset
select is(
  public.commit_official_import_candidate_batch(
    :'run_b_pending', 'supersession-source',
    pg_temp.event_payload('play-1', repeat('b', 64), 'plan-b-pending', 'update', true, :'event_id')
  ), 1, 'another B can remain unreviewed'
);
select id as candidate_b_pending from public.official_import_candidates
where run_id = :'run_b_pending' \gset
insert into public.official_import_runs (source_id)
values ('supersession-source') returning id as run_a_over_b \gset
select is(
  public.commit_official_import_candidate_batch(
    :'run_a_over_b', 'supersession-source',
    pg_temp.event_payload('play-1', repeat('a', 64), 'plan-a-current', 'unchanged', false, :'event_id')
  ), 0, 'A returning over pending B creates no A row'
);
select is(
  (select count(*) from public.official_import_candidates where id = :'candidate_b_pending'),
  0::bigint, 'the obsolete unreviewed B is removed'
);

-- B is subsequently applied. A must now be offered as a change from B.
insert into public.official_import_runs (source_id)
values ('supersession-source') returning id as run_b_applied \gset
select is(
  public.commit_official_import_candidate_batch(
    :'run_b_applied', 'supersession-source',
    pg_temp.event_payload('play-1', repeat('b', 64), 'plan-b-applied', 'update', true, :'event_id')
  ), 1, 'a changed plan can stage B after an earlier B rejection'
);
select id as candidate_b_applied from public.official_import_candidates
where run_id = :'run_b_applied' \gset
call pg_temp.auth_as_user(:'creator_id');
select is(
  (select review_status from public.review_official_import_candidate(:'candidate_b_applied', 'approved')),
  'approved', 'B can be approved after its new plan'
);
call pg_temp.auth_as_admin();
set local role service_role;
select is(public.claim_official_import_candidate_apply(:'candidate_b_applied', 'apply-b', 300),
  'claimed', 'B can be claimed for apply');
select is(public.complete_official_import_candidate_apply(:'candidate_b_applied', 'apply-b'),
  'applied', 'B apply is recorded');
update public.events set title = 'B' where id = :'event_id';

insert into public.official_import_runs (source_id)
values ('supersession-source') returning id as run_a_after_b \gset
select is(
  public.commit_official_import_candidate_batch(
    :'run_a_after_b', 'supersession-source',
    pg_temp.event_payload('play-1', repeat('a', 64), 'plan-a-after-b', 'update', true, :'event_id')
  ), 1, 'A -> applied, B -> applied, A: a new A change is staged'
);
select id as candidate_a_after_b from public.official_import_candidates
where run_id = :'run_a_after_b' \gset
select is(
  (select title from public.events where id = :'event_id'),
  'B', 'staging A does not itself change the catalog'
);

-- Rejection in an apply epoch is not asked again, even if another unapplied
-- source version intervenes. Use a separate source with no applied candidate:
-- pgTAP runs in one transaction, while review uses transaction-time now().
call pg_temp.auth_as_user(:'creator_id');
select is(
  (select review_status from public.review_official_import_candidate(:'candidate_a_after_b', 'rejected')),
  'rejected', 'A rejection after B apply is recorded'
);
call pg_temp.auth_as_admin();
set local role service_role;
insert into public.official_import_runs (source_id)
values ('judgment-source') returning id as judged_a_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'judged_a_run', 'judgment-source',
    pg_temp.event_payload('play-2', repeat('a', 64), 'judged-a-plan', 'update', true, :'event_id')
  ), 1, 'another source stages A without an earlier apply'
);
select id as judged_a_candidate from public.official_import_candidates
where run_id = :'judged_a_run' \gset
call pg_temp.auth_as_user(:'creator_id');
select is(
  (select review_status from public.review_official_import_candidate(:'judged_a_candidate', 'rejected')),
  'rejected', 'the second source records a rejected A'
);
call pg_temp.auth_as_admin();
set local role service_role;
insert into public.official_import_runs (source_id)
values ('judgment-source') returning id as run_c \gset
select is(
  public.commit_official_import_candidate_batch(
    :'run_c', 'judgment-source',
    pg_temp.event_payload('play-2', repeat('c', 64), 'plan-c', 'update', true, :'event_id')
  ), 1, 'C stages after rejected A'
);
select id as candidate_c from public.official_import_candidates
where run_id = :'run_c' \gset
insert into public.official_import_runs (source_id)
values ('judgment-source') returning id as run_a_again \gset
select is(
  public.commit_official_import_candidate_batch(
    :'run_a_again', 'judgment-source',
    pg_temp.event_payload('play-2', repeat('a', 64), 'judged-a-plan', 'update', true, :'event_id')
  ), 0, 'rejected A in the current apply epoch is not re-presented'
);
select is(
  (select count(*) from public.official_import_candidates where id = :'candidate_c'),
  0::bigint, 'unreviewed C is removed even though A was suppressed'
);
select is(
  (select count(*) from public.official_import_candidates where id = :'judged_a_candidate'),
  1::bigint, 'the rejected A judgment remains'
);

-- Approved but unapplied proposals are also replaceable. An unchanged repeat
-- of the newest candidate does not churn IDs or review decisions.
insert into public.official_import_runs (source_id)
values ('supersession-source') returning id as run_d \gset
select is(
  public.commit_official_import_candidate_batch(
    :'run_d', 'supersession-source',
    pg_temp.event_payload('play-1', repeat('d', 64), 'plan-d', 'update', true, :'event_id')
  ), 1, 'D stages'
);
select id as candidate_d from public.official_import_candidates
where run_id = :'run_d' \gset
call pg_temp.auth_as_user(:'creator_id');
select is(
  (select review_status from public.review_official_import_candidate(:'candidate_d', 'approved')),
  'approved', 'D can be approved without applying it'
);
call pg_temp.auth_as_admin();
set local role service_role;
insert into public.official_import_runs (source_id)
values ('supersession-source') returning id as run_e \gset
select is(
  public.commit_official_import_candidate_batch(
    :'run_e', 'supersession-source',
    pg_temp.event_payload('play-1', repeat('e', 64), 'plan-e', 'update', true, :'event_id')
  ), 1, 'E replaces approved but unapplied D'
);
select is(
  (select count(*) from public.official_import_candidates where id = :'candidate_d'),
  0::bigint, 'approved but unapplied D is physically removed'
);
insert into public.official_import_runs (source_id)
values ('supersession-source') returning id as run_e_repeat \gset
select is(
  public.commit_official_import_candidate_batch(
    :'run_e_repeat', 'supersession-source',
    pg_temp.event_payload('play-1', repeat('e', 64), 'plan-e', 'update', true, :'event_id')
  ), 0, 'unchanged repeat E creates no candidate'
);
select is(
  (select count(*) from public.official_import_candidates where run_id = :'run_e'),
  1::bigint, 'the existing E candidate remains'
);

select throws_ok(
  format('delete from public.official_import_candidates where id = %L', :'candidate_a'),
  '23514', null, 'applied history cannot be deleted directly'
);
select throws_ok(
  format('delete from public.official_import_candidates where id = %L', :'candidate_b_rejected'),
  '23514', null, 'rejected history cannot be deleted directly'
);

select id as candidate_e from public.official_import_candidates
where run_id = :'run_e' \gset
call pg_temp.auth_as_user(:'creator_id');
select is(
  (select review_status from public.review_official_import_candidate(:'candidate_e', 'approved')),
  'approved', 'E can be approved'
);
call pg_temp.auth_as_admin();
set local role service_role;
select is(public.claim_official_import_candidate_apply(:'candidate_e', 'apply-e', 300),
  'claimed', 'E enters an in-flight apply state');
insert into public.official_import_runs (source_id)
values ('supersession-source') returning id as run_f \gset
select is(
  public.commit_official_import_candidate_batch(
    :'run_f', 'supersession-source',
    pg_temp.event_payload('play-1', repeat('f', 64), 'plan-f', 'update', true, :'event_id')
  ), 1, 'F stages while E is applying'
);
select is(
  (select apply_status from public.official_import_candidates where id = :'candidate_e'),
  'queued', 'in-flight E is preserved'
);

insert into public.official_import_runs (source_id)
values ('another-source') returning id as other_source_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'other_source_run', 'another-source',
    pg_temp.event_payload('play-1', repeat('9', 64), 'plan-z', 'update', true, :'event_id')
  ), 1, 'the same official ID under another source is independent'
);
select is(
  (select count(*) from public.official_import_candidates where run_id = :'run_f'),
  1::bigint, 'another source does not remove the current F proposal'
);

insert into public.official_import_runs (source_id)
values ('supersession-source') returning id as invalid_run \gset
select throws_ok(
  format(
    'select public.commit_official_import_candidate_batch(%L, %L, %L::jsonb)',
    :'invalid_run', 'supersession-source',
    (pg_temp.event_payload('play-1', repeat('f', 64), 'plan-f', 'update', true, :'event_id')
      || pg_temp.event_payload('play-1', repeat('8', 64), 'plan-g', 'update', true, :'event_id'))::text
  ),
  '22023', null, 'two versions of one source identity fail before suppression'
);
select is(
  (select status from public.official_import_runs where id = :'invalid_run'),
  'running', 'failed batch leaves its run retryable'
);

-- Ticket opportunities use the same identity and no-change semantics, but
-- their plan summary has a different set of change flags.
insert into public.ticket_opportunities
  (event_id, target_scope, display_name, source_key)
values (:'event_id', 'event_wide', 'ticket fixture', 'official:ticket:1')
returning id as ticket_id \gset
insert into public.official_import_runs (source_id)
values ('supersession-source') returning id as ticket_change_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'ticket_change_run', 'supersession-source', jsonb_build_array(jsonb_build_object(
      'candidate_kind', 'ticket_opportunity',
      'canonical_url', 'https://official.example/ticket/1',
      'official_external_id', 'play-1',
      'observed_at', clock_timestamp(),
      'content_hash', repeat('1', 64),
      'proposal_version', 'ticket-opportunity-v1',
      'proposal', jsonb_build_object('sourceKey', 'official:ticket:1'),
      'evidence_locator', '{}'::jsonb,
      'deterministic_match_status', 'matched',
      'semantic_match_status', 'not_used',
      'resolved_event_id', :'event_id',
      'resolved_ticket_opportunity_id', :'ticket_id',
      'plan_summary', jsonb_build_object(
        'version', 'ticket_opportunity_plan.v1', 'action', 'update',
        'eventChanged', false, 'detailsChanged', true,
        'occurrencesChanged', false, 'milestonesChanged', false
      ),
      'plan_fingerprint', 'ticket-plan-changed', 'review_status', 'pending'
    ))
  ), 1, 'a ticket candidate is independent of the same-ID Event candidate'
);
insert into public.official_import_runs (source_id)
values ('supersession-source') returning id as ticket_noop_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'ticket_noop_run', 'supersession-source', jsonb_build_array(jsonb_build_object(
      'candidate_kind', 'ticket_opportunity',
      'canonical_url', 'https://official.example/ticket/1',
      'official_external_id', 'play-1',
      'observed_at', clock_timestamp(),
      'content_hash', repeat('2', 64),
      'proposal_version', 'ticket-opportunity-v1',
      'proposal', jsonb_build_object('sourceKey', 'official:ticket:1'),
      'evidence_locator', '{}'::jsonb,
      'deterministic_match_status', 'matched',
      'semantic_match_status', 'not_used',
      'resolved_event_id', :'event_id',
      'resolved_ticket_opportunity_id', :'ticket_id',
      'plan_summary', jsonb_build_object(
        'version', 'ticket_opportunity_plan.v1', 'action', 'unchanged',
        'eventChanged', false, 'detailsChanged', false,
        'occurrencesChanged', false, 'milestonesChanged', false
      ),
      'plan_fingerprint', 'ticket-plan-unchanged', 'review_status', 'pending'
    ))
  ), 0, 'a confirmed unchanged Ticket proposal is not stored'
);
select is(
  (select count(*) from public.official_import_candidates
   where run_id = :'ticket_change_run'),
  0::bigint, 'the older unapplied Ticket proposal was retired'
);

select * from finish();
rollback;
