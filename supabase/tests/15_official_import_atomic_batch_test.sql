-- Issue #629: retry-safe atomic publication of one staged candidate batch.

begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

set local role service_role;

insert into public.official_import_runs (source_id)
values ('atomic-fixture')
returning id as run_id \gset

select throws_ok(
  format(
    $$select public.commit_official_import_candidate_batch(%L, 'atomic-fixture', '{}'::jsonb)$$,
    :'run_id'
  ),
  '22023', null, 'reject a non-array candidate payload'
);

select throws_ok(
  format(
    $$select public.commit_official_import_candidate_batch(
      %L,
      'wrong-source',
      '[]'::jsonb
    )$$,
    :'run_id'
  ),
  '22023', null, 'reject a source mismatch'
);

select throws_ok(
  format(
    $$select public.commit_official_import_candidate_batch(
      %L,
      'atomic-fixture',
      %L::jsonb
    )$$,
    :'run_id',
    '[
      {
        "candidate_kind":"event",
        "canonical_url":"https://official.example/events/atomic-valid",
        "observed_at":"2026-09-22T00:00:00Z",
        "content_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "proposal_version":"event-v1",
        "proposal":{"title":"valid"},
        "evidence_locator":{},
        "deterministic_match_status":"unresolved",
        "semantic_match_status":"not_used",
        "plan_summary":{},
        "plan_fingerprint":"valid-plan",
        "review_status":"pending"
      },
      {
        "candidate_kind":"event",
        "canonical_url":"not-an-official-url",
        "observed_at":"2026-09-22T00:00:00Z",
        "content_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "proposal_version":"event-v1",
        "proposal":{"title":"invalid"},
        "evidence_locator":{},
        "deterministic_match_status":"unresolved",
        "semantic_match_status":"not_used",
        "plan_summary":{},
        "plan_fingerprint":"invalid-plan",
        "review_status":"pending"
      }
    ]'
  ),
  '23514', null, 'roll back the whole batch when one candidate is invalid'
);

select is(
  (select count(*) from public.official_import_candidates where run_id = :'run_id'),
  0::bigint,
  'failed batch leaves no partial candidates'
);
select is(
  (select status from public.official_import_runs where id = :'run_id'),
  'running',
  'failed batch leaves its parent run retryable'
);

insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, content_hash,
  proposal_version, proposal, plan_fingerprint
)
values (
  :'run_id', 'atomic-fixture', 'event',
  'https://official.example/events/interrupted-blocked', repeat('e', 64),
  'event-v1', '{"title":"interrupted"}'::jsonb, 'interrupted-plan'
)
returning id as interrupted_candidate_id \gset

update public.official_import_candidates
set review_status = 'blocked_for_identity_review'
where id = :'interrupted_candidate_id';

select throws_ok(
  format(
    $$delete from public.official_import_candidates where id = %L$$,
    :'interrupted_candidate_id'
  ),
  '23514', null, 'direct delete still rejects an identity-blocked candidate'
);

select is(
  public.commit_official_import_candidate_batch(
    :'run_id',
    'atomic-fixture',
    '[
      {
        "candidate_kind":"event",
        "canonical_url":"https://official.example/events/atomic-1",
        "observed_at":"2026-09-22T00:00:00Z",
        "content_hash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "proposal_version":"event-v1",
        "proposal":{"title":"first"},
        "evidence_locator":{},
        "deterministic_match_status":"unresolved",
        "semantic_match_status":"not_used",
        "plan_summary":{},
        "plan_fingerprint":"first-plan",
        "review_status":"pending"
      },
      {
        "candidate_kind":"ticket_opportunity",
        "canonical_url":"https://official.example/tickets/atomic-2",
        "observed_at":"2026-09-22T00:00:00Z",
        "content_hash":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        "proposal_version":"ticket-opportunity-v1",
        "proposal":{"displayName":"second"},
        "evidence_locator":{},
        "deterministic_match_status":"unresolved",
        "semantic_match_status":"low_confidence",
        "plan_summary":{},
        "plan_fingerprint":"second-plan",
        "review_status":"blocked_for_identity_review"
      }
    ]'::jsonb
  ),
  2,
  'publish the complete valid batch'
);

select is(
  (select count(*) from public.official_import_candidates where run_id = :'run_id'),
  2::bigint,
  'valid batch is staged exactly once'
);
select is(
  (
    select count(*)
    from public.official_import_candidates
    where run_id = :'run_id'
      and canonical_url = 'https://official.example/events/interrupted-blocked'
  ),
  0::bigint,
  'atomic retry replaces a previously identity-blocked partial candidate'
);
select is(
  (
    select review_status
    from public.official_import_candidates
    where canonical_url = 'https://official.example/tickets/atomic-2'
  ),
  'blocked_for_identity_review',
  'identity-blocked state is published before the run completes'
);
select is(
  (select status from public.official_import_runs where id = :'run_id'),
  'completed',
  'candidate publication completes the run in the same transaction'
);

select is(
  public.commit_official_import_candidate_batch(:'run_id', 'atomic-fixture', '[]'::jsonb),
  2,
  'a serialized retry reuses the completed result'
);
select is(
  (select count(*) from public.official_import_candidates where run_id = :'run_id'),
  2::bigint,
  'a serialized retry neither deletes nor duplicates candidates'
);

select * from finish();
rollback;
