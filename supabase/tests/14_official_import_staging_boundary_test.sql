-- Issue #628: official import staging/review boundary.
--
-- This suite uses real Postgres roles and auth claims. It proves that the
-- trusted writer can stage operational candidates, that only a designated
-- catalog creator can see/review them, and that the review RPC does not
-- become a catalog-write path.
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

select pg_temp.create_test_user() as creator_id \gset
select pg_temp.create_test_user() as other_id \gset

insert into public.catalog_creators (user_id)
values (:'creator_id');

insert into public.events (owner_id, title, starts_on, ends_on)
values (:'creator_id', 'P2 staging fixture event', '2026-11-01', '2026-11-01')
returning id as event_id \gset

insert into public.event_occurrences (event_id, starts_at)
values (:'event_id', '2026-11-01T18:00:00+09:00')
returning id as occurrence_id \gset

insert into public.ticket_opportunities (event_id, target_scope, display_name, source_key)
values (:'event_id', 'event_wide', 'P2 staging fixture opportunity', 'p2-staging-fixture')
returning id as opportunity_id \gset

-- The privileged path is the only direct staging writer.
set local role service_role;

insert into public.official_import_runs (source_id)
values ('fixture-source')
returning id as run_id \gset

select throws_ok(
  format(
    $$insert into public.official_import_candidates (
      run_id, source_id, candidate_kind, canonical_url, content_hash,
      proposal_version, proposal, plan_fingerprint, review_status, reviewer,
      reviewed_at, apply_status, applied_at
    ) values (%L, %L, 'event', %L, %L, 'event-v1', %L::jsonb, %L,
      'approved', %L, now(), 'applied', now())$$,
    :'run_id',
    'fixture-source',
    'https://official.example/events/0',
    repeat('0', 64),
    '{"title":"spoofed approved proposal"}',
    repeat('0', 64),
    :'creator_id'
  ),
  '23514',
  null,
  'trusted writer cannot insert an already approved or applied candidate'
);

insert into public.official_import_candidates (
  run_id,
  source_id,
  candidate_kind,
  canonical_url,
  official_external_id,
  content_hash,
  proposal_version,
  proposal,
  evidence_locator,
  deterministic_match_status,
  semantic_match_status,
  resolved_event_id,
  resolved_ticket_opportunity_id,
  plan_summary,
  plan_fingerprint
)
values (
  :'run_id',
  'fixture-source',
  'event',
  'https://official.example/events/1',
  'official-event-1',
  repeat('a', 64),
  'event-v1',
  '{"title":"P2 proposal"}'::jsonb,
  '{"page":1,"section":"schedule"}'::jsonb,
  'matched',
  'not_used',
  :'event_id',
  :'opportunity_id',
  '{"operation":"unchanged"}'::jsonb,
  repeat('b', 64)
)
returning id as candidate_id \gset

insert into public.official_import_candidates (
  run_id,
  source_id,
  candidate_kind,
  canonical_url,
  official_external_id,
  content_hash,
  proposal_version,
  proposal,
  evidence_locator,
  plan_fingerprint
)
values (
  :'run_id',
  'fixture-source',
  'event',
  'https://official.example/events/2',
  'official-event-2',
  repeat('c', 64),
  'event-v1',
  '{"title":"P2 rejection proposal"}'::jsonb,
  '{"page":2}'::jsonb,
  repeat('d', 64)
)
returning id as rejected_candidate_id \gset

insert into public.official_import_candidates (
  run_id,
  source_id,
  candidate_kind,
  canonical_url,
  official_external_id,
  content_hash,
  proposal_version,
  proposal,
  evidence_locator,
  plan_fingerprint
)
values (
  :'run_id',
  'fixture-source',
  'event',
  'https://official.example/events/3',
  'official-event-3',
  repeat('e', 64),
  'event-v1',
  '{"title":"P2 third proposal"}'::jsonb,
  '{"page":3}'::jsonb,
  repeat('f', 64)
)
returning id as third_candidate_id \gset

select is(
  (select count(*) from public.official_import_candidates),
  3::bigint,
  'service_role can create official import candidates'
);

update public.official_import_candidates
set proposal = '{"title":"P2 updated proposal"}'::jsonb
where id = :'candidate_id';

select is(
  (select proposal ->> 'title' from public.official_import_candidates where id = :'candidate_id'),
  'P2 updated proposal',
  'service_role can update candidate operational state'
);

update public.official_import_runs
set status = 'completed', finished_at = now(), candidate_count = 3
where id = :'run_id';

select is(
  (select status from public.official_import_runs where id = :'run_id'),
  'completed',
  'service_role can complete an import run'
);

-- No raw source archive columns are part of this boundary.
select hasnt_column(
  'public', 'official_import_candidates', 'raw_html',
  'candidate table does not retain raw HTML'
);
select hasnt_column(
  'public', 'official_import_candidates', 'raw_pdf',
  'candidate table does not retain raw PDF bytes'
);
select hasnt_column(
  'public', 'official_import_candidates', 'raw_body',
  'candidate table does not retain a raw source body'
);

-- Ordinary authenticated users have no review-queue visibility and no write
-- privilege. The creator policy is intentionally not a general authenticated
-- read policy.
call pg_temp.auth_as_user(:'other_id');
select is(
  (select count(*) from public.official_import_runs),
  0::bigint,
  'non-creator cannot read official import runs'
);
select is(
  (select count(*) from public.official_import_candidates),
  0::bigint,
  'non-creator cannot read official import candidates'
);
select throws_ok(
  $$insert into public.official_import_candidates default values$$,
  '42501',
  null,
  'ordinary authenticated user cannot create a candidate'
);
select throws_ok(
  $$insert into public.official_import_runs (source_id) values ('spoofed-source')$$,
  '42501',
  null,
  'ordinary authenticated user cannot create an import run'
);
select throws_ok(
  format(
    $$select public.review_official_import_candidate(%L, 'approved')$$,
    :'candidate_id'
  ),
  '42501',
  null,
  'review RPC rejects a non-creator'
);

call pg_temp.auth_as_user(:'creator_id');
select is(
  (select count(*) from public.official_import_candidates),
  3::bigint,
  'designated catalog creator can read the review queue'
);
select is(
  (select count(*) from public.official_import_runs),
  1::bigint,
  'designated catalog creator can read import run context'
);

select is(
  (select review_status
   from public.review_official_import_candidate(:'candidate_id', 'approved')),
  'approved',
  'creator can approve a pending candidate through the narrow RPC'
);
select is(
  (select reviewer from public.official_import_candidates where id = :'candidate_id'),
  :'creator_id'::uuid,
  'reviewer is derived from auth.uid(), not client input'
);

call pg_temp.auth_as_admin();
set local role service_role;
select throws_ok(
  format(
    $$update public.official_import_candidates
      set proposal = '{"title":"post-review rewrite"}'::jsonb
      where id = %L$$,
    :'candidate_id'
  ),
  '23514',
  null,
  'reviewed candidate contents cannot be rewritten by the trusted writer'
);

call pg_temp.auth_as_user(:'creator_id');

-- The ordinary client cannot update reviewer fields directly, even while it
-- is a designated creator; there is no UPDATE grant on staging tables.
select throws_ok(
  format(
    $$update public.official_import_candidates
      set reviewer = %L where id = %L$$,
    :'other_id', :'candidate_id'
  ),
  '42501',
  null,
  'client cannot spoof reviewer through table UPDATE'
);

select throws_ok(
  format(
    $$select public.review_official_import_candidate(%L, 'blocked_for_identity_review')$$,
    :'third_candidate_id'
  ),
  '22023',
  null,
  'review RPC accepts only approve/reject decisions'
);

select is(
  (select review_status
   from public.review_official_import_candidate(:'rejected_candidate_id', 'rejected')),
  'rejected',
  'creator can reject a pending candidate through the narrow RPC'
);
select throws_ok(
  format(
    $$select public.review_official_import_candidate(%L, 'approved')$$,
    :'rejected_candidate_id'
  ),
  '22023',
  null,
  'rejected candidates cannot be approved later'
);
select throws_ok(
  format(
    $$select public.review_official_import_candidate(%L, 'rejected')$$,
    :'candidate_id'
  ),
  '22023',
  null,
  'approved candidates cannot be reviewed again'
);

-- Apply state is separate and only a privileged writer can advance it after
-- approval. A rejected candidate cannot enter apply state.
call pg_temp.auth_as_admin();
set local role service_role;
select throws_ok(
  format(
    $$update public.official_import_candidates
      set apply_status = 'queued' where id = %L$$,
    :'rejected_candidate_id'
  ),
  '23514',
  null,
  'rejected candidates cannot enter apply state'
);
update public.official_import_candidates
set apply_status = 'queued'
where id = :'candidate_id';
update public.official_import_candidates
set apply_status = 'applied', applied_at = now()
where id = :'candidate_id';
select is(
  (select apply_status from public.official_import_candidates where id = :'candidate_id'),
  'applied',
  'privileged path can advance an approved candidate to applied'
);

select throws_ok(
  format(
    $$update public.official_import_candidates
      set review_status = 'pending', reviewer = null, reviewed_at = null
      where id = %L$$,
    :'candidate_id'
  ),
  '23514',
  null,
  'applied candidates cannot be reopened by a direct state update'
);

-- Review only changes the staging row. Product catalog rows remain byte-for-
-- byte semantically unchanged.
select is(
  (select title from public.events where id = :'event_id'),
  'P2 staging fixture event',
  'review does not mutate Event'
);
select is(
  (select starts_at from public.event_occurrences where id = :'occurrence_id'),
  '2026-11-01 09:00:00+00'::timestamptz,
  'review does not mutate Occurrence'
);
select is(
  (select display_name from public.ticket_opportunities where id = :'opportunity_id'),
  'P2 staging fixture opportunity',
  'review does not mutate TicketOpportunity'
);

-- This exact privilege set is the direct grant boundary for both staging
-- tables. The policy alone is not enough: authenticated must not gain a
-- future INSERT/UPDATE/DELETE path by accident.
set local role postgres;
select is(
  (
    select count(*)
    from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name in ('official_import_runs', 'official_import_candidates')
  ),
  2::bigint,
  'authenticated has exactly two direct staging-table grants'
);
select is(
  (
    select count(*)
    from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name in ('official_import_runs', 'official_import_candidates')
      and privilege_type = 'SELECT'
  ),
  2::bigint,
  'authenticated has SELECT only on the staging tables'
);

select * from finish();
rollback;
