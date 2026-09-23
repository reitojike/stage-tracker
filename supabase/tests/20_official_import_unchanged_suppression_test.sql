-- Issue #634: completed scans retain run evidence but do not restage unchanged
-- source candidates, including when separately created runs race to publish.

begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

create function pg_temp.official_candidate_payload(
  p_url text,
  p_external_id text,
  p_hash text,
  p_plan text,
  p_version text default 'event-v1'
) returns jsonb
language sql
as $$
  select jsonb_build_array(jsonb_build_object(
    'candidate_kind', 'event',
    'canonical_url', p_url,
    'official_external_id', p_external_id,
    'observed_at', '2026-09-23T00:00:00Z',
    'content_hash', p_hash,
    'proposal_version', p_version,
    'proposal', jsonb_build_object('title', 'fixture'),
    'evidence_locator', '{}'::jsonb,
    'deterministic_match_status', 'unresolved',
    'semantic_match_status', 'not_used',
    'plan_summary', '{}'::jsonb,
    'plan_fingerprint', p_plan,
    'review_status', 'pending'
  ));
$$;

set local role service_role;

insert into public.official_import_runs (source_id)
values ('suppression-a') returning id as first_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'first_run', 'suppression-a',
    pg_temp.official_candidate_payload(
      'https://official.example/event/first', 'official-1', repeat('a', 64), 'plan-a'
    )
  ),
  1,
  'first completed scan stages its candidate'
);

insert into public.official_import_runs (source_id)
values ('suppression-a') returning id as repeat_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'repeat_run', 'suppression-a',
    pg_temp.official_candidate_payload(
      'https://official.example/event/first', 'official-1', repeat('a', 64), 'plan-a'
    )
  ),
  0,
  'identical content and plan in another run stages no candidate'
);
select is(
  (select count(*) from public.official_import_candidates
   where source_id = 'suppression-a'),
  1::bigint,
  'unchanged scans do not grow the review queue'
);
select is(
  (select status from public.official_import_runs where id = :'repeat_run'),
  'completed',
  'suppressed scan still has a completed run record'
);
select is(
  public.commit_official_import_candidate_batch(
    :'repeat_run', 'suppression-a', '[]'::jsonb
  ),
  0,
  'retry of a completed suppressed run preserves the zero count'
);

insert into public.official_import_runs (source_id)
values ('suppression-a') returning id as changed_hash_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'changed_hash_run', 'suppression-a',
    pg_temp.official_candidate_payload(
      'https://official.example/event/first', 'official-1', repeat('b', 64), 'plan-a'
    )
  ),
  1,
  'changed source content creates a new review candidate'
);

insert into public.official_import_runs (source_id)
values ('suppression-a') returning id as changed_plan_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'changed_plan_run', 'suppression-a',
    pg_temp.official_candidate_payload(
      'https://official.example/event/first', 'official-1', repeat('a', 64), 'plan-b'
    )
  ),
  1,
  'changed deterministic plan creates a new review candidate'
);

insert into public.official_import_runs (source_id)
values ('suppression-a') returning id as changed_version_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'changed_version_run', 'suppression-a',
    pg_temp.official_candidate_payload(
      'https://official.example/event/first', 'official-1', repeat('a', 64), 'plan-a', 'event-v2'
    )
  ),
  1,
  'changed proposal version is not suppressed'
);

insert into public.official_import_runs (source_id)
values ('suppression-b') returning id as other_source_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'other_source_run', 'suppression-b',
    pg_temp.official_candidate_payload(
      'https://official.example/event/first', 'official-1', repeat('a', 64), 'plan-a'
    )
  ),
  1,
  'a different official source is not suppressed'
);

insert into public.official_import_runs (source_id)
values ('suppression-a') returning id as moved_url_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'moved_url_run', 'suppression-a',
    pg_temp.official_candidate_payload(
      'https://official.example/event/renamed', 'official-1', repeat('a', 64), 'plan-a'
    )
  ),
  0,
  'an official external ID remains stable across a permalink change'
);

insert into public.official_import_runs (source_id)
values ('suppression-null-id') returning id as null_id_first_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'null_id_first_run', 'suppression-null-id',
    pg_temp.official_candidate_payload(
      'https://official.example/event/no-id', null, repeat('c', 64), 'plan-c'
    )
  ),
  1,
  'a candidate without an external ID uses its canonical URL'
);

insert into public.official_import_runs (source_id)
values ('suppression-null-id') returning id as null_id_repeat_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'null_id_repeat_run', 'suppression-null-id',
    pg_temp.official_candidate_payload(
      'https://official.example/event/no-id', null, repeat('c', 64), 'plan-c'
    )
  ),
  0,
  'the same canonical URL is suppressed when the external ID is absent'
);

insert into public.official_import_runs (source_id)
values ('suppression-null-id') returning id as null_id_other_url_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'null_id_other_url_run', 'suppression-null-id',
    pg_temp.official_candidate_payload(
      'https://official.example/event/another', null, repeat('c', 64), 'plan-c'
    )
  ),
  1,
  'another URL is distinct when there is no external ID'
);

insert into public.official_import_runs (source_id)
values ('suppression-unfinished') returning id as unfinished_run \gset
insert into public.official_import_candidates (
  run_id, source_id, candidate_kind, canonical_url, official_external_id,
  content_hash, proposal_version, proposal, plan_fingerprint
) values (
  :'unfinished_run', 'suppression-unfinished', 'event',
  'https://official.example/event/unfinished', 'unfinished-1',
  repeat('d', 64), 'event-v1', '{"title":"fixture"}'::jsonb, 'plan-d'
);
insert into public.official_import_runs (source_id)
values ('suppression-unfinished') returning id as after_unfinished_run \gset
select is(
  public.commit_official_import_candidate_batch(
    :'after_unfinished_run', 'suppression-unfinished',
    pg_temp.official_candidate_payload(
      'https://official.example/event/unfinished', 'unfinished-1', repeat('d', 64), 'plan-d'
    )
  ),
  1,
  'partial rows from unfinished runs cannot suppress a completed scan'
);

insert into public.official_import_runs (source_id)
values ('suppression-duplicate') returning id as duplicate_run \gset
select throws_ok(
  format(
    'select public.commit_official_import_candidate_batch(%L, %L, %L::jsonb)',
    :'duplicate_run', 'suppression-duplicate',
    (
      pg_temp.official_candidate_payload(
        'https://official.example/event/duplicate', 'duplicate-1', repeat('e', 64), 'plan-e'
      ) || pg_temp.official_candidate_payload(
        'https://official.example/event/duplicate', 'duplicate-1', repeat('e', 64), 'plan-e'
      )
    )::text
  ),
  '22023', null,
  'exact duplicate candidates within one run fail closed'
);
select is(
  (select status from public.official_import_runs where id = :'duplicate_run'),
  'running',
  'duplicate batch leaves its run retryable'
);
select is(
  (select count(*) from public.official_import_candidates
   where run_id = :'duplicate_run'),
  0::bigint,
  'duplicate batch stages no partial rows'
);

select * from finish();
rollback;
