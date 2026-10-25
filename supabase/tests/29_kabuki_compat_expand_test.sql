-- Issue #780 freshness/recovery activation on the existing atomic Kabuki path.
-- Old unowned publication and split reviewed write/completion fail closed.
\ir helpers/auth.psql
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers/kabuki-compat-expand.psql
select plan(78);
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='apply_official_import_kabuki_event_candidate'),1::bigint,'atomic RPC has exactly one public signature');
select is((select pronargs::integer from pg_proc where oid='public.apply_official_import_kabuki_event_candidate(uuid,text,text,uuid,uuid,text,text,date,date,jsonb,jsonb,text,text,text,boolean,text,boolean,jsonb,jsonb,jsonb)'::regprocedure),20,'atomic RPC requires twenty arguments');
select is((select pronargdefaults::integer from pg_proc where oid='public.apply_official_import_kabuki_event_candidate(uuid,text,text,uuid,uuid,text,text,date,date,jsonb,jsonb,text,text,text,boolean,text,boolean,jsonb,jsonb,jsonb)'::regprocedure),0,'atomic RPC has no argument defaults');
select ok((select not prosecdef from pg_proc where oid='public.apply_official_import_kabuki_event_candidate(uuid,text,text,uuid,uuid,text,text,date,date,jsonb,jsonb,text,text,text,boolean,text,boolean,jsonb,jsonb,jsonb)'::regprocedure),'atomic RPC uses SECURITY INVOKER');
select ok((select 'search_path=""'=any(proconfig) from pg_proc where oid='public.apply_official_import_kabuki_event_candidate(uuid,text,text,uuid,uuid,text,text,date,date,jsonb,jsonb,text,text,text,boolean,text,boolean,jsonb,jsonb,jsonb)'::regprocedure),'atomic RPC has an empty search_path');
select ok(has_function_privilege('service_role','public.apply_official_import_kabuki_event_candidate(uuid,text,text,uuid,uuid,text,text,date,date,jsonb,jsonb,text,text,text,boolean,text,boolean,jsonb,jsonb,jsonb)','EXECUTE'),'service role can execute atomic RPC');
select ok(not has_function_privilege('authenticated','public.apply_official_import_kabuki_event_candidate(uuid,text,text,uuid,uuid,text,text,date,date,jsonb,jsonb,text,text,text,boolean,text,boolean,jsonb,jsonb,jsonb)','EXECUTE'),'authenticated role has no atomic RPC execution grant');
select ok(not has_function_privilege('anon','public.apply_official_import_kabuki_event_candidate(uuid,text,text,uuid,uuid,text,text,date,date,jsonb,jsonb,text,text,text,boolean,text,boolean,jsonb,jsonb,jsonb)','EXECUTE'),'anonymous role has no atomic RPC execution grant');
select pg_temp.create_test_user() as creator \gset
select pg_temp.create_test_user() as other_creator \gset
insert into public.catalog_creators(user_id) values(:'creator'),(:'other_creator');
select set_config('stage_tracker.test_creator',:'creator',true) as fixture_creator \gset
set local role service_role;

-- Real create and inert replay, including all catalog/staging rows.
select pg_temp.kb_publish(pg_temp.kb_payload('9101')) as create_run \gset
select pg_temp.kb_candidate(:'create_run') as create_candidate \gset
select ok((select publication_ordinal > 0 from public.official_import_runs where id=:'create_run'),'owned Kabuki publication assigns a positive ordinal');
call pg_temp.kb_ready(:'create_candidate',:'creator','create-owner');
select is(pg_temp.kb_apply(:'create_candidate','create-owner',:'creator'),'applied','owned ordinal-approved candidate can create atomically');
select id as target_event from public.events where source_key='kabuki-bito:kabukiza:play:9101' \gset
select is((select title from public.events where id=:'target_event'),'Fixture','actual create realizes reviewed title');
select ok((select apply_status='applied' and applied_at is not null and active_apply_attempt_token is null from public.official_import_candidates where id=:'create_candidate'),'actual create completes candidate');
select pg_temp.kb_all_rows()::text as replay_before \gset
select is(pg_temp.kb_apply(:'create_candidate','late-response',:'other_creator'),'applied','applied-state replay within transaction returns applied before inactive argument checks');
select is(pg_temp.kb_all_rows()::text,:'replay_before','applied-state replay within transaction leaves every captured row unchanged');

-- A completed owned replay returns the retained candidate count without
-- allocating another ordinal or changing the run.
-- Sequence state is a test-owner observation; service_role needs only the
-- production sequence privileges. Restore service_role before every operation.
reset role;
select last_value::text || ':' || is_called::text as replay_sequence_before from public.official_import_kabuki_publication_ordinal_seq \gset
set local role service_role;
select is(public.commit_owned_official_import_candidate_batch(
  :'create_run','event.kabuki-bito.schedule','fixture-publish','[]'::jsonb),1,
  'completed owned replay returns retained candidate count');
reset role;
select is((select last_value::text || ':' || is_called::text
  from public.official_import_kabuki_publication_ordinal_seq),:'replay_sequence_before',
  'completed owned replay does not allocate another ordinal');
set local role service_role;
select is(public.commit_owned_official_import_candidate_batch(
  :'create_run','event.kabuki-bito.schedule','fixture-publish',null::jsonb),1,
  'completed owned replay with NULL payload returns retained candidate count');
reset role;
select is((select last_value::text || ':' || is_called::text
  from public.official_import_kabuki_publication_ordinal_seq),:'replay_sequence_before',
  'completed owned replay with NULL payload does not allocate an ordinal');
set local role service_role;
select is(public.commit_owned_official_import_candidate_batch(
  :'create_run','event.kabuki-bito.schedule','fixture-publish','{}'::jsonb),1,
  'completed owned replay with non-array payload returns retained candidate count');
reset role;
select is((select last_value::text || ':' || is_called::text
  from public.official_import_kabuki_publication_ordinal_seq),:'replay_sequence_before',
  'completed owned replay with non-array payload does not allocate an ordinal');
set local role service_role;

-- Empty and held-only owned publications still receive authority atomically.
select gen_random_uuid() as empty_publication_run \gset
select public.claim_official_import_run_attempt(
  :'empty_publication_run','event.kabuki-bito.schedule','empty-publication',300);
select is(public.commit_owned_official_import_candidate_batch(
  :'empty_publication_run','event.kabuki-bito.schedule','empty-publication','[]'::jsonb),0,
  'empty owned publication completes with zero candidates');
select ok((select status='completed' and publication_ordinal > 0
  from public.official_import_runs where id=:'empty_publication_run'),
  'empty owned publication receives an ordinal');

select gen_random_uuid() as held_only_publication_run \gset
select public.claim_official_import_run_attempt(
  :'held_only_publication_run','event.kabuki-bito.schedule','held-only-publication',300);
select is(public.commit_owned_official_import_partial_batch(
  :'held_only_publication_run','event.kabuki-bito.schedule','held-only-publication','[]'::jsonb,
  '[{"canonical_url":"https://www.kabuki-bito.jp/theaters/kabukiza/play/9111",
     "official_external_id":"9111","title":"Held only","starts_on":"2027-01-01",
     "ends_on":"2027-01-02","reason_code":"source_parse"}]'::jsonb),0,
  'held-only partial publication completes with zero candidates');
select ok((select status='completed' and publication_ordinal > 0
  from public.official_import_runs where id=:'held_only_publication_run'),
  'held-only partial publication receives an ordinal');
select is((select count(*) from public.official_import_held_pages
  where run_id=:'held_only_publication_run'),1::bigint,
  'held-only evidence commits with its ordinal');

-- Same and reverse started_at values do not define publication authority.
select gen_random_uuid() as ordinal_same_first \gset
select gen_random_uuid() as ordinal_same_second \gset
select gen_random_uuid() as ordinal_reverse_third \gset
insert into public.official_import_runs(id,source_id,status,started_at) values
  (:'ordinal_same_first','event.kabuki-bito.schedule','running','2030-01-01T00:00:00Z'),
  (:'ordinal_same_second','event.kabuki-bito.schedule','running','2030-01-01T00:00:00Z'),
  (:'ordinal_reverse_third','event.kabuki-bito.schedule','running','2020-01-01T00:00:00Z');
select public.claim_official_import_run_attempt(:'ordinal_same_first','event.kabuki-bito.schedule','ordinal-first',300);
select public.commit_owned_official_import_candidate_batch(:'ordinal_same_first','event.kabuki-bito.schedule','ordinal-first','[]'::jsonb);
select public.claim_official_import_run_attempt(:'ordinal_same_second','event.kabuki-bito.schedule','ordinal-second',300);
select public.commit_owned_official_import_candidate_batch(:'ordinal_same_second','event.kabuki-bito.schedule','ordinal-second','[]'::jsonb);
select public.claim_official_import_run_attempt(:'ordinal_reverse_third','event.kabuki-bito.schedule','ordinal-third',300);
select public.commit_owned_official_import_candidate_batch(:'ordinal_reverse_third','event.kabuki-bito.schedule','ordinal-third','[]'::jsonb);
select ok((select first.started_at=second.started_at
  and second.started_at>third.started_at
  and first.publication_ordinal<second.publication_ordinal
  and second.publication_ordinal<third.publication_ordinal
  from public.official_import_runs first
  join public.official_import_runs second on second.id=:'ordinal_same_second'
  join public.official_import_runs third on third.id=:'ordinal_reverse_third'
  where first.id=:'ordinal_same_first'),
  'ordinals follow serialized publication order despite same and reversed timestamps');

-- Invalid source, token, and expired lease are rejected before sequence use.
select gen_random_uuid() as ordinal_rejected_run \gset
select public.claim_official_import_run_attempt(
  :'ordinal_rejected_run','event.kabuki-bito.schedule','ordinal-valid-owner',300);
reset role;
select last_value::text || ':' || is_called::text as rejected_sequence_before from public.official_import_kabuki_publication_ordinal_seq \gset
set local role service_role;
select format('select public.commit_owned_official_import_candidate_batch(%L::uuid,%L,%L,%L::jsonb)',
  :'ordinal_rejected_run','event.other','ordinal-valid-owner','[]') as wrong_source_sql \gset
select throws_ok(:'wrong_source_sql','22023',null,
  'owned publisher refuses a source mismatch before allocating an ordinal');
select format('select public.commit_owned_official_import_candidate_batch(%L::uuid,%L,%L,%L::jsonb)',
  :'ordinal_rejected_run','event.kabuki-bito.schedule','wrong-owner','[]') as wrong_owner_sql \gset
select throws_ok(:'wrong_owner_sql','55000',null,
  'owned publisher refuses a displaced token before allocating an ordinal');
select format('select public.commit_owned_official_import_candidate_batch(%L::uuid,%L,%L,NULL::jsonb)',
  :'ordinal_rejected_run','event.kabuki-bito.schedule','ordinal-valid-owner') as invalid_payload_sql \gset
select throws_ok(:'invalid_payload_sql','22023',null,
  'owned publisher refuses a NULL running payload before allocating an ordinal');
reset role;
select is((select last_value::text || ':' || is_called::text
  from public.official_import_kabuki_publication_ordinal_seq),:'rejected_sequence_before',
  'invalid running payload does not consume an ordinal');
set local role service_role;
select set_config('stage_tracker.official_import_attempt_run_id',:'ordinal_rejected_run',true);
select set_config('stage_tracker.official_import_attempt_token','ordinal-valid-owner',true);
update public.official_import_runs
set active_attempt_lease_expires_at=clock_timestamp()-interval '1 second'
where id=:'ordinal_rejected_run';
select set_config('stage_tracker.official_import_attempt_token','',true);
select set_config('stage_tracker.official_import_attempt_run_id','',true);
select format('select public.commit_owned_official_import_candidate_batch(%L::uuid,%L,%L,%L::jsonb)',
  :'ordinal_rejected_run','event.kabuki-bito.schedule','ordinal-valid-owner','[]') as expired_owner_sql \gset
select throws_ok(:'expired_owner_sql','55000',null,
  'owned publisher refuses an expired lease before allocating an ordinal');
reset role;
select is((select last_value::text || ':' || is_called::text
  from public.official_import_kabuki_publication_ordinal_seq),:'rejected_sequence_before',
  'source, token, and expiry refusals leave the ordinal sequence unchanged');
set local role service_role;

-- Attempt lifecycle transitions (including same-token lease renewal) never
-- allocate publication order.
select gen_random_uuid() as release_without_ordinal_run \gset
select gen_random_uuid() as failure_without_ordinal_run \gset
reset role;
select last_value::text || ':' || is_called::text as lifecycle_sequence_before from public.official_import_kabuki_publication_ordinal_seq \gset
set local role service_role;
select public.claim_official_import_run_attempt(
  :'release_without_ordinal_run','event.kabuki-bito.schedule','release-owner',300);
select public.claim_official_import_run_attempt(
  :'release_without_ordinal_run','event.kabuki-bito.schedule','release-owner',300);
select public.release_official_import_run_attempt(
  :'release_without_ordinal_run','event.kabuki-bito.schedule','release-owner');
select public.claim_official_import_run_attempt(
  :'failure_without_ordinal_run','event.kabuki-bito.schedule','failure-owner',300);
select public.fail_official_import_run_attempt(
  :'failure_without_ordinal_run','event.kabuki-bito.schedule','failure-owner',
  'validation','planning','fixture failure','');
select ok((select released.status='running' and released.active_attempt_token is null
    and released.publication_ordinal is null and failed.status='failed'
    and failed.publication_ordinal is null
  from public.official_import_runs released, public.official_import_runs failed
  where released.id=:'release_without_ordinal_run'
    and failed.id=:'failure_without_ordinal_run'),
  'claim renewal, release, and failure preserve NULL publication authority');
reset role;
select is((select last_value::text || ':' || is_called::text
  from public.official_import_kabuki_publication_ordinal_seq),:'lifecycle_sequence_before',
  'claim renewal, release, and failure do not allocate an ordinal');
set local role service_role;

-- A late completion error rolls back candidates, held evidence, and the run
-- ordinal together. nextval gaps are intentionally allowed.
reset role;
create function pg_temp.kb_reject_ordinal_completion() returns trigger language plpgsql as $$
begin
  if new.publication_ordinal is not null
    and current_setting('stage_tracker.test_fail_publication',true)='on' then
    raise exception 'synthetic ordinal completion failure' using errcode='55000';
  end if;
  return new;
end;
$$;
create trigger zzz_kb_reject_ordinal_completion before update
on public.official_import_runs for each row
execute function pg_temp.kb_reject_ordinal_completion();
set local role service_role;
select gen_random_uuid() as ordinal_rollback_candidate_run \gset
select gen_random_uuid() as ordinal_rollback_held_run \gset
select public.claim_official_import_run_attempt(
  :'ordinal_rollback_candidate_run','event.kabuki-bito.schedule','rollback-candidate',300);
reset role;
select last_value::text || ':' || is_called::text as rollback_sequence_before from public.official_import_kabuki_publication_ordinal_seq \gset
set local role service_role;
select set_config('stage_tracker.test_fail_publication','on',true);
select format('select public.commit_owned_official_import_candidate_batch(%L::uuid,%L,%L,%L::jsonb)',
  :'ordinal_rollback_candidate_run','event.kabuki-bito.schedule','rollback-candidate',
  pg_temp.kb_payload('9112')::text) as candidate_rollback_sql \gset
select throws_ok(:'candidate_rollback_sql','55000','synthetic ordinal completion failure',
  'late completion error aborts candidate publication');
select public.release_official_import_run_attempt(
  :'ordinal_rollback_candidate_run','event.kabuki-bito.schedule','rollback-candidate');
select public.claim_official_import_run_attempt(
  :'ordinal_rollback_held_run','event.kabuki-bito.schedule','rollback-held',300);
select format('select public.commit_owned_official_import_partial_batch(%L::uuid,%L,%L,%L::jsonb,%L::jsonb)',
  :'ordinal_rollback_held_run','event.kabuki-bito.schedule','rollback-held',pg_temp.kb_payload('9113')::text,
  '[{"canonical_url":"https://www.kabuki-bito.jp/theaters/kabukiza/play/9114","official_external_id":"9114","title":"Rollback held","starts_on":"2027-01-01","ends_on":"2027-01-02","reason_code":"source_parse"}]') as held_rollback_sql \gset
select throws_ok(:'held_rollback_sql','55000','synthetic ordinal completion failure',
  'late completion error aborts candidate and held publication');
select public.release_official_import_run_attempt(
  :'ordinal_rollback_held_run','event.kabuki-bito.schedule','rollback-held');
select ok((select candidate_run.status='running'
    and candidate_run.publication_ordinal is null
    and (select count(*) from public.official_import_candidates where run_id=candidate_run.id)=0
    and held_run.status='running'
    and held_run.publication_ordinal is null
    and (select count(*) from public.official_import_held_pages where run_id=held_run.id)=0
  from public.official_import_runs candidate_run
  cross join public.official_import_runs held_run
  where candidate_run.id=:'ordinal_rollback_candidate_run'
    and held_run.id=:'ordinal_rollback_held_run'),
  'late errors roll back candidate, held-page, and ordinal rows');
reset role;
select ok((select last_value > split_part(:'rollback_sequence_before',':',1)::bigint
  from public.official_import_kabuki_publication_ordinal_seq),
  'rolled-back publications may leave sequence gaps');
set local role service_role;
select set_config('stage_tracker.test_fail_publication','off',true);

-- A service-role update cannot fabricate a publication context or backfill a
-- completed NULL row.
select gen_random_uuid() as ordinal_guard_run \gset
insert into public.official_import_runs(id,source_id,status)
values(:'ordinal_guard_run','event.kabuki-bito.schedule','running');
select set_config('stage_tracker.official_import_publication_ordinal','424242',true);
select format('update public.official_import_runs set status=%L,finished_at=clock_timestamp(),publication_ordinal=424242 where id=%L::uuid',
  'completed',:'ordinal_guard_run') as unauthorized_ordinal_sql \gset
select throws_ok(:'unauthorized_ordinal_sql','23514',null,
  'run guard rejects ordinal without owned publication scope');
select set_config('stage_tracker.official_import_publication_ordinal','',true);
select ok((select status='running' and publication_ordinal is null
  from public.official_import_runs where id=:'ordinal_guard_run'),
  'rejected ordinal assignment leaves the run unchanged');

-- Mutating update: title, existing child correction, new child, Genre and Group.
insert into public.event_occurrences(event_id,starts_at) values(:'target_event','2027-01-01T04:00:00Z') returning id as old_child \gset
select '[{"startsAt":"2027-01-01T04:00:00Z","endsAt":"2027-01-01T06:00:00Z","doorsAt":"2027-01-01T03:30:00Z"},{"startsAt":"2027-01-02T04:00:00Z","endsAt":"2027-01-02T06:00:00Z","doorsAt":null}]'::jsonb as clocks \gset
select '[{"key":"compat-expand-group","displayName":"Compatibility group"}]'::jsonb as facets \gset
select jsonb_set(pg_temp.kb_payload('9101',repeat('b',64),'update','update',true,:'target_event','pending','matched'),'{0,proposal}',
  (pg_temp.kb_payload('9101')->0->'proposal') || jsonb_build_object('title','Updated','occurrences',:'clocks'::jsonb,'genre','kabuki','groups',:'facets'::jsonb)) as update_payload \gset
select pg_temp.kb_publish(:'update_payload') as update_run \gset
select pg_temp.kb_candidate(:'update_run') as update_candidate \gset
call pg_temp.kb_ready(:'update_candidate',:'creator','update-owner');
select jsonb_build_object('occurrences',jsonb_build_array(:'clocks'::jsonb->1),'fixes',jsonb_build_array(jsonb_build_object('id',:'old_child','endsAt','2027-01-01T06:00:00Z','doorsAt','2027-01-01T03:30:00Z'))) as changes \gset
select is(pg_temp.kb_apply(:'update_candidate','update-owner',:'creator',:'changes'),'applied','mutating update commits with child and facet changes');
select is((select title from public.events where id=:'target_event'),'Updated','mutating update changes title');
select ok((select ends_at='2027-01-01T06:00:00Z' and doors_at='2027-01-01T03:30:00Z' from public.event_occurrences where id=:'old_child'),'mutating update corrects existing child');
select is((select count(*) from public.event_occurrences where event_id=:'target_event'),2::bigint,'mutating update adds reviewed child');
select is((select g.key from public.events e join public.genres g on g.id=e.genre_id where e.id=:'target_event'),'kabuki','mutating update sets reviewed Genre');
select is((select g.display_name from public.groups g join public.event_groups eg on eg.group_id=g.id where eg.event_id=:'target_event'),'Compatibility group','mutating update adds reviewed Group');

-- Positive convergence can use unchanged action without touching catalog rows.
select pg_temp.kb_publish(pg_temp.kb_payload('9102')) as unchanged_run \gset
select pg_temp.kb_candidate(:'unchanged_run') as unchanged_candidate \gset
call pg_temp.kb_ready(:'unchanged_candidate',:'creator','unchanged-owner');
insert into public.events(owner_id,title,venue,source_key,source_url,starts_on,ends_on)
values(:'creator','Fixture','Hall','kabuki-bito:kabukiza:play:9102','https://www.kabuki-bito.jp/theaters/kabukiza/play/9102','2027-01-01','2027-01-02') returning id as unchanged_event \gset
select pg_temp.kb_snapshot(:'unchanged_event')::text as unchanged_before \gset
select is(pg_temp.kb_apply(:'unchanged_candidate','unchanged-owner',:'creator',jsonb_build_object('action','unchanged','event',:'unchanged_event')),'applied','positively converged unchanged application completes');
select is(pg_temp.kb_snapshot(:'unchanged_event')::text,:'unchanged_before','unchanged action preserves full catalog snapshot');

-- Refusals preserve facts. Fixtures use only existing approval/ownership RPCs.
select pg_temp.kb_publish(pg_temp.kb_payload('9103')) as refusal_run \gset
select pg_temp.kb_candidate(:'refusal_run') as refusal_candidate \gset
select throws_ok(pg_temp.kb_apply_sql(:'refusal_candidate','refusal-owner',:'creator'),'55000',null,'pending candidate cannot use atomic entry point');
call pg_temp.kb_ready(:'refusal_candidate',:'creator','refusal-owner');
select pg_temp.kb_all_rows()::text as refusals_before \gset
select throws_ok(pg_temp.kb_apply_sql(:'refusal_candidate','wrong-owner',:'creator'),'55000',null,'wrong attempt token is refused');
select throws_ok(pg_temp.kb_apply_sql(:'refusal_candidate','refusal-owner',:'other_creator'),'22023',null,'wrong reviewer is refused');
select throws_ok(pg_temp.kb_apply_sql(:'refusal_candidate','refusal-owner',:'creator','{"sourceKey":"kabuki-bito:kabukiza:play:9999"}'),'22023',null,'different source identity is refused');
select throws_ok(pg_temp.kb_apply_sql(:'refusal_candidate','refusal-owner',:'creator',jsonb_build_object('event',:'target_event','action','unchanged')),'22023',null,'different existing target is refused');
select throws_ok(pg_temp.kb_apply_sql(:'refusal_candidate','refusal-owner',:'creator','{"title":"Unreviewed title"}'),'22023',null,'different proposal facts are refused');
select is(pg_temp.kb_all_rows()::text,:'refusals_before','argument refusals leave all captured rows unchanged');
select pg_temp.kb_apply_sql(:'refusal_candidate','refusal-owner',:'creator') as refused_sql \gset
call pg_temp.auth_as_user(:'creator');
select throws_ok(:'refused_sql','42501',null,'authenticated creator cannot call service-only atomic RPC');
call pg_temp.auth_as_anon();
select throws_ok(:'refused_sql','42501',null,'anonymous role cannot call atomic RPC');
call pg_temp.auth_as_admin();
set local role service_role;
select set_config('stage_tracker.official_import_apply_candidate_id',:'refusal_candidate',true) as scope \gset
select set_config('stage_tracker.official_import_apply_attempt_token','refusal-owner',true) as scope \gset
update public.official_import_candidates set active_apply_lease_expires_at=clock_timestamp()-interval '1 second' where id=:'refusal_candidate';
select set_config('stage_tracker.official_import_apply_candidate_id','',true) as scope \gset
select set_config('stage_tracker.official_import_apply_attempt_token','',true) as scope \gset
select pg_temp.kb_all_rows()::text as expired_before \gset
select throws_ok(:'refused_sql','55000',null,'expired active apply lease is refused');
select is(pg_temp.kb_all_rows()::text,:'expired_before','lease refusal leaves all captured rows unchanged');

-- Out-of-scope source is an entry-point validation, not global route closure.
select gen_random_uuid() as other_run \gset
select public.claim_official_import_run_attempt(:'other_run','event.compat-other','other-publish',300) as claimed \gset
reset role;
select last_value::text || ':' || is_called::text as other_source_sequence_before from public.official_import_kabuki_publication_ordinal_seq \gset
set local role service_role;
select public.commit_owned_official_import_candidate_batch(:'other_run','event.compat-other','other-publish',pg_temp.kb_payload('9104')) as staged \gset
select pg_temp.kb_candidate(:'other_run') as other_candidate \gset
select ok((select publication_ordinal is null from public.official_import_runs where id=:'other_run'),'other-source publisher leaves the Kabuki ordinal NULL');
reset role;
select is((select last_value::text || ':' || is_called::text
  from public.official_import_kabuki_publication_ordinal_seq),:'other_source_sequence_before',
  'other-source publisher does not consume a Kabuki ordinal');
set local role service_role;
select throws_ok(pg_temp.kb_apply_sql(:'other_candidate','unused',:'creator'),'22023',null,'different candidate source is outside new RPC scope');

-- Omitted facets preserve known classification; setter flags cannot invent clears.
select pg_temp.kb_publish(pg_temp.kb_payload('9101',repeat('d',64),'omitted-facets','update',true,:'target_event','pending','matched')) as omitted_run \gset
select pg_temp.kb_candidate(:'omitted_run') as omitted_candidate \gset
call pg_temp.kb_ready(:'omitted_candidate',:'creator','omitted-owner');
select pg_temp.kb_all_rows()::text as omitted_before \gset
select throws_ok(pg_temp.kb_apply_sql(:'omitted_candidate','omitted-owner',:'creator','{"setGenre":true,"genre":null}'),'22023',null,'omitted reviewed Genre cannot be cleared by a setter flag');
select throws_ok(pg_temp.kb_apply_sql(:'omitted_candidate','omitted-owner',:'creator','{"setGroups":true,"groups":[]}'),'22023',null,'omitted reviewed Groups cannot be cleared by a setter flag');
select is(pg_temp.kb_all_rows()::text,:'omitted_before','omitted facet refusals preserve all catalog and staging rows');
select is(pg_temp.kb_apply(:'omitted_candidate','omitted-owner',:'creator'),'applied','omitted facets apply normally with false setter flags');
select is((select g.key from public.events e join public.genres g on g.id=e.genre_id where e.id=:'target_event'),'kabuki','omitted Genre preserves existing classification');
select is((select g.display_name from public.groups g join public.event_groups eg on eg.group_id=g.id where eg.event_id=:'target_event'),'Compatibility group','omitted Groups preserve existing classification');

-- A test-only completion trigger first observes changed catalog facts, then
-- throws. P0001 instead of55000 would expose a failure before the real writes.
select jsonb_set(pg_temp.kb_payload('9101',repeat('c',64),'late-update','update',true,:'target_event','pending','matched'),'{0,proposal}',
  (:'update_payload'::jsonb->0->'proposal') || jsonb_build_object('title','Late update','occurrences',jsonb_build_array(:'clocks'::jsonb->0,(:'clocks'::jsonb->1),jsonb_build_object('startsAt','2027-01-02T08:00:00Z','endsAt',null,'doorsAt',null)),
    'groups',jsonb_build_array(jsonb_build_object('key','compat-expand-group','displayName','Late canonical label')))) as late_payload \gset
select pg_temp.kb_publish(:'late_payload') as late_run \gset
select pg_temp.kb_candidate(:'late_run') as late_candidate \gset
call pg_temp.kb_ready(:'late_candidate',:'creator','late-owner');
reset role;
create function pg_temp.kb_reject_late_completion() returns trigger language plpgsql as $$
begin
  if new.apply_status='applied' and current_setting('stage_tracker.test_late_failure',true)='on' then
    if not exists(select 1 from public.events e join public.genres g on g.id=e.genre_id
      where e.source_key='kabuki-bito:kabukiza:play:9101' and e.title='Late update' and g.key='kabuki'
        and (select count(*) from public.event_occurrences o where o.event_id=e.id)=3
        and exists(select 1 from public.event_groups eg join public.groups gr on gr.id=eg.group_id
          where eg.event_id=e.id and gr.key='compat-expand-group' and gr.display_name='Late canonical label')) then
      raise exception 'completion test did not observe catalog mutations' using errcode='P0001';
    end if;
    raise exception 'synthetic late completion failure' using errcode='55000';
  end if;
  return new;
end;
$$;
create trigger aaa_compat_late_completion before update on public.official_import_candidates
for each row execute function pg_temp.kb_reject_late_completion();
set local role service_role;
select pg_temp.kb_all_rows()::text as rollback_before \gset
select set_config('stage_tracker.test_late_failure','on',true) as late_failure \gset
select throws_ok(pg_temp.kb_apply_sql(:'late_candidate','late-owner',:'creator',jsonb_build_object('occurrences',jsonb_build_array(:'late_payload'::jsonb->0->'proposal'->'occurrences'->2))),'55000','synthetic late completion failure','completion failure is injected after title child and facet writes');
select is(pg_temp.kb_all_rows()::text,:'rollback_before','late completion failure rolls back every catalog and staging row');
select set_config('stage_tracker.test_late_failure','off',true) as late_failure \gset

-- The old split reviewed write cannot bypass atomic freshness and completion.
select pg_temp.kb_publish(pg_temp.kb_payload('9105')) as split_run \gset
select pg_temp.kb_candidate(:'split_run') as split_candidate \gset
call pg_temp.kb_ready(:'split_candidate',:'creator','split-owner');
select throws_ok($sql$select public.apply_reviewed_import_event_plan(
  'create',current_setting('stage_tracker.test_creator')::uuid,null,'kabuki-bito:kabukiza:play:9105','Fixture',
  '2027-01-01','2027-01-02','[]','[]','Hall','https://www.kabuki-bito.jp/theaters/kabukiza/play/9105',null,
  false,null,false,'[]',null,'[]')$sql$,'55000',null,'old reviewed Kabuki write requires candidate atomic context');
select throws_ok(format('select public.complete_official_import_candidate_apply(%L::uuid,%L)',
  :'split_candidate','split-owner'),'23514',null,'standalone Kabuki completion is refused');
select is((select count(*) from public.events where source_key='kabuki-bito:kabukiza:play:9105'),0::bigint,'old split route leaves the catalog unchanged');

-- The old unowned Kabuki publisher cannot mint a fresh publication ordinal.
select gen_random_uuid() as unowned_run \gset
insert into public.official_import_runs(id,source_id,status,started_at) values(:'unowned_run','event.kabuki-bito.schedule','running',clock_timestamp());
reset role;
select last_value::text || ':' || is_called::text as unowned_sequence_before from public.official_import_kabuki_publication_ordinal_seq \gset
set local role service_role;
select throws_ok(format('select public.commit_official_import_candidate_batch(%L::uuid,%L,%L::jsonb)',
  :'unowned_run','event.kabuki-bito.schedule',pg_temp.kb_payload('9106')::text),
  '55000',null,'unowned Kabuki publisher is refused');
select ok((select status='running' and publication_ordinal is null
    and (select count(*) from public.official_import_candidates where run_id=:'unowned_run')=0
  from public.official_import_runs where id=:'unowned_run'),
  'refused unowned publication leaves the run and candidates unchanged');
select throws_ok(format('update public.official_import_runs set status=%L,finished_at=clock_timestamp(),publication_ordinal=1 where id=%L::uuid',
  'completed',:'unowned_run'),'23514',null,'unowned publisher cannot backfill completion authority');
select ok((select status='running' and publication_ordinal is null
  from public.official_import_runs where id=:'unowned_run'),
  'backfill refusal preserves the unclaimed run');
reset role;
select is((select last_value::text || ':' || is_called::text
  from public.official_import_kabuki_publication_ordinal_seq),:'unowned_sequence_before',
  'unowned refusal does not consume a publication ordinal');
set local role service_role;

select * from finish();
rollback;
