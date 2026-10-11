\ir helpers/auth.psql
begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

select pg_temp.create_test_user() as creator_id \gset
select pg_temp.create_test_user() as other_id \gset
insert into public.catalog_creators (user_id) values (:'creator_id');

select ok(has_function_privilege('service_role', 'public.fail_official_import_run_attempt(uuid,text,text,text)', 'EXECUTE'), 'old signature remains callable');
select ok(has_function_privilege('service_role', 'public.fail_official_import_run_attempt(uuid,text,text,text,text,text,text)', 'EXECUTE'), 'new signature callable by ingestion');
select ok(not has_function_privilege('authenticated', 'public.fail_official_import_run_attempt(uuid,text,text,text,text,text,text)', 'EXECUTE'), 'clients cannot call new signature');
select ok(not has_function_privilege('anon', 'public.fail_official_import_run_attempt(uuid,text,text,text,text,text,text)', 'EXECUTE'), 'anonymous calls denied');
select ok(not has_table_privilege('authenticated', 'public.official_import_runs', 'UPDATE'), 'clients cannot write clues');
select ok(to_regclass('public.official_import_failure_observations') is null, 'no separate observation table');

create function pg_temp.failed_fixture(p_phase text, p_reason text, p_url text, p_class text default 'source_parse', p_source text default 'event.kabuki-bito.schedule') returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  perform public.claim_official_import_run_attempt(v_id, p_source, 'owner', 300);
  if public.fail_official_import_run_attempt(v_id, p_source, 'owner', p_class, p_phase, p_reason, p_url) <> 'failed' then
    raise exception 'fixture did not fail';
  end if;
  return v_id;
end;
$$;

set local role service_role;
select gen_random_uuid() as old_id \gset
select public.claim_official_import_run_attempt(:'old_id', 'event.kabuki-bito.schedule', 'owner', 300) as claimed \gset
select is(public.fail_official_import_run_attempt(:'old_id', 'event.kabuki-bito.schedule', 'owner', 'validation'), 'failed', 'four arguments preserve original transition');
select ok((select failure_phase is null and failure_reason is null and failure_url is null from public.official_import_runs where id = :'old_id'), 'old caller leaves all clues NULL');

select pg_temp.failed_fixture('acquisition', 'request_limit', 'https://www.kabuki-bito.jp/schedule/') as clue_id \gset
select is((select failure_classification from public.official_import_runs where id = :'clue_id'), 'source_parse', 'classification remains authoritative');
select is((select failure_reason from public.official_import_runs where id = :'clue_id'), 'request_limit', 'bounded parse reason retained');
select is((select failure_phase from public.official_import_runs where id = :'clue_id'), 'acquisition', 'phase retained');
select is((select failure_url from public.official_import_runs where id = :'clue_id'), 'https://www.kabuki-bito.jp/schedule/', 'safe source-specific URL retained');
select ok((select active_attempt_token is null and active_attempt_lease_expires_at is null from public.official_import_runs where id = :'clue_id'), 'same terminal UPDATE clears ownership');
select is(public.fail_official_import_run_attempt(:'clue_id', 'event.kabuki-bito.schedule', 'late-owner', 'unexpected', 'planning', 'unexpected', ''), 'failed', 'late call returns immutable terminal status');
select is((select failure_reason from public.official_import_runs where id = :'clue_id'), 'request_limit', 'late call cannot overwrite winning clue');
select throws_ok(format('update public.official_import_runs set failure_url = null where id = %L', :'clue_id'), '23514', null, 'terminal clues immutable');
select throws_ok(format('delete from public.official_import_runs where id = %L', :'clue_id'), '23514', null, 'terminal deletion guard unchanged');

select pg_temp.failed_fixture(null, null, null, 'validation') as normalized_id \gset
select is((select failure_phase from public.official_import_runs where id = :'normalized_id'), null::text, 'NULL clues preserve failure');
select pg_temp.failed_fixture('RAW_SENTINEL', 'unexpected', '', 'unexpected') as normalized_id \gset
select is((select failure_phase from public.official_import_runs where id = :'normalized_id'), null::text, 'invalid phase discarded');
select pg_temp.failed_fixture('planning', repeat('RAW_SENTINEL', 1000), '', 'validation') as normalized_id \gset
select is((select failure_reason from public.official_import_runs where id = :'normalized_id'), null::text, 'oversized reason discarded');
select pg_temp.failed_fixture('planning', 'unexpected', '', 'validation') as normalized_id \gset
select is((select failure_reason from public.official_import_runs where id = :'normalized_id'), null::text, 'reason cannot mislabel classification');
select pg_temp.failed_fixture('planning', 'validation', 'https://evil.test/private', 'validation') as normalized_id \gset
select is((select failure_url from public.official_import_runs where id = :'normalized_id'), null::text, 'foreign URL discarded');
select pg_temp.failed_fixture('planning', 'validation', 'https://www.kabuki-bito.jp/schedule/?email=private@example.test', 'validation') as normalized_id \gset
select is((select failure_url from public.official_import_runs where id = :'normalized_id'), null::text, 'query PII discarded');
select pg_temp.failed_fixture('planning', 'validation', 'https://user:secret@www.kabuki-bito.jp/schedule/', 'validation') as normalized_id \gset
select is((select failure_url from public.official_import_runs where id = :'normalized_id'), null::text, 'URL credentials discarded');
select pg_temp.failed_fixture('planning', 'validation', 'https://www.kabuki-bito.jp/schedule/#private', 'validation') as normalized_id \gset
select is((select failure_url from public.official_import_runs where id = :'normalized_id'), null::text, 'URL fragment discarded');
select pg_temp.failed_fixture('planning', 'validation', 'https://www.kabuki-bito.jp/theaters/other/play/%70rivate', 'validation') as normalized_id \gset
select is((select failure_url from public.official_import_runs where id = :'normalized_id'), null::text, 'encoded/free-form locator discarded');
select pg_temp.failed_fixture('planning', 'validation', 'https://www.kabuki-bito.jp/schedule/' || repeat('a', 3000), 'validation') as normalized_id \gset
select is((select failure_url from public.official_import_runs where id = :'normalized_id'), null::text, 'oversized URL discarded');
select pg_temp.failed_fixture('publication', 'unexpected', 'https://www.kabuki-bito.jp/schedule/', 'unexpected') as normalized_id \gset
select is((select failure_url from public.official_import_runs where id = :'normalized_id'), null::text, 'publication has no last-item URL');
select pg_temp.failed_fixture('acquisition', 'unsupported_format', 'https://www1.ticket-web-shochiku.com/t/info/sale_schedule_east.html', 'source_parse', 'ticket.shochiku.schedule') as normalized_id \gset
select is((select failure_url from public.official_import_runs where id = :'normalized_id'), 'https://www1.ticket-web-shochiku.com/t/info/sale_schedule_east.html', 'Shochiku exact page allowed');
select pg_temp.failed_fixture('acquisition', 'unsupported_format', 'https://www1.ticket-web-shochiku.com/t/info/sale_schedule_east.html') as normalized_id \gset
select is((select failure_url from public.official_import_runs where id = :'normalized_id'), null::text, 'official URL from another source is discarded');
select pg_temp.failed_fixture('acquisition', 'unsupported_format', 'https://kageki.hankyu.co.jp/sp/revue/2027/example/schedule_tokyo.html', 'source_parse', 'event.takarazuka.revue') as normalized_id \gset
select is((select failure_url from public.official_import_runs where id = :'normalized_id'), 'https://kageki.hankyu.co.jp/sp/revue/2027/example/schedule_tokyo.html', 'main-theater Takarazuka page allowed');
select pg_temp.failed_fixture('acquisition', 'unsupported_format', 'https://kageki.hankyu.co.jp/sp/revue/2027/example/schedule_other.html', 'source_parse', 'event.takarazuka.revue') as normalized_id \gset
select is((select failure_url from public.official_import_runs where id = :'normalized_id'), null::text, 'other-theater locator excluded');

select gen_random_uuid() as boundary_id \gset
select public.claim_official_import_run_attempt(:'boundary_id', 'event.kabuki-bito.schedule', 'owner', 300) as claimed \gset
select set_config('stage_tracker.official_import_attempt_run_id', :'boundary_id', true) as scope \gset
select set_config('stage_tracker.official_import_attempt_token', 'owner', true) as scope \gset
update public.official_import_runs set active_attempt_lease_expires_at = clock_timestamp() + interval '1 second' where id = :'boundary_id';
select is(public.fail_official_import_run_attempt(:'boundary_id', 'event.kabuki-bito.schedule', 'owner', 'validation', 'planning', 'validation', ''), 'failed', 'near-expiry terminal failure has no diagnostic wait');

select gen_random_uuid() as expired_id \gset
select public.claim_official_import_run_attempt(:'expired_id', 'event.kabuki-bito.schedule', 'old-owner', 300) as claimed \gset
select set_config('stage_tracker.official_import_attempt_run_id', :'expired_id', true) as scope \gset
select set_config('stage_tracker.official_import_attempt_token', 'old-owner', true) as scope \gset
update public.official_import_runs set active_attempt_lease_expires_at = clock_timestamp() - interval '1 second' where id = :'expired_id';
select is(public.fail_official_import_run_attempt(:'expired_id', 'event.kabuki-bito.schedule', 'old-owner', 'validation', 'planning', 'validation', ''), 'not_owner', 'expired owner rejected unchanged');
select is(public.claim_official_import_run_attempt(:'expired_id', 'event.kabuki-bito.schedule', 'new-owner', 300), 'claimed', 'superseding owner takes existing lease');
select is(public.fail_official_import_run_attempt(:'expired_id', 'event.kabuki-bito.schedule', 'old-owner', 'validation', 'planning', 'validation', ''), 'not_owner', 'superseded attempt cannot fail run');
select ok((select status = 'running' and failure_phase is null and active_attempt_token = 'new-owner' from public.official_import_runs where id = :'expired_id'), 'superseded call changes neither status owner nor clue');
select public.release_official_import_run_attempt(:'expired_id', 'event.kabuki-bito.schedule', 'new-owner') as released \gset
select lives_ok(format('delete from public.official_import_runs where id = %L', :'expired_id'), 'released empty-run cleanup unchanged');
select throws_ok($$insert into public.official_import_runs(source_id, failure_phase, failure_reason) values ('event.kabuki-bito.schedule', 'planning', 'validation')$$, '23514', null, 'initial runs cannot carry clues');
select gen_random_uuid() as unclaimed_id \gset
insert into public.official_import_runs(id, source_id) values (:'unclaimed_id', 'event.kabuki-bito.schedule');
select throws_ok(format($$update public.official_import_runs set status='failed', finished_at=clock_timestamp(), failure_classification='validation', failure_phase='planning', failure_reason='validation' where id=%L$$, :'unclaimed_id'), '23514', null, 'unclaimed direct failure cannot add clues');
select is((select count(*) from public.official_import_candidates where run_id in (:'old_id', :'clue_id', :'boundary_id')), 0::bigint, 'terminal clues create no candidates');
select gen_random_uuid() as completed_id \gset
select public.claim_official_import_run_attempt(:'completed_id', 'event.kabuki-bito.schedule', 'owner', 300) as claimed \gset
select public.commit_owned_official_import_candidate_batch(:'completed_id', 'event.kabuki-bito.schedule', 'owner', '[]'::jsonb) as committed \gset
select is(public.fail_official_import_run_attempt(:'completed_id', 'event.kabuki-bito.schedule', 'late-owner', 'validation', 'planning', 'validation', ''), 'completed', 'late failure call preserves completed status');
select ok((select failure_phase is null and failure_reason is null and failure_url is null from public.official_import_runs where id=:'completed_id'), 'completed run keeps all clues NULL');

reset role;
call pg_temp.auth_as_user(:'creator_id');
select is((select failure_reason from public.official_import_runs where id = :'clue_id'), 'request_limit', 'creator can read terminal clue');
call pg_temp.auth_as_user(:'other_id');
select is((select count(*) from public.official_import_runs where id = :'clue_id'), 0::bigint, 'ordinary user cannot read clue');
reset role;
set local role anon;
select throws_ok('select failure_phase from public.official_import_runs', '42501', null, 'anonymous clue reads denied');
reset role;

-- Delay the authoritative UPDATE on the server AFTER its original ownership
-- check. Both signatures retain the row lock and commit the same failure even
-- when that delay crosses lease expiry. This is not a client-abort proof.
create function pg_temp.delay_test_terminal_update() returns trigger language plpgsql as $$
begin
  if current_setting('stage_tracker.test_terminal_delay', true) = 'on' and new.status = 'failed' then
    perform pg_sleep(1.1);
  end if;
  return new;
end;
$$;
create trigger aaa_terminal_clue_test_delay before update on public.official_import_runs for each row execute function pg_temp.delay_test_terminal_update();
set local role service_role;
select gen_random_uuid() as delayed_old_id \gset
select public.claim_official_import_run_attempt(:'delayed_old_id', 'event.kabuki-bito.schedule', 'owner', 300) as claimed \gset
select set_config('stage_tracker.official_import_attempt_run_id', :'delayed_old_id', true) as scope \gset
select set_config('stage_tracker.official_import_attempt_token', 'owner', true) as scope \gset
update public.official_import_runs set active_attempt_lease_expires_at=clock_timestamp()+interval '1 second' where id=:'delayed_old_id';
select set_config('stage_tracker.test_terminal_delay', 'on', true) as delay \gset
select is(public.fail_official_import_run_attempt(:'delayed_old_id', 'event.kabuki-bito.schedule', 'owner', 'validation'), 'failed', 'old authoritative UPDATE tolerates server delay after ownership gate');
select gen_random_uuid() as delayed_new_id \gset
select public.claim_official_import_run_attempt(:'delayed_new_id', 'event.kabuki-bito.schedule', 'owner', 300) as claimed \gset
select set_config('stage_tracker.official_import_attempt_run_id', :'delayed_new_id', true) as scope \gset
select set_config('stage_tracker.official_import_attempt_token', 'owner', true) as scope \gset
update public.official_import_runs set active_attempt_lease_expires_at=clock_timestamp()+interval '1 second' where id=:'delayed_new_id';
select is(public.fail_official_import_run_attempt(:'delayed_new_id', 'event.kabuki-bito.schedule', 'owner', 'validation', 'planning', 'validation', ''), 'failed', 'new same UPDATE preserves failure across identical server delay');
select is((select failure_classification from public.official_import_runs where id=:'delayed_new_id'), (select failure_classification from public.official_import_runs where id=:'delayed_old_id'), 'server-late classification equals old signature');
select ok((select active_attempt_token is null and failure_phase='planning' from public.official_import_runs where id=:'delayed_new_id'), 'server-late failure clears ownership and retains bounded clue');
reset role;

select * from finish();
rollback;
