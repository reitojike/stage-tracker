-- Issue #780: serialized freshness, unresolved recovery episodes, and legacy NULL authority.
\ir helpers/auth.psql
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers/kabuki-compat-expand.psql

create function pg_temp.kb_hold(p_id text, p_url text default null) returns uuid
language plpgsql as $$
declare
  v_run_id uuid := gen_random_uuid();
  v_token text := 'hold-' || p_id || '-' || gen_random_uuid()::text;
begin
  if public.claim_official_import_run_attempt(
    v_run_id, 'event.kabuki-bito.schedule', v_token, 300
  ) <> 'claimed' then
    raise exception 'fixture held-run claim failed';
  end if;
  perform public.commit_owned_official_import_partial_batch(
    v_run_id,
    'event.kabuki-bito.schedule',
    v_token,
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'canonical_url', coalesce(p_url, 'https://www.kabuki-bito.jp/theaters/kabukiza/play/' || p_id),
      'official_external_id', p_id,
      'title', 'Held fixture',
      'starts_on', '2027-01-01',
      'ends_on', '2027-01-02',
      'reason_code', 'source_parse'
    ))
  );
  return v_run_id;
end;
$$;

create function pg_temp.kb_error(p_sql text) returns text
language plpgsql as $$
declare
  v_state text;
  v_detail text;
begin
  execute p_sql;
  return 'unexpected success';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
  return coalesce(v_state, '') || ':' || coalesce(v_detail, '');
end;
$$;

select plan(85);
select ok(has_function_privilege('service_role',
  'private.official_import_kabuki_recovery_marker_internal(text,text,text,text,text,text,text)',
  'EXECUTE'), 'owned publisher can call the private recovery derivation helper');
select ok(not has_function_privilege('authenticated',
  'private.official_import_kabuki_recovery_marker_internal(text,text,text,text,text,text,text)',
  'EXECUTE'), 'authenticated callers cannot execute the recovery helper');
select ok(not has_function_privilege('anon',
  'private.official_import_kabuki_candidate_fresh_internal(uuid)',
  'EXECUTE'), 'anonymous callers cannot execute the freshness helper');

select pg_temp.create_test_user() as creator \gset
insert into public.catalog_creators(user_id) values (:'creator');
set local role service_role;

-- Table writes cannot bypass the owned publisher's completion authority.
select gen_random_uuid() as direct_empty_run \gset
insert into public.official_import_runs(id,source_id)
values(:'direct_empty_run','event.kabuki-bito.schedule');
select throws_ok(format(
  'update public.official_import_runs set status=%L,finished_at=clock_timestamp() where id=%L',
  'completed',:'direct_empty_run'),'23514',null,
  'even an empty unclaimed Kabuki run cannot complete with NULL authority');
select lives_ok(format(
  'update public.official_import_runs set status=%L,finished_at=clock_timestamp(),failure_classification=%L where id=%L',
  'failed','unexpected',:'direct_empty_run'),
  'an unclaimed Kabuki run can still fail without publication authority');

select gen_random_uuid() as guarded_owned_run \gset
select public.claim_official_import_run_attempt(
  :'guarded_owned_run','event.kabuki-bito.schedule','guarded-publisher',300) as guarded_claim \gset
select set_config('stage_tracker.official_import_attempt_run_id',:'guarded_owned_run',true);
select set_config('stage_tracker.official_import_attempt_token','guarded-publisher',true);
select throws_ok(format(
  'update public.official_import_runs set status=%L,finished_at=clock_timestamp(),active_attempt_token=null,active_attempt_lease_expires_at=null where id=%L',
  'completed',:'guarded_owned_run'),'23514',null,
  'a correctly owned attempt still cannot complete with NULL authority');
select set_config('stage_tracker.official_import_publication_ordinal','123456',true);
select set_config('stage_tracker.official_import_attempt_token','wrong-publisher',true);
select throws_ok(format(
  'update public.official_import_runs set status=%L,finished_at=clock_timestamp(),active_attempt_token=null,active_attempt_lease_expires_at=null,publication_ordinal=123456 where id=%L',
  'completed',:'guarded_owned_run'),'23514',null,
  'non-NULL completion still checks the owned attempt token');
select set_config('stage_tracker.official_import_attempt_token','guarded-publisher',true);
select set_config('stage_tracker.official_import_attempt_run_id',:'direct_empty_run',true);
select throws_ok(format(
  'update public.official_import_runs set status=%L,finished_at=clock_timestamp(),active_attempt_token=null,active_attempt_lease_expires_at=null,publication_ordinal=123456 where id=%L',
  'completed',:'guarded_owned_run'),'23514',null,
  'non-NULL completion still checks the owned run scope');
select set_config('stage_tracker.official_import_attempt_run_id',:'guarded_owned_run',true);
select set_config('stage_tracker.official_import_publication_ordinal','123455',true);
select throws_ok(format(
  'update public.official_import_runs set status=%L,finished_at=clock_timestamp(),active_attempt_token=null,active_attempt_lease_expires_at=null,publication_ordinal=123456 where id=%L',
  'completed',:'guarded_owned_run'),'23514',null,
  'non-NULL completion still checks the publication ordinal scope');
select ok((select status='running' and publication_ordinal is null
    and active_attempt_token='guarded-publisher'
  from public.official_import_runs where id=:'guarded_owned_run'),
  'refused direct completions leave the owned run and attempt unchanged');
select set_config('stage_tracker.official_import_attempt_run_id','',true);
select set_config('stage_tracker.official_import_attempt_token','',true);
select set_config('stage_tracker.official_import_publication_ordinal','',true);
select public.commit_owned_official_import_candidate_batch(
  :'guarded_owned_run','event.kabuki-bito.schedule','guarded-publisher','[]') as guarded_commit \gset
select ok((select status='completed' and publication_ordinal > 0
    and active_attempt_token is null and active_attempt_lease_expires_at is null
  from public.official_import_runs where id=:'guarded_owned_run'),
  'the same attempt completes through the legitimate owned empty publisher');

select gen_random_uuid() as direct_other_run \gset
insert into public.official_import_runs(id,source_id)
values(:'direct_other_run','event.compat-other');
select lives_ok(format(
  'update public.official_import_runs set status=%L,finished_at=clock_timestamp() where id=%L',
  'completed',:'direct_other_run'),
  'direct non-Kabuki completion remains compatible with NULL authority');

-- A committed hold wins over approval, an already-owned claim, and the final write.
select pg_temp.kb_publish(pg_temp.kb_payload('9301')) as stale_review_run \gset
select pg_temp.kb_candidate(:'stale_review_run') as stale_review_candidate \gset
select pg_temp.kb_hold('9301') as stale_review_hold \gset
call pg_temp.auth_as_user(:'creator');
select is(pg_temp.kb_error(format(
  'select public.review_official_import_candidate(%L::uuid,%L)',
  :'stale_review_candidate', 'approved')),
  '40001:stage_tracker.kabuki_freshness_refused.v1',
  'approval refuses a candidate published before a hold');
call pg_temp.auth_as_admin();
set local role service_role;

select pg_temp.kb_publish(pg_temp.kb_payload('9302')) as stale_apply_run \gset
select pg_temp.kb_candidate(:'stale_apply_run') as stale_apply_candidate \gset
call pg_temp.kb_ready(:'stale_apply_candidate',:'creator','stale-apply-owner');
select pg_temp.kb_hold('9302') as stale_apply_hold \gset
select is(pg_temp.kb_error(format(
  'select public.claim_official_import_candidate_apply(%L::uuid,%L,300)',
  :'stale_apply_candidate', 'newer-claim')),
  '40001:stage_tracker.kabuki_freshness_refused.v1',
  'a later hold refuses a new claim over a queued candidate');
select pg_temp.kb_all_rows()::text as stale_apply_before \gset
select is(pg_temp.kb_error(pg_temp.kb_apply_sql(
  :'stale_apply_candidate','stale-apply-owner',:'creator')),
  '40001:stage_tracker.kabuki_freshness_refused.v1',
  'the final atomic write refuses a candidate made stale after claim');
select is(pg_temp.kb_all_rows()::text,:'stale_apply_before',
  'stale final-write refusal leaves catalog and candidate rows unchanged');
select pg_temp.kb_publish(pg_temp.kb_payload('9303')) as superseded_run \gset
select pg_temp.kb_candidate(:'superseded_run') as superseded_candidate \gset
call pg_temp.kb_ready(:'superseded_candidate',:'creator','superseded-owner');
select pg_temp.kb_publish(pg_temp.kb_payload('9303',repeat('e',64),'newer-plan')) as newer_run \gset
select is(pg_temp.kb_error(pg_temp.kb_apply_sql(
  :'superseded_candidate','superseded-owner',:'creator')),
  '40001:stage_tracker.kabuki_freshness_refused.v1',
  'a newer ordinary publication also refuses an earlier approved candidate');

-- A failed old approval never becomes eligible again after a hold is recovered.
select pg_temp.kb_publish(pg_temp.kb_payload('9304')) as stale_failed_run \gset
select pg_temp.kb_candidate(:'stale_failed_run') as stale_failed_candidate \gset
call pg_temp.kb_ready(:'stale_failed_candidate',:'creator','stale-failed-owner');
select public.fail_official_import_candidate_apply(
  :'stale_failed_candidate','stale-failed-owner','unexpected'
);
select pg_temp.kb_hold('9304') as stale_failed_hold \gset
select is(pg_temp.kb_error(format(
  'select public.claim_official_import_candidate_apply(%L::uuid,%L,300)',
  :'stale_failed_candidate','stale-failed-before-recovery')),
  '40001:stage_tracker.kabuki_freshness_refused.v1',
  'a committed hold blocks retry of an older failed approval');
select pg_temp.kb_publish(pg_temp.kb_payload('9304')) as failed_recovery_run \gset
select pg_temp.kb_candidate(:'failed_recovery_run') as failed_recovery_candidate \gset
select ok((select recovery_review_required and recovery_hold_run_id=:'stale_failed_hold'::uuid
    and review_status='pending'
  from public.official_import_candidates where id=:'failed_recovery_candidate'),
  'recovery of a failed old approval requires a distinct pending candidate');
call pg_temp.kb_ready(:'failed_recovery_candidate',:'creator','failed-recovery-owner');
select is(pg_temp.kb_apply(:'failed_recovery_candidate','failed-recovery-owner',:'creator'),
  'applied','freshly reviewed recovery settles the held episode');
select pg_temp.kb_all_rows()::text as stale_failed_after_recovery \gset
select is(pg_temp.kb_error(format(
  'select public.claim_official_import_candidate_apply(%L::uuid,%L,300)',
  :'stale_failed_candidate','stale-failed-after-recovery')),
  '40001:stage_tracker.kabuki_freshness_refused.v1',
  'an old failed approval stays stale after the recovery is applied');
select is(pg_temp.kb_error(pg_temp.kb_apply_sql(
  :'stale_failed_candidate','stale-failed-owner',:'creator')), '55000:',
  'the old failed attempt cannot write after a newer recovery is applied');
select is(pg_temp.kb_all_rows()::text,:'stale_failed_after_recovery',
  'post-recovery refusals preserve failed history and every catalog row');

-- The first recovery bypasses identical/no-op suppression and stays visible on repeat scans.
insert into public.events(owner_id,title,venue,source_key,source_url,starts_on,ends_on)
values(:'creator','Fixture','Hall','kabuki-bito:kabukiza:play:9401',
  'https://www.kabuki-bito.jp/theaters/kabukiza/play/9401','2027-01-01','2027-01-02')
returning id as noop_event \gset
select pg_temp.kb_publish(pg_temp.kb_payload('9401')) as noop_baseline_run \gset
select pg_temp.kb_candidate(:'noop_baseline_run') as noop_baseline_candidate \gset
select ok((select not candidate.recovery_review_required
    and candidate.recovery_hold_run_id is null
    and run.publication_ordinal is not null
  from public.official_import_candidates as candidate
  join public.official_import_runs as run on run.id=candidate.run_id
  where candidate.id=:'noop_baseline_candidate'),
  'pre-hold positive-ordinal publication keeps the default false/NULL marker');
select pg_temp.kb_hold('9401') as noop_hold_run \gset
select is(public.commit_owned_official_import_partial_batch(
  :'noop_hold_run','event.kabuki-bito.schedule','completed-replay',null,
  (select jsonb_agg(to_jsonb(held)) from public.official_import_held_pages held where run_id=:'noop_hold_run')
),0,'completed partial replay ignores inactive candidate payload without allocating authority');
select pg_temp.kb_publish(pg_temp.kb_payload(
  '9401',repeat('a',64),'plan-a','unchanged',false,:'noop_event','pending','matched'
)) as noop_recovery_run \gset
select pg_temp.kb_candidate(:'noop_recovery_run') as noop_recovery_candidate \gset
select ok((select recovery_review_required
    and recovery_hold_run_id=:'noop_hold_run'::uuid
    and review_status='pending'
    and plan_summary->>'action'='unchanged'
    and run.publication_ordinal > hold.publication_ordinal
  from public.official_import_candidates as candidate
  join public.official_import_runs as run on run.id=candidate.run_id
  join public.official_import_runs as hold on hold.id=:'noop_hold_run'::uuid
  where candidate.id=:'noop_recovery_candidate'),
  'identical no-op recovery creates a fresh pending row tied to the committed hold');
select is((select count(*) from public.official_import_candidates
  where id=:'noop_baseline_candidate'),0::bigint,
  'a pre-hold default-false proposal is restaged after a later hold');
select is(pg_temp.kb_error(format(
  'update public.official_import_candidates set recovery_hold_run_id=null where id=%L::uuid',
  :'noop_recovery_candidate')), '23514:',
  'recovery markers cannot be changed after publication');
select pg_temp.kb_publish(pg_temp.kb_payload(
  '9401',repeat('a',64),'plan-a','unchanged',false,:'noop_event','pending','matched'
)) as noop_repeat_run \gset
select is((select count(*) from public.official_import_candidates where run_id=:'noop_repeat_run'),0::bigint,
  'unchanged rescan does not create a duplicate recovery row');
select is((select count(*) from public.official_import_candidates
  where id=:'noop_recovery_candidate' and recovery_review_required),1::bigint,
  'the original recovery row remains retained after an unchanged rescan');

call pg_temp.auth_as_user(:'creator');
select is((public.review_official_import_candidate(:'noop_recovery_candidate','rejected')).review_status,
  'rejected','explicit rejection settles the first recovery episode');
call pg_temp.auth_as_admin();
set local role service_role;
select pg_temp.kb_publish(pg_temp.kb_payload(
  '9401',repeat('a',64),'plan-a','unchanged',false,:'noop_event','pending','matched'
)) as settled_repeat_run \gset
select is((select count(*) from public.official_import_candidates where run_id=:'settled_repeat_run'),0::bigint,
  'a settled identical proposal is suppressed without reactivating its rejected row');
select pg_temp.kb_publish(pg_temp.kb_payload(
  '9401',repeat('b',64),'plan-b','update',true,:'noop_event','pending','matched'
)) as rejected_hash_b_run \gset
select pg_temp.kb_candidate(:'rejected_hash_b_run') as rejected_hash_b_candidate \gset
select ok((select not recovery_review_required and recovery_hold_run_id is null
  from public.official_import_candidates where id=:'rejected_hash_b_candidate'),
  'known rejected episode stays settled after hash A to B');
select pg_temp.kb_publish(pg_temp.kb_payload(
  '9401',repeat('a',64),'plan-a','update',true,:'noop_event','pending','matched'
)) as rejected_hash_a_run \gset
select is((select count(*) from public.official_import_candidates where run_id=:'rejected_hash_a_run'),0::bigint,
  'known rejected episode stays settled when the hash returns from B to A');
select pg_temp.kb_publish(pg_temp.kb_payload(
  '9401',repeat('a',64),'plan-a','update',true,:'noop_event','pending','matched'
)) as rejected_hash_a_repeat_run \gset
select is((select count(*) from public.official_import_candidates where run_id=:'rejected_hash_a_repeat_run'),0::bigint,
  'known rejected episode stays suppressed on a repeated no-op scan');

-- A later hold starts a new episode even when the previous proposal was rejected.
select pg_temp.kb_hold('9401') as noop_second_hold \gset
select pg_temp.kb_publish(pg_temp.kb_payload(
  '9401',repeat('a',64),'plan-a','unchanged',false,:'noop_event','pending','matched'
)) as noop_second_recovery_run \gset
select pg_temp.kb_candidate(:'noop_second_recovery_run') as noop_second_recovery_candidate \gset
select ok((select recovery_review_required
    and recovery_hold_run_id=:'noop_second_hold'::uuid
    and review_status='pending'
  from public.official_import_candidates where id=:'noop_second_recovery_candidate'),
  'a new held run opens a distinct pending recovery episode');
call pg_temp.kb_ready(:'noop_second_recovery_candidate',:'creator','recovery-fail-owner');
select public.fail_official_import_candidate_apply(
  :'noop_second_recovery_candidate','recovery-fail-owner','unexpected'
);
select is((select apply_status from public.official_import_candidates
  where id=:'noop_second_recovery_candidate'),'failed',
  'a failed application retains its unresolved recovery marker');
call pg_temp.auth_as_user(:'creator');
select is(public.dismiss_failed_official_import_candidate(:'noop_second_recovery_candidate'),true,
  'creator dismissal settles a failed recovery episode');
call pg_temp.auth_as_admin();
set local role service_role;
select pg_temp.kb_publish(pg_temp.kb_payload(
  '9401',repeat('b',64),'plan-b','update',true,:'noop_event','pending','matched'
)) as after_dismiss_run \gset
select pg_temp.kb_candidate(:'after_dismiss_run') as after_dismiss_candidate \gset
select ok((select not recovery_review_required and recovery_hold_run_id is null
  from public.official_import_candidates where id=:'after_dismiss_candidate'),
  'a changed proposal after explicit dismissal has no reopened marker');
select pg_temp.kb_publish(pg_temp.kb_payload(
  '9401',repeat('c',64),'plan-c','update',true,:'noop_event','pending','matched'
)) as dismissed_hash_c_run \gset
select pg_temp.kb_candidate(:'dismissed_hash_c_run') as dismissed_hash_c_candidate \gset
select ok((select not recovery_review_required and recovery_hold_run_id is null
  from public.official_import_candidates where id=:'dismissed_hash_c_candidate'),
  'known failed-dismissed episode stays settled after hash B to C');
select pg_temp.kb_publish(pg_temp.kb_payload(
  '9401',repeat('a',64),'dismissed-hash-a','update',true,:'noop_event','pending','matched'
)) as dismissed_hash_a_run \gset
select pg_temp.kb_candidate(:'dismissed_hash_a_run') as dismissed_hash_a_candidate \gset
select ok((select not recovery_review_required and recovery_hold_run_id is null
  from public.official_import_candidates where id=:'dismissed_hash_a_candidate'),
  'known failed-dismissed episode stays settled when content returns to hash A');
select pg_temp.kb_publish(pg_temp.kb_payload(
  '9401',repeat('a',64),'dismissed-hash-a','update',true,:'noop_event','pending','matched'
)) as dismissed_hash_a_repeat_run \gset
select is((select count(*) from public.official_import_candidates where run_id=:'dismissed_hash_a_repeat_run'),0::bigint,
  'known failed-dismissed episode stays suppressed on a repeated no-op scan');

-- A third hold creates a fresh episode, and atomic applied evidence settles it.
select pg_temp.kb_hold('9401') as applied_hold_run \gset
select pg_temp.kb_publish(pg_temp.kb_payload(
  '9401',repeat('c',64),'plan-c','update',true,:'noop_event','pending','matched'
)) as applied_recovery_run \gset
select pg_temp.kb_candidate(:'applied_recovery_run') as applied_recovery_candidate \gset
select ok((select recovery_review_required
    and recovery_hold_run_id=:'applied_hold_run'::uuid
    and review_status='pending'
  from public.official_import_candidates where id=:'applied_recovery_candidate'),
  'a third hold marks the replacement proposal for its own review');
call pg_temp.kb_ready(:'applied_recovery_candidate',:'creator','recovery-applied-owner');
select is(pg_temp.kb_apply(:'applied_recovery_candidate','recovery-applied-owner',:'creator'),
  'applied','atomic no-op/update application settles the recovery episode');
select is((select apply_status from public.official_import_candidates
  where id=:'applied_recovery_candidate'),'applied',
  'catalog application and candidate completion commit together');
select pg_temp.kb_publish(pg_temp.kb_payload(
  '9401',repeat('d',64),'plan-d','update',true,:'noop_event','pending','matched'
)) as after_apply_run \gset
select pg_temp.kb_candidate(:'after_apply_run') as after_apply_candidate \gset
select ok((select not recovery_review_required and recovery_hold_run_id is null
  from public.official_import_candidates where id=:'after_apply_candidate'),
  'explicit applied evidence settles the hold for later changed content');
select pg_temp.kb_publish(pg_temp.kb_payload(
  '9401',repeat('e',64),'applied-hash-e','update',true,:'noop_event','pending','matched'
)) as applied_hash_e_run \gset
select pg_temp.kb_candidate(:'applied_hash_e_run') as applied_hash_e_candidate \gset
select ok((select not recovery_review_required and recovery_hold_run_id is null
  from public.official_import_candidates where id=:'applied_hash_e_candidate'),
  'known applied episode stays settled after hash D to E');
select pg_temp.kb_publish(pg_temp.kb_payload(
  '9401',repeat('f',64),'applied-hash-f','update',true,:'noop_event','pending','matched'
)) as applied_hash_f_run \gset
select pg_temp.kb_candidate(:'applied_hash_f_run') as applied_hash_f_candidate \gset
select ok((select not recovery_review_required and recovery_hold_run_id is null
  from public.official_import_candidates where id=:'applied_hash_f_candidate'),
  'known applied episode stays settled after a second hash change');
select pg_temp.kb_publish(pg_temp.kb_payload(
  '9401',repeat('f',64),'applied-hash-f','update',true,:'noop_event','pending','matched'
)) as applied_hash_f_repeat_run \gset
select is((select count(*) from public.official_import_candidates where run_id=:'applied_hash_f_repeat_run'),0::bigint,
  'known applied episode stays suppressed on a repeated no-op scan');
select is(pg_temp.kb_error('select pg_temp.kb_hold(''bad-id'')'), '22023:',
  'a noncanonical held identity cannot acquire publication authority');
select is(pg_temp.kb_error($sql$select pg_temp.kb_hold(
  '9401','https://www.kabuki-bito.jp/theaters/other/play/9401')$sql$), '22023:',
  'a held identity conflicting with an existing work is refused');
select pg_temp.kb_hold('9402') as forged_hold_run \gset
select pg_temp.kb_publish(jsonb_set(jsonb_set(pg_temp.kb_payload('9402'),
  '{0,recovery_review_required}','false'), '{0,recovery_hold_run_id}',to_jsonb(:'noop_hold_run'::text)
)) as forged_run \gset
select ok((select recovery_review_required and recovery_hold_run_id=:'forged_hold_run'::uuid
  from public.official_import_candidates where run_id=:'forged_run'),
  'publisher derives recovery metadata and ignores caller-selected markers');
select pg_temp.kb_hold('9410') as replacement_hold \gset
select pg_temp.kb_publish(pg_temp.kb_payload('9410')) as replacement_first_run \gset
select pg_temp.kb_candidate(:'replacement_first_run') as replacement_first_candidate \gset
select pg_temp.kb_publish(pg_temp.kb_payload('9410',repeat('b',64),'replacement-plan')) as replacement_next_run \gset
select ok((select recovery_review_required and recovery_hold_run_id=:'replacement_hold'::uuid
    and review_status='pending' and reviewer is null
  from public.official_import_candidates where run_id=:'replacement_next_run'),
  'changed recovery content receives a new pending review for the same episode');
select is((select count(*) from public.official_import_candidates where id=:'replacement_first_candidate'),0::bigint,
  'superseded pending recovery is removed rather than reactivated');

-- Legacy NULL authority is unknown and cannot receive a new approval.
select gen_random_uuid() as legacy_run \gset
insert into public.official_import_runs(id,source_id,status,started_at)
values(:'legacy_run','event.kabuki-bito.schedule','running','2020-01-01T00:00:00Z');
insert into public.official_import_candidates(
  run_id,source_id,candidate_kind,canonical_url,official_external_id,observed_at,
  content_hash,proposal_version,proposal,evidence_locator,deterministic_match_status,
  semantic_match_status,plan_summary,plan_fingerprint,review_status
)
select :'legacy_run','event.kabuki-bito.schedule',candidate.candidate_kind,
  candidate.canonical_url,candidate.official_external_id,candidate.observed_at,
  candidate.content_hash,candidate.proposal_version,candidate.proposal,
  candidate.evidence_locator,candidate.deterministic_match_status,
  candidate.semantic_match_status,candidate.plan_summary,candidate.plan_fingerprint,
  'pending'
from jsonb_to_recordset(pg_temp.kb_payload('9501')) as candidate(
  candidate_kind text,canonical_url text,official_external_id text,observed_at timestamptz,
  content_hash text,proposal_version text,proposal jsonb,evidence_locator jsonb,
  deterministic_match_status text,semantic_match_status text,plan_summary jsonb,
  plan_fingerprint text
) returning id as legacy_candidate \gset
select throws_ok(format(
  'update public.official_import_runs set status=%L,finished_at=clock_timestamp() where id=%L',
  'completed',:'legacy_run'),'23514',null,
  'a default-marker candidate cannot make a new NULL-ordinal Kabuki publication');
select ok((select status='running' and publication_ordinal is null
    and exists (select 1 from public.official_import_candidates
      where id=:'legacy_candidate' and not recovery_review_required and recovery_hold_run_id is null)
  from public.official_import_runs where id=:'legacy_run'),
  'refused direct publication leaves the run and default-marker candidate unchanged');
-- Reconstruct pre-guard history explicitly; runtime writes get no date exception.
call pg_temp.auth_as_admin();
set local session_replication_role=replica;
update public.official_import_runs set status='completed',finished_at=clock_timestamp()
where id=:'legacy_run';
set local session_replication_role=origin;
set local role service_role;
call pg_temp.auth_as_user(:'creator');
select is(pg_temp.kb_error(format(
  'select public.review_official_import_candidate(%L::uuid,%L)',
  :'legacy_candidate','approved')),
  '40001:stage_tracker.kabuki_freshness_refused.v1',
  'legacy NULL ordinal does not authorize a new approval');
call pg_temp.auth_as_admin();
set local role service_role;
select pg_temp.kb_publish(pg_temp.kb_payload('9511')) as legacy_approved_run \gset
select pg_temp.kb_candidate(:'legacy_approved_run') as legacy_approved_candidate \gset
call pg_temp.auth_as_user(:'creator');
select public.review_official_import_candidate(:'legacy_approved_candidate','approved');
call pg_temp.auth_as_admin();
set local role service_role;
select pg_temp.kb_publish(pg_temp.kb_payload('9512')) as legacy_queued_run \gset
select pg_temp.kb_candidate(:'legacy_queued_run') as legacy_queued_candidate \gset
call pg_temp.kb_ready(:'legacy_queued_candidate',:'creator','legacy-queued-owner');
select pg_temp.kb_publish(pg_temp.kb_payload('9513')) as legacy_failed_run \gset
select pg_temp.kb_candidate(:'legacy_failed_run') as legacy_failed_candidate \gset
call pg_temp.kb_ready(:'legacy_failed_candidate',:'creator','legacy-failed-owner');
select public.fail_official_import_candidate_apply(:'legacy_failed_candidate','legacy-failed-owner','unexpected');
call pg_temp.auth_as_admin();
set local session_replication_role=replica;
update public.official_import_runs set publication_ordinal=null
where id in (:'legacy_approved_run'::uuid,:'legacy_queued_run'::uuid,:'legacy_failed_run'::uuid);
set local session_replication_role=origin;
set local role service_role;
select is((select count(*) from public.official_import_runs
  where id in (:'legacy_approved_run'::uuid,:'legacy_queued_run'::uuid,:'legacy_failed_run'::uuid)
    and publication_ordinal is null),3::bigint,
  'approved, queued, and failed historical fixtures have unknown NULL ordinals');
select is(pg_temp.kb_error(format(
  'select public.claim_official_import_candidate_apply(%L::uuid,%L,300)',
  :'legacy_approved_candidate','legacy-approved-claim')),
  '40001:stage_tracker.kabuki_freshness_refused.v1',
  'legacy approved NULL-ordinal candidate cannot receive a new claim');
select is(pg_temp.kb_error(format(
  'select public.claim_official_import_candidate_apply(%L::uuid,%L,300)',
  :'legacy_queued_candidate','legacy-queued-claim')),
  '40001:stage_tracker.kabuki_freshness_refused.v1',
  'legacy queued NULL-ordinal candidate cannot receive a replacement claim');
select pg_temp.kb_all_rows()::text as legacy_queued_before \gset
select is(pg_temp.kb_error(pg_temp.kb_apply_sql(
  :'legacy_queued_candidate','legacy-queued-owner',:'creator')),
  '40001:stage_tracker.kabuki_freshness_refused.v1',
  'legacy queued NULL-ordinal candidate cannot pass the final atomic write');
select is(pg_temp.kb_all_rows()::text,:'legacy_queued_before',
  'legacy final-write refusal leaves the catalog and staging rows unchanged');
select is(pg_temp.kb_error(format(
  'select public.claim_official_import_candidate_apply(%L::uuid,%L,300)',
  :'legacy_failed_candidate','legacy-failed-retry')),
  '40001:stage_tracker.kabuki_freshness_refused.v1',
  'legacy failed NULL-ordinal candidate cannot be reclaimed for retry');
select ok((select apply_status='failed' and active_apply_attempt_token is null
  from public.official_import_candidates where id=:'legacy_failed_candidate'),
  'failed legacy row remains failed and unowned after rejected retry');

select pg_temp.kb_publish(pg_temp.kb_payload('9501')) as legacy_recovery_run \gset
select pg_temp.kb_candidate(:'legacy_recovery_run') as legacy_recovery_candidate \gset
select ok((select recovery_review_required and recovery_hold_run_id is null
    and review_status='pending'
  from public.official_import_candidates where run_id=:'legacy_recovery_run'),
  'first fresh publication after unknown legacy history retains true/NULL recovery');
select ok((select publication_ordinal is null from public.official_import_runs where id=:'legacy_run'),
  'legacy recovery never backfills the historical publication ordinal');
call pg_temp.auth_as_user(:'creator');
select is((public.review_official_import_candidate(:'legacy_recovery_candidate','rejected')).review_status,
  'rejected','explicit rejection settles a legacy unknown recovery episode');
call pg_temp.auth_as_admin();
set local role service_role;
select pg_temp.kb_publish(pg_temp.kb_payload('9501',repeat('b',64),'legacy-plan-b')) as legacy_reject_hash_b_run \gset
select pg_temp.kb_candidate(:'legacy_reject_hash_b_run') as legacy_reject_hash_b_candidate \gset
select ok((select not recovery_review_required and recovery_hold_run_id is null
  from public.official_import_candidates where id=:'legacy_reject_hash_b_candidate'),
  'legacy rejected episode stays settled after hash A to B');
select pg_temp.kb_publish(pg_temp.kb_payload('9501',repeat('c',64),'legacy-plan-c')) as legacy_reject_hash_c_run \gset
select pg_temp.kb_candidate(:'legacy_reject_hash_c_run') as legacy_reject_hash_c_candidate \gset
select ok((select not recovery_review_required and recovery_hold_run_id is null
  from public.official_import_candidates where id=:'legacy_reject_hash_c_candidate'),
  'legacy rejected episode stays settled after a second hash change');
select pg_temp.kb_publish(pg_temp.kb_payload('9501')) as legacy_reject_hash_a_run \gset
select is((select count(*) from public.official_import_candidates where run_id=:'legacy_reject_hash_a_run'),0::bigint,
  'legacy rejected episode stays settled when the hash returns from C to A');
select pg_temp.kb_publish(pg_temp.kb_payload('9501')) as legacy_reject_hash_a_repeat_run \gset
select is((select count(*) from public.official_import_candidates where run_id=:'legacy_reject_hash_a_repeat_run'),0::bigint,
  'legacy rejected episode stays suppressed on a repeated no-op scan');

select pg_temp.kb_publish(pg_temp.kb_payload('9552',repeat('a',64),'legacy-dismiss-a')) as legacy_dismiss_old_run \gset
select pg_temp.kb_candidate(:'legacy_dismiss_old_run') as legacy_dismiss_old_candidate \gset
call pg_temp.auth_as_admin();
set local session_replication_role=replica;
update public.official_import_runs set publication_ordinal=null where id=:'legacy_dismiss_old_run'::uuid;
set local session_replication_role=origin;
set local role service_role;
select pg_temp.kb_publish(pg_temp.kb_payload('9552',repeat('a',64),'legacy-dismiss-a')) as legacy_dismiss_recovery_run \gset
select pg_temp.kb_candidate(:'legacy_dismiss_recovery_run') as legacy_dismiss_recovery_candidate \gset
select ok((select recovery_review_required and recovery_hold_run_id is null
    and review_status='pending'
  from public.official_import_candidates where id=:'legacy_dismiss_recovery_candidate'),
  'unknown legacy history opens a true/NULL episode for failed dismissal');
call pg_temp.kb_ready(:'legacy_dismiss_recovery_candidate',:'creator','legacy-dismiss-owner');
select public.fail_official_import_candidate_apply(:'legacy_dismiss_recovery_candidate','legacy-dismiss-owner','unexpected');
call pg_temp.auth_as_user(:'creator');
select is(public.dismiss_failed_official_import_candidate(:'legacy_dismiss_recovery_candidate'),true,
  'failed dismissal settles a legacy unknown recovery episode');
call pg_temp.auth_as_admin();
set local role service_role;
select pg_temp.kb_publish(pg_temp.kb_payload('9552',repeat('b',64),'legacy-dismiss-b')) as legacy_dismiss_hash_b_run \gset
select pg_temp.kb_candidate(:'legacy_dismiss_hash_b_run') as legacy_dismiss_hash_b_candidate \gset
select ok((select not recovery_review_required and recovery_hold_run_id is null
  from public.official_import_candidates where id=:'legacy_dismiss_hash_b_candidate'),
  'legacy failed-dismissed episode stays settled after hash A to B');
select pg_temp.kb_publish(pg_temp.kb_payload('9552',repeat('c',64),'legacy-dismiss-c')) as legacy_dismiss_hash_c_run \gset
select pg_temp.kb_candidate(:'legacy_dismiss_hash_c_run') as legacy_dismiss_hash_c_candidate \gset
select ok((select not recovery_review_required and recovery_hold_run_id is null
  from public.official_import_candidates where id=:'legacy_dismiss_hash_c_candidate'),
  'legacy failed-dismissed episode stays settled after a second hash change');
select pg_temp.kb_publish(pg_temp.kb_payload('9552',repeat('a',64),'legacy-dismiss-return-a')) as legacy_dismiss_hash_a_run \gset
select pg_temp.kb_candidate(:'legacy_dismiss_hash_a_run') as legacy_dismiss_hash_a_candidate \gset
select ok((select not recovery_review_required and recovery_hold_run_id is null
  from public.official_import_candidates where id=:'legacy_dismiss_hash_a_candidate'),
  'legacy failed-dismissed episode stays settled when content returns to hash A');
select pg_temp.kb_publish(pg_temp.kb_payload('9552',repeat('a',64),'legacy-dismiss-return-a')) as legacy_dismiss_hash_a_repeat_run \gset
select is((select count(*) from public.official_import_candidates where run_id=:'legacy_dismiss_hash_a_repeat_run'),0::bigint,
  'legacy failed-dismissed episode stays suppressed on a repeated no-op scan');

select pg_temp.kb_publish(pg_temp.kb_payload('9553',repeat('a',64),'legacy-applied-a')) as legacy_applied_old_run \gset
select pg_temp.kb_candidate(:'legacy_applied_old_run') as legacy_applied_old_candidate \gset
call pg_temp.auth_as_admin();
set local session_replication_role=replica;
update public.official_import_runs set publication_ordinal=null where id=:'legacy_applied_old_run'::uuid;
set local session_replication_role=origin;
set local role service_role;
select pg_temp.kb_publish(pg_temp.kb_payload('9553',repeat('a',64),'legacy-applied-a')) as legacy_applied_recovery_run \gset
select pg_temp.kb_candidate(:'legacy_applied_recovery_run') as legacy_applied_recovery_candidate \gset
select ok((select recovery_review_required and recovery_hold_run_id is null
    and review_status='pending'
  from public.official_import_candidates where id=:'legacy_applied_recovery_candidate'),
  'unknown legacy history opens a true/NULL episode for atomic application');
call pg_temp.kb_ready(:'legacy_applied_recovery_candidate',:'creator','legacy-applied-owner');
select is(pg_temp.kb_apply(:'legacy_applied_recovery_candidate','legacy-applied-owner',:'creator'),
  'applied','atomic application settles a legacy unknown recovery episode');
select pg_temp.kb_publish(pg_temp.kb_payload('9553',repeat('b',64),'legacy-applied-b')) as legacy_applied_hash_b_run \gset
select pg_temp.kb_candidate(:'legacy_applied_hash_b_run') as legacy_applied_hash_b_candidate \gset
select ok((select not recovery_review_required and recovery_hold_run_id is null
  from public.official_import_candidates where id=:'legacy_applied_hash_b_candidate'),
  'legacy applied episode stays settled after hash A to B');
select pg_temp.kb_publish(pg_temp.kb_payload('9553',repeat('c',64),'legacy-applied-c')) as legacy_applied_hash_c_run \gset
select pg_temp.kb_candidate(:'legacy_applied_hash_c_run') as legacy_applied_hash_c_candidate \gset
select ok((select not recovery_review_required and recovery_hold_run_id is null
  from public.official_import_candidates where id=:'legacy_applied_hash_c_candidate'),
  'legacy applied episode stays settled after a second hash change');
select pg_temp.kb_publish(pg_temp.kb_payload('9553',repeat('a',64),'legacy-applied-return-a')) as legacy_applied_hash_a_run \gset
select pg_temp.kb_candidate(:'legacy_applied_hash_a_run') as legacy_applied_hash_a_candidate \gset
select ok((select not recovery_review_required and recovery_hold_run_id is null
  from public.official_import_candidates where id=:'legacy_applied_hash_a_candidate'),
  'legacy applied episode stays settled when content returns to hash A');
select pg_temp.kb_publish(pg_temp.kb_payload('9553',repeat('a',64),'legacy-applied-return-a')) as legacy_applied_hash_a_repeat_run \gset
select is((select count(*) from public.official_import_candidates where run_id=:'legacy_applied_hash_a_repeat_run'),0::bigint,
  'legacy applied episode stays suppressed on a repeated no-op scan');

-- Reproduce an already-applied pre-cutover row without changing product routes.
-- Trigger bypass is limited to this synthetic fixture's historical NULL value.
call pg_temp.auth_as_admin();
set local session_replication_role=replica;
update public.official_import_runs set publication_ordinal=null where id=:'applied_recovery_run';
set local session_replication_role=origin;
set local role service_role;
select pg_temp.kb_all_rows()::text as legacy_replay_before \gset
select is(pg_temp.kb_apply(:'applied_recovery_candidate','recovery-applied-owner',:'creator'),
  'applied','already-applied NULL-authority history retains confirmed replay');
select is(pg_temp.kb_all_rows()::text,:'legacy_replay_before',
  'legacy applied replay leaves every captured row unchanged');
call pg_temp.auth_as_admin();

select * from finish();
rollback;
