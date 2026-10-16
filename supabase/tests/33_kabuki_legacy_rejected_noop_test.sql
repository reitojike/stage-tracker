-- #829: synthetic pre-ordinal rejection and current no-op observations only.
\ir helpers/auth.psql
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers/kabuki-compat-expand.psql
select plan(34);

create temporary table noop_fixtures (
  work text primary key, event_id uuid, legacy_id uuid, candidate_id uuid, payload jsonb
);
grant select on noop_fixtures to service_role;
create function pg_temp.noop_fixture(p_work text, p_owner uuid) returns void
language plpgsql as $$
declare v_event uuid; v_legacy_run uuid; v_run uuid; v_payload jsonb;
begin
  insert into public.events(owner_id,title,venue,source_url,source_key,starts_on,ends_on)
    values(p_owner,'Fixture','Hall','https://www.kabuki-bito.jp/theaters/kabukiza/play/' || p_work,
      'kabuki-bito:kabukiza:play:' || p_work,'2027-01-01','2027-01-02') returning id into v_event;
  insert into public.event_occurrences(event_id,starts_at,ends_at,doors_at)
    values(v_event,'2027-01-01T12:00:00+09:00','2027-01-01T15:00:00+09:00','2027-01-01T11:30:00+09:00');
  v_payload := jsonb_set(pg_temp.kb_payload(p_work,repeat('b',64),'noop-current',
    'unchanged',false,v_event,'pending','matched'),'{0,proposal,occurrences}',
    '[{"startsAt":"2027-01-01T12:00:00+09:00","endsAt":"2027-01-01T15:00:00+09:00","doorsAt":"2027-01-01T11:30:00+09:00"}]');
  v_legacy_run := pg_temp.kb_publish(pg_temp.kb_payload(p_work));
  -- Reconstruct historical data as postgres, never through a runtime exception.
  execute 'set local session_replication_role=replica';
  update public.official_import_runs set publication_ordinal=null where id=v_legacy_run;
  update public.official_import_candidates set proposal=v_payload#>'{0,proposal}',
      review_status='rejected',reviewer=p_owner,reviewed_at=clock_timestamp()
    where run_id=v_legacy_run;
  execute 'set local session_replication_role=origin';
  -- Publish a real-diff fixture first, then reconstruct its pre-fix no-op plan.
  v_run := pg_temp.kb_publish(jsonb_set(v_payload,'{0,plan_summary,detailsChanged}','true'));
  execute 'set local session_replication_role=replica';
  update public.official_import_candidates set plan_summary=v_payload#>'{0,plan_summary}' where run_id=v_run;
  execute 'set local session_replication_role=origin';
  insert into noop_fixtures values(p_work,v_event,pg_temp.kb_candidate(v_legacy_run),pg_temp.kb_candidate(v_run),v_payload);
end;
$$;

select pg_temp.create_test_user() as creator \gset
select pg_temp.create_test_user() as other_creator \gset
insert into public.catalog_creators(user_id) values(:'creator'),(:'other_creator');
select pg_temp.noop_fixture(work,:'creator') from unnest(array['9701','9702','9703','9704','9705','9706','9707','9708','9709','9710']) work;

select ok(not has_function_privilege('authenticated',
  'private.official_import_kabuki_legacy_rejected_noop_internal(public.official_import_candidates)','EXECUTE'),
  'authenticated cannot invoke the private predicate');
select ok(not has_function_privilege('anon',
  'private.official_import_kabuki_legacy_rejected_noop_internal(public.official_import_candidates)','EXECUTE'),
  'anonymous cannot invoke the private predicate');
select ok((select bool_and(c.recovery_review_required and c.recovery_hold_run_id is null)
  from public.official_import_candidates c join noop_fixtures f on f.candidate_id=c.id),
  'fixtures reproduce stored pending legacy-only recovery markers');
select ok((select private.official_import_kabuki_legacy_rejected_noop_internal(c)
  from public.official_import_candidates c join noop_fixtures f on f.candidate_id=c.id where f.work='9701'),
  'old rejected create plan can converge to a current exact existing-catalog no-op');

-- Every uncertain case stays gated, including reviewed/queued/applied history.
set local session_replication_role=replica;
update public.official_import_candidates set review_status='pending',reviewer=null,reviewed_at=null
  where id=(select legacy_id from noop_fixtures where work='9702');
update public.official_import_candidates set reviewer=:'other_creator'
  where id=(select legacy_id from noop_fixtures where work='9703');
update public.official_import_candidates set proposal=jsonb_set(proposal,'{title}','"different rejected facts"')
  where id=(select legacy_id from noop_fixtures where work='9704');
update public.official_import_candidates set review_status='approved',reviewer=:'creator',reviewed_at=clock_timestamp()
  where id in (select candidate_id from noop_fixtures where work in ('9705','9706','9707'));
update public.official_import_candidates set apply_status='queued',active_apply_attempt_token='fixture-queued',
  active_apply_lease_expires_at=clock_timestamp()+interval '5 minutes'
  where id=(select candidate_id from noop_fixtures where work='9706');
update public.official_import_candidates set apply_status='applied',applied_at=clock_timestamp()
  where id=(select candidate_id from noop_fixtures where work='9707');
update public.official_import_candidates set plan_summary=jsonb_set(plan_summary,'{groupsChanged}','true')
  where id=(select candidate_id from noop_fixtures where work='9708');
set local session_replication_role=origin;
update public.event_occurrences set ends_at=ends_at+interval '1 minute'
  where event_id=(select event_id from noop_fixtures where work='9709');
-- Actual held history is never reinterpreted as an ordinary rejected no-op.
select gen_random_uuid() as held_run \gset
select public.claim_official_import_run_attempt(:'held_run','event.kabuki-bito.schedule','fixture-hold',300);
select public.commit_owned_official_import_partial_batch(:'held_run','event.kabuki-bito.schedule','fixture-hold','[]',
  '[{"canonical_url":"https://www.kabuki-bito.jp/theaters/kabukiza/play/9710","official_external_id":"9710","title":"Held fixture","starts_on":"2027-01-01","ends_on":"2027-01-02","reason_code":"source_parse"}]');

select pg_temp.kb_snapshot(event_id)::text as catalog_before from noop_fixtures where work='9701' \gset

select ok(not private.official_import_kabuki_legacy_rejected_noop_internal(c),
  'excluded fixture remains gated: ' || f.work)
from public.official_import_candidates c join noop_fixtures f on f.candidate_id=c.id
where f.work not in ('9701','9707');
-- Model the post-reconciliation state for freshness/review/publisher tests.
-- The actual migration and guard restoration are replayed by the Node DB test,
-- because the Supabase pgTAP runner mounts tests but not migration source files.
set local session_replication_role=replica;
update public.official_import_candidates set recovery_review_required=false
  where id=(select candidate_id from noop_fixtures where work='9701');
set local session_replication_role=origin;
select ok(private.official_import_kabuki_candidate_fresh_internal(candidate_id),
  'reconciled pending candidate stays fresh for normal review') from noop_fixtures where work='9701';
select set_config('stage_tracker.legacy_noop_reconcile_candidate',candidate_id::text,true) from noop_fixtures where work='9701';
select throws_ok(format('update public.official_import_candidates set recovery_review_required=true where id=%L',candidate_id),
  '23514','candidate recovery metadata is immutable after publication','spoofed migration GUC cannot modify metadata after restoration')
  from noop_fixtures where work='9701';

-- Parent/child edits invalidate the equality proof even with a no-op summary.
savepoint catalog_drift;
update public.events set title='local edit' where id=(select event_id from noop_fixtures where work='9701');
select ok(not private.official_import_kabuki_candidate_fresh_internal(candidate_id),
  'catalog drift restores the freshness gate') from noop_fixtures where work='9701';
rollback to catalog_drift;
savepoint child_drift;
insert into public.event_occurrences(event_id,starts_at) select event_id,'2027-01-02T12:00:00+09:00' from noop_fixtures where work='9701';
select ok(not private.official_import_kabuki_candidate_fresh_internal(candidate_id),
  'an extra current occurrence prevents false no-op proof') from noop_fixtures where work='9701';
rollback to child_drift;

savepoint reviewed_noop;
select candidate_id as normalized_candidate from noop_fixtures where work='9701' \gset
call pg_temp.kb_ready(:'normalized_candidate',:'creator','normalized-apply');
select is(pg_temp.kb_apply(:'normalized_candidate','normalized-apply',:'creator'),'applied',
  'normal owner review and atomic no-op apply remain usable after reconciliation');
call pg_temp.auth_as_admin();
select is(pg_temp.kb_snapshot(event_id)::text,:'catalog_before','explicit no-op apply preserves catalog') from noop_fixtures where work='9701';
rollback to reviewed_noop;

-- Direct predicate variants exercise data that a forged plan summary omits.
select ok(not private.official_import_kabuki_legacy_rejected_noop_internal(
  jsonb_populate_record(c,variant.patch)),variant.label)
from public.official_import_candidates c join noop_fixtures f on f.candidate_id=c.id
cross join lateral (values
  (jsonb_build_object('source_id','event.other'),'other source is excluded'),
  (jsonb_build_object('candidate_kind','ticket_opportunity'),'Ticket candidate is excluded'),
  (jsonb_build_object('deterministic_match_status','ambiguous'),'ambiguous identity is excluded'),
  (jsonb_build_object('proposal',jsonb_set(c.proposal,'{groups}','[]')),'classification payload is excluded'),
  (jsonb_build_object('proposal',jsonb_set(c.proposal,'{occurrences}','[]')),'missing proposed occurrence is excluded'),
  (jsonb_build_object('proposal',jsonb_set(c.proposal,'{occurrences,0,startsAt}','"2027-01-01 12:00"')),'timezone-free timestamp is excluded'),
  (jsonb_build_object('proposal',jsonb_set(c.proposal,'{occurrences,0,startsAt}','"2027-99-01T12:00:00Z"')),'invalid timestamp fails closed'),
  (jsonb_build_object('proposal',jsonb_set(c.proposal,'{occurrences}',(c.proposal->'occurrences')||(c.proposal->'occurrences'))),'duplicate proposed occurrence is excluded')
) variant(patch,label) where f.work='9701';

-- No new human decision is required for exact no-op observations. Existing
-- publisher suppression removes these without inventing applied/rejected state.
set local role service_role;
select pg_temp.kb_publish(payload) as same_run from noop_fixtures where work='9701' \gset
select is((select count(*)::integer from public.official_import_candidates where run_id=:'same_run'),0,'same-content rescan creates no recovery candidate');
select pg_temp.kb_publish(jsonb_set(payload,'{0,content_hash}',to_jsonb(repeat('c',64)))) as changed_hash_run
  from noop_fixtures where work='9701' \gset
select is((select count(*)::integer from public.official_import_candidates where run_id=:'changed_hash_run'),0,'changed HTML hash with identical facts creates no review work');
select pg_temp.kb_publish(jsonb_set(payload,'{0,content_hash}',to_jsonb(repeat('c',64)))) as repeated_run
  from noop_fixtures where work='9701' \gset
select is((select count(*)::integer from public.official_import_candidates where run_id=:'repeated_run'),0,'repeated normalized facts remain suppressed');
select pg_temp.kb_publish(jsonb_set(jsonb_set(payload,'{0,proposal,title}','"real source change"'),'{0,plan_summary,detailsChanged}','true')) as real_diff_run
  from noop_fixtures where work='9701' \gset
select ok((select recovery_review_required and review_status='pending' and apply_status='not_started'
  from public.official_import_candidates where run_id=:'real_diff_run'),'real difference retains human recovery review');
call pg_temp.auth_as_admin();
select is(pg_temp.kb_snapshot(event_id)::text,:'catalog_before','publication/suppression never writes catalog') from noop_fixtures where work='9701';

-- A pending legacy marker can become provably unchanged after migration.
-- Same hash/version/fingerprint must not let same_open_proposal retain it.
update public.event_occurrences set ends_at='2027-01-01T15:00:00+09:00'
  where event_id=(select event_id from noop_fixtures where work='9709');
set local role service_role;
select pg_temp.kb_publish(payload) as converged_run from noop_fixtures where work='9709' \gset
select is((select count(*)::integer from public.official_import_candidates where run_id=:'converged_run'),0,
  'later catalog convergence forces a fresh proof instead of retaining an identical open marker');
select ok(not exists(select 1 from public.official_import_candidates where id=(select candidate_id from noop_fixtures where work='9709')),
  'fresh no-op publication supersedes the saved pending recovery marker');

call pg_temp.auth_as_admin();
set local session_replication_role=replica;
update public.official_import_runs set publication_ordinal=null where id=:'held_run';
set local session_replication_role=origin;
set local role service_role;
select pg_temp.kb_publish(payload) as legacy_held_run from noop_fixtures where work='9710' \gset
select ok((select recovery_review_required and recovery_hold_run_id is null
  from public.official_import_candidates where id=(select candidate_id from noop_fixtures where work='9710')),
  'actual legacy held history still requires review despite rejected identical no-op facts');
select * from finish();
rollback;
