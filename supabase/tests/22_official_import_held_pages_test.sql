-- Issue #634: held-page metadata is atomic with a partial candidate batch.

begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select has_table('public', 'official_import_held_pages', 'held pages have a durable report table');
select has_column('public', 'official_import_held_pages', 'reason_code', 'held report has a bounded reason code');
select ok(
  has_table_privilege('authenticated', 'public.official_import_held_pages', 'SELECT'),
  'authenticated creator reads can reach the RLS table'
);
select ok(
  not has_table_privilege('authenticated', 'public.official_import_held_pages', 'INSERT'),
  'authenticated clients cannot write held reports'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.commit_owned_official_import_partial_batch(uuid,text,text,jsonb,jsonb)',
    'EXECUTE'
  ),
  'ordinary clients cannot complete a partial batch'
);

set local role service_role;
select gen_random_uuid() as run_id \gset
select gen_random_uuid() as invalid_run_id \gset
select gen_random_uuid() as missing_end_run_id \gset

select is(
  public.claim_official_import_run_attempt(
    :'run_id', 'event.kabuki-bito.schedule', 'held-owner', 300
  ),
  'claimed',
  'service-role owner claims the run'
);
select is(
  public.commit_owned_official_import_partial_batch(
    :'run_id', 'event.kabuki-bito.schedule', 'held-owner', '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'canonical_url', 'https://www.kabuki-bito.jp/theaters/other/play/1000',
      'official_external_id', '1000',
      'title', '保留公演',
      'starts_on', '2026-10-01',
      'ends_on', '2026-10-02',
      'reason_code', 'source_parse'
    ))
  ),
  0,
  'partial run can complete with zero candidates and one held page'
);
select is(
  (select count(*) from public.official_import_held_pages where run_id = :'run_id'),
  1::bigint,
  'held page identity is committed'
);
select is(
  (select status from public.official_import_runs where id = :'run_id'),
  'completed',
  'run completion is committed with the held page'
);
select is(
  public.commit_owned_official_import_partial_batch(
    :'run_id', 'event.kabuki-bito.schedule', 'held-owner', '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'canonical_url', 'https://www.kabuki-bito.jp/theaters/other/play/1000',
      'official_external_id', '1000',
      'title', '保留公演',
      'starts_on', '2026-10-01',
      'ends_on', '2026-10-02',
      'reason_code', 'source_parse'
    ))
  ),
  0,
  'completed-run replay returns the stable candidate count'
);
select is(
  (select count(*) from public.official_import_held_pages where run_id = :'run_id'),
  1::bigint,
  'completed-run replay does not duplicate the held report'
);

select is(
  public.claim_official_import_run_attempt(
    :'invalid_run_id', 'event.kabuki-bito.schedule', 'second-owner', 300
  ),
  'claimed',
  'another run can claim the source after completion'
);
select throws_ok(
  format(
    $$select public.commit_owned_official_import_partial_batch(
      %L, 'event.kabuki-bito.schedule', 'stale-owner', '[]'::jsonb,
      '[{"canonical_url":"https://www.kabuki-bito.jp/theaters/other/play/1001",
         "official_external_id":"1001","title":"保留公演",
         "starts_on":"2026-10-01","ends_on":"2026-10-02",
         "reason_code":"source_parse"}]'::jsonb
    )$$,
    :'invalid_run_id'
  ),
  '55000', null, 'stale owner cannot publish a held page'
);
select is(
  (select count(*) from public.official_import_held_pages where run_id = :'invalid_run_id'),
  0::bigint,
  'stale attempt leaves no held report'
);
select throws_ok(
  format(
    $$select public.commit_owned_official_import_partial_batch(
      %L, 'event.kabuki-bito.schedule', 'second-owner', '{}'::jsonb,
      '[{"canonical_url":"https://www.kabuki-bito.jp/theaters/other/play/1001",
         "official_external_id":"1001","title":"保留公演",
         "starts_on":"2026-10-01","ends_on":"2026-10-02",
         "reason_code":"source_parse"}]'::jsonb
    )$$,
    :'invalid_run_id'
  ),
  '22023', null, 'invalid candidate batch rolls back the held-page insert'
);
select is(
  (select count(*) from public.official_import_held_pages where run_id = :'invalid_run_id'),
  0::bigint,
  'candidate failure leaves no partial held report'
);
select is(
  public.release_official_import_run_attempt(
    :'invalid_run_id', 'event.kabuki-bito.schedule', 'second-owner'
  ),
  'released',
  'the prior active attempt releases the source before the next run'
);

select is(
  public.claim_official_import_run_attempt(
    :'missing_end_run_id', 'event.kabuki-bito.schedule', 'missing-end-owner', 300
  ),
  'claimed',
  'another run can claim a missing-end report'
);
select is(
  public.commit_owned_official_import_partial_batch(
    :'missing_end_run_id', 'event.kabuki-bito.schedule',
    'missing-end-owner', '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'canonical_url', 'https://www.kabuki-bito.jp/theaters/kabukiza/play/985',
      'official_external_id', '985',
      'title', '歌舞伎座の公演',
      'starts_on', '2026-10-01',
      'ends_on', '2026-10-20',
      'reason_code', 'published_end_missing'
    ))
  ),
  0,
  'a missing published end can be reported without a candidate'
);
select is(
  (select reason_code from public.official_import_held_pages
   where run_id = :'missing_end_run_id'),
  'published_end_missing',
  'the distinct missing-end reason is retained'
);

select * from finish();
rollback;
