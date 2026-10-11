\ir helpers/auth.psql
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

select pg_temp.create_test_user() as creator_id \gset
select pg_temp.create_test_user() as other_id \gset
insert into public.catalog_creators (user_id) values (:'creator_id');

select has_table('public', 'official_import_failure_observations', 'failure clues have a bounded table');
select ok(not has_table_privilege('service_role', 'public.official_import_failure_observations', 'INSERT'), 'service role cannot bypass owned RPC');
select ok(not has_table_privilege('authenticated', 'public.official_import_failure_observations', 'INSERT'), 'clients cannot write observations');
select ok(not has_table_privilege('service_role', 'public.official_import_failure_observations', 'UPDATE'), 'service role cannot directly rewrite observations');
select ok(not has_table_privilege('service_role', 'public.official_import_failure_observations', 'DELETE'), 'service role cannot delete observations');
select ok(not has_table_privilege('authenticated', 'public.official_import_failure_observations', 'UPDATE'), 'clients cannot rewrite observations');
select ok(not has_table_privilege('authenticated', 'public.official_import_failure_observations', 'DELETE'), 'clients cannot delete observations');
select ok(not has_function_privilege('authenticated', 'public.record_owned_official_import_failure_observation(uuid,text,text,text,text,text,text,integer,integer,integer)', 'EXECUTE'), 'clients cannot call observation RPC');
select ok(has_function_privilege('service_role', 'public.record_owned_official_import_failure_observation(uuid,text,text,text,text,text,text,integer,integer,integer)', 'EXECUTE'), 'ingestion can call owned RPC');

set local role service_role;
select gen_random_uuid() as run_id \gset
select is(public.claim_official_import_run_attempt(:'run_id', 'event.kabuki-bito.schedule', 'observation-owner', 300), 'claimed', 'claim test run');
select active_attempt_lease_expires_at::text as original_lease from public.official_import_runs where id = :'run_id' \gset
select is(public.record_owned_official_import_failure_observation(:'run_id', 'event.kabuki-bito.schedule', 'wrong-owner', 'acquisition', 'unsupported_format', null, null, null, 0, 0), false, 'stale owner cannot write');
select is((select count(*) from public.official_import_failure_observations where run_id = :'run_id'), 0::bigint, 'stale write leaves no record');
select throws_ok(format($$select public.record_owned_official_import_failure_observation(%L, 'wrong.source', 'observation-owner', 'acquisition', 'unexpected', null, null, null, 0, 0)$$, :'run_id'), '22023', null, 'wrong source rejected');
select is(public.record_owned_official_import_failure_observation(:'run_id', 'event.kabuki-bito.schedule', 'observation-owner', 'acquisition', 'unsupported_format', 'https://www.kabuki-bito.jp/schedule/', null, null, 0, 0), true, 'owned failure clue persists');
select is((select acquired_draft_count from public.official_import_failure_observations where run_id = :'run_id'), null::integer, 'failed acquisition does not invent returned coverage');
select is((select active_attempt_lease_expires_at::text from public.official_import_runs where id = :'run_id'), :'original_lease', 'observation does not renew lease');
select is((select status from public.official_import_runs where id = :'run_id'), 'running', 'observation does not fail or complete run');
select throws_ok(format($$select public.record_owned_official_import_failure_observation(%L, 'event.kabuki-bito.schedule', 'observation-owner', 'acquisition', 'unexpected', 'https://www.kabuki-bito.jp/schedule/?token=secret', null, null, 0, 0)$$, :'run_id'), '23514', null, 'URL query cannot be retained');
select throws_ok(format($$select public.record_owned_official_import_failure_observation(%L, 'event.kabuki-bito.schedule', 'observation-owner', 'acquisition', 'raw error body', null, null, null, 0, 0)$$, :'run_id'), '23514', null, 'reason vocabulary rejects error text');
select throws_ok(format($$select public.record_owned_official_import_failure_observation(%L, 'event.kabuki-bito.schedule', 'observation-owner', 'planning', 'validation', null, 'raw page <body>', 1, 0, 0)$$, :'run_id'), '23514', null, 'external identity rejects raw text');
select throws_ok(format($$select public.record_owned_official_import_failure_observation(%L, 'event.kabuki-bito.schedule', 'observation-owner', 'planning', 'validation', null, null, 1, 2, 0)$$, :'run_id'), '23514', null, 'counts cannot exceed returned drafts');
select throws_ok(format($$select public.record_owned_official_import_failure_observation(%L, 'event.kabuki-bito.schedule', 'observation-owner', 'acquisition', 'validation', null, null, null, 1, 0)$$, :'run_id'), '23514', null, 'acquisition cannot have validated candidates');
select throws_ok(format($$select public.record_owned_official_import_failure_observation(%L, 'event.kabuki-bito.schedule', 'observation-owner', 'planning', 'validation', null, null, null, 0, 0)$$, :'run_id'), '23514', null, 'planning must know returned draft count');
select is(public.record_owned_official_import_failure_observation(:'run_id', 'event.kabuki-bito.schedule', 'observation-owner', 'planning', 'validation', 'https://www.kabuki-bito.jp/theaters/kabukiza/play/1000', '1000', 2, 1, 0), true, 'later owned clue replaces latest record');
select is((select count(*) from public.official_import_failure_observations where run_id = :'run_id'), 1::bigint, 'latest clue remains bounded to one row per run');
select is(public.fail_official_import_run_attempt(:'run_id', 'event.kabuki-bito.schedule', 'observation-owner', 'validation'), 'failed', 'original fail RPC remains unchanged');
select is(public.record_owned_official_import_failure_observation(:'run_id', 'event.kabuki-bito.schedule', 'observation-owner', 'publication', 'unexpected', null, null, 2, 2, 0), false, 'terminal run rejects late observation');
select is((select phase from public.official_import_failure_observations where run_id = :'run_id'), 'planning', 'terminal clue remains unchanged');

select gen_random_uuid() as expired_run_id \gset
select public.claim_official_import_run_attempt(:'expired_run_id', 'expiry-observation', 'expired-owner', 300) as claim \gset
select public.record_owned_official_import_failure_observation(:'expired_run_id', 'expiry-observation', 'expired-owner', 'acquisition', 'source_fetch', null, null, null, 0, 0) as recorded \gset
select set_config('stage_tracker.official_import_attempt_run_id', :'expired_run_id', true) as scope \gset
select set_config('stage_tracker.official_import_attempt_token', 'expired-owner', true) as token_scope \gset
update public.official_import_runs set active_attempt_lease_expires_at = clock_timestamp() - interval '1 second' where id = :'expired_run_id';
select is(public.record_owned_official_import_failure_observation(:'expired_run_id', 'expiry-observation', 'expired-owner', 'acquisition', 'unexpected', null, null, null, 0, 0), false, 'same token cannot write after lease expiry');
select is((select reason_code from public.official_import_failure_observations where run_id = :'expired_run_id'), 'source_fetch', 'expired write preserves original clue');
select is(public.claim_official_import_run_attempt(:'expired_run_id', 'expiry-observation', 'new-owner', 300), 'claimed', 'new owner can take over expired attempt');
select is(public.record_owned_official_import_failure_observation(:'expired_run_id', 'expiry-observation', 'expired-owner', 'acquisition', 'unexpected', null, null, null, 0, 0), false, 'stale token cannot write after takeover');
select public.release_official_import_run_attempt(:'expired_run_id', 'expiry-observation', 'new-owner') as released \gset
select is(public.record_owned_official_import_failure_observation(:'expired_run_id', 'expiry-observation', 'new-owner', 'acquisition', 'unexpected', null, null, null, 0, 0), false, 'released null lease cannot write');
select public.claim_official_import_run_attempt(:'expired_run_id', 'expiry-observation', 'completed-owner', 300) as claimed \gset
select is(public.commit_owned_official_import_candidate_batch(:'expired_run_id', 'expiry-observation', 'completed-owner', '[]'::jsonb), 0, 'existing empty atomic publication still completes');
select is(public.record_owned_official_import_failure_observation(:'expired_run_id', 'expiry-observation', 'completed-owner', 'publication', 'unexpected', null, null, 0, 0, 0), false, 'completed run rejects late clue');
select is((select reason_code from public.official_import_failure_observations where run_id = :'expired_run_id'), 'source_fetch', 'successful retry preserves historical failure clue');
select is((select count(*) from public.official_import_candidates where run_id in (:'run_id', :'expired_run_id')), 0::bigint, 'observations never create candidates');
select throws_ok(format('delete from public.official_import_runs where id = %L', :'run_id'), '23514', null, 'observed failed run keeps terminal deletion guard');
select throws_ok(format('delete from public.official_import_runs where id = %L', :'expired_run_id'), '23514', null, 'observed completed run keeps terminal deletion guard');

select gen_random_uuid() as cleanup_run_id \gset
select public.claim_official_import_run_attempt(:'cleanup_run_id', 'observation-cleanup', 'cleanup-owner', 300) as claimed \gset
select public.record_owned_official_import_failure_observation(:'cleanup_run_id', 'observation-cleanup', 'cleanup-owner', 'acquisition', 'source_fetch', null, null, null, 0, 0) as recorded \gset
select is((select count(*) from public.official_import_failure_observations where run_id = :'cleanup_run_id'), 1::bigint, 'cleanup fixture contains a diagnostic before parent deletion');
select public.release_official_import_run_attempt(:'cleanup_run_id', 'observation-cleanup', 'cleanup-owner') as released \gset
select lives_ok(format('delete from public.official_import_runs where id = %L', :'cleanup_run_id'), 'existing released empty-run deletion stays permitted');
select is((select count(*) from public.official_import_runs where id = :'cleanup_run_id'), 0::bigint, 'permitted cleanup removes the parent run');
select is((select count(*) from public.official_import_failure_observations where run_id = :'cleanup_run_id'), 0::bigint, 'diagnostic follows the already-permitted parent deletion');

reset role;
call pg_temp.auth_as_user(:'creator_id');
select is((select count(*) from public.official_import_failure_observations where run_id in (:'run_id', :'expired_run_id')), 2::bigint, 'catalog creator can read failure clues');
call pg_temp.auth_as_user(:'other_id');
select is((select count(*) from public.official_import_failure_observations), 0::bigint, 'ordinary authenticated user cannot read clues');
reset role;
set local role anon;
select throws_ok('select * from public.official_import_failure_observations', '42501', null, 'anonymous reads denied');
reset role;

select * from finish();
rollback;
