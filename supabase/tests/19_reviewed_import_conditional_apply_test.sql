-- Issue #633: a reviewed plan cannot overwrite catalog facts that changed
-- after planning, including child rows replaced by the import RPC.

\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select is(has_function_privilege('authenticated',
          'public.apply_reviewed_import_event_plan'::regproc, 'EXECUTE'),
          false, 'ordinary authenticated users cannot call reviewed Event apply');
select is(has_function_privilege('authenticated',
          'public.apply_reviewed_ticket_opportunity'::regproc, 'EXECUTE'),
          false, 'ordinary authenticated users cannot call reviewed Ticket apply');

select pg_temp.create_test_user() as creator_id \gset
insert into public.catalog_creators (user_id) values (:'creator_id');
set local role service_role;

select (public.apply_reviewed_import_event_plan(
  p_action := 'create', p_owner_id := :'creator_id', p_event_id := null,
  p_source_key := 'reviewed-race:event', p_title := 'Original title',
  p_starts_on := '2026-10-10', p_ends_on := '2026-10-10',
  p_occurrences := '[{"startsAt":"2026-10-10T04:00:00Z","endsAt":null,"doorsAt":null}]',
  p_occurrence_fixes := '[]', p_venue := 'Hall', p_source_url := null,
  p_memo := null, p_set_genre := false, p_genre_key := null,
  p_set_groups := false, p_groups := '[]', p_expected_current := null
)).id as event_id \gset
select is((select source_key from public.events where id = :'event_id'),
          'reviewed-race:event', 'reviewed Event create writes its source identity');

select jsonb_build_object(
  'event', to_jsonb(e),
  'occurrences', coalesce((select jsonb_agg(to_jsonb(eo)) from public.event_occurrences eo
                           where eo.event_id = e.id), '[]'::jsonb),
  'groups', '[]'::jsonb
  , 'genreKey', null
)::text as event_snapshot
from public.events e where e.id = :'event_id' \gset

update public.events set title = 'Concurrent edit' where id = :'event_id';
select throws_ok(
  format($sql$
    select public.apply_reviewed_import_event_plan(
      p_action := 'update', p_owner_id := %L, p_event_id := %L,
      p_source_key := 'reviewed-race:event', p_title := 'Imported title',
      p_starts_on := '2026-10-10', p_ends_on := '2026-10-10',
      p_occurrences := '[]', p_occurrence_fixes := '[]',
      p_venue := 'Hall', p_source_url := null, p_memo := null,
      p_set_genre := false, p_genre_key := null,
      p_set_groups := false, p_groups := '[]',
      p_expected_current := %L::jsonb
    )
  $sql$, :'creator_id', :'event_id', :'event_snapshot'),
  '40001', null,
  'an Event detail edit after planning rejects the reviewed import'
);
select is((select title from public.events where id = :'event_id'),
          'Concurrent edit', 'stale reviewed apply does not overwrite Event details');

select jsonb_build_object(
  'event', to_jsonb(e),
  'occurrences', coalesce((select jsonb_agg(to_jsonb(eo)) from public.event_occurrences eo
                           where eo.event_id = e.id), '[]'::jsonb),
  'groups', '[]'::jsonb
  , 'genreKey', null
)::text as event_snapshot
from public.events e where e.id = :'event_id' \gset

update public.event_occurrences set canceled_at = now() where event_id = :'event_id';
select throws_ok(
  format($sql$
    select public.apply_reviewed_import_event_plan(
      p_action := 'unchanged', p_owner_id := %L, p_event_id := %L,
      p_source_key := 'reviewed-race:event', p_title := 'Concurrent edit',
      p_starts_on := '2026-10-10', p_ends_on := '2026-10-10',
      p_occurrences := '[]', p_occurrence_fixes := '[]',
      p_venue := 'Hall', p_source_url := null, p_memo := null,
      p_set_genre := false, p_genre_key := null,
      p_set_groups := false, p_groups := '[]',
      p_expected_current := %L::jsonb
    )
  $sql$, :'creator_id', :'event_id', :'event_snapshot'),
  '40001', null,
  'an Occurrence cancellation after planning rejects convergence'
);

select jsonb_build_object(
  'event', to_jsonb(e),
  'occurrences', coalesce((select jsonb_agg(to_jsonb(eo)) from public.event_occurrences eo
                           where eo.event_id = e.id), '[]'::jsonb),
  'groups', '[]'::jsonb,
  'genreKey', null
)::text as event_snapshot
from public.events e where e.id = :'event_id' \gset

select lives_ok(
  format($sql$
    select public.apply_reviewed_import_event_plan(
      p_action := 'update', p_owner_id := %L, p_event_id := %L,
      p_source_key := 'reviewed-race:event', p_title := 'Reviewed title',
      p_starts_on := '2026-10-10', p_ends_on := '2026-10-10',
      p_occurrences := '[]', p_occurrence_fixes := '[]',
      p_venue := 'Hall', p_source_url := null, p_memo := null,
      p_set_genre := false, p_genre_key := null,
      p_set_groups := false, p_groups := '[]',
      p_expected_current := %L::jsonb
    )
  $sql$, :'creator_id', :'event_id', :'event_snapshot'),
  'an unchanged snapshot permits the reviewed Event import'
);
select is((select title from public.events where id = :'event_id'),
          'Reviewed title', 'reviewed Event import updates the planned row');

select id as occurrence_id from public.event_occurrences
where event_id = :'event_id' limit 1 \gset

select jsonb_build_object(
  'event', jsonb_build_object('id', e.id, 'source_key', e.source_key, 'title', e.title),
  'opportunity', null,
  'targets', '[]'::jsonb,
  'milestones', '[]'::jsonb,
  'targetOccurrences', jsonb_build_array(jsonb_build_object(
    'id', eo.id, 'starts_at', eo.starts_at))
)::text as ticket_initial_snapshot
from public.events e join public.event_occurrences eo on eo.event_id = e.id
where e.id = :'event_id' \gset

select (public.apply_reviewed_ticket_opportunity(
  p_action := 'create', p_event_id := :'event_id',
  p_source_key := 'reviewed-race:ticket', p_display_name := 'Original sale',
  p_target_scope := 'selected_occurrences',
  p_occurrence_ids := array[:'occurrence_id'::uuid],
  p_source_url := null, p_memo := null,
  p_milestones := '[{"milestone_type":"sale_start","temporal_precision":"date","date_value":"2026-09-20"}]',
  p_expected_current := :'ticket_initial_snapshot'::jsonb
)).id as opportunity_id \gset
select is((select source_key from public.ticket_opportunities where id = :'opportunity_id'),
          'reviewed-race:ticket', 'reviewed Ticket create writes its source identity');

select jsonb_build_object(
  'event', jsonb_build_object('id', e.id, 'source_key', e.source_key, 'title', e.title),
  'opportunity', to_jsonb(o),
  'targets', coalesce((select jsonb_agg(t.occurrence_id)
                       from public.ticket_opportunity_target_occurrences t
                       where t.opportunity_id = o.id), '[]'::jsonb),
  'milestones', coalesce((select jsonb_agg(to_jsonb(m))
                          from public.ticket_opportunity_milestones m
                          where m.opportunity_id = o.id), '[]'::jsonb),
  'targetOccurrences', coalesce((select jsonb_agg(jsonb_build_object('id', eo.id, 'starts_at', eo.starts_at))
                                 from public.event_occurrences eo where eo.id = :'occurrence_id'), '[]'::jsonb)
)::text as ticket_snapshot
from public.ticket_opportunities o join public.events e on e.id = o.event_id
where o.id = :'opportunity_id' \gset

update public.ticket_opportunity_milestones set date_value = '2026-09-21'
where opportunity_id = :'opportunity_id';
select throws_ok(
  format($sql$
    select public.apply_reviewed_ticket_opportunity(
      p_action := 'update', p_event_id := %L,
      p_source_key := 'reviewed-race:ticket', p_display_name := 'Imported sale',
      p_target_scope := 'selected_occurrences', p_occurrence_ids := array[%L::uuid],
      p_source_url := null, p_memo := null,
      p_milestones := '[{"milestone_type":"sale_start","temporal_precision":"date","date_value":"2026-09-20"}]',
      p_expected_current := %L::jsonb
    )
  $sql$, :'event_id', :'occurrence_id', :'ticket_snapshot'),
  '40001', null,
  'a milestone edit after planning rejects the reviewed replacement'
);
select is((select date_value from public.ticket_opportunity_milestones
           where opportunity_id = :'opportunity_id' and milestone_type = 'sale_start'),
          '2026-09-21'::date,
          'stale reviewed apply does not replace the concurrent milestone');

select jsonb_build_object(
  'event', jsonb_build_object('id', e.id, 'source_key', e.source_key, 'title', e.title),
  'opportunity', to_jsonb(o),
  'targets', coalesce((select jsonb_agg(t.occurrence_id)
                       from public.ticket_opportunity_target_occurrences t
                       where t.opportunity_id = o.id), '[]'::jsonb),
  'milestones', coalesce((select jsonb_agg(to_jsonb(m))
                          from public.ticket_opportunity_milestones m
                          where m.opportunity_id = o.id), '[]'::jsonb),
  'targetOccurrences', coalesce((select jsonb_agg(jsonb_build_object('id', eo.id, 'starts_at', eo.starts_at))
                                 from public.event_occurrences eo where eo.id = :'occurrence_id'), '[]'::jsonb)
)::text as ticket_snapshot
from public.ticket_opportunities o join public.events e on e.id = o.event_id
where o.id = :'opportunity_id' \gset

select lives_ok(
  format($sql$
    select public.apply_reviewed_ticket_opportunity(
      p_action := 'update', p_event_id := %L,
      p_source_key := 'reviewed-race:ticket', p_display_name := 'Imported sale',
      p_target_scope := 'selected_occurrences', p_occurrence_ids := array[%L::uuid],
      p_source_url := null, p_memo := null,
      p_milestones := '[{"milestone_type":"sale_start","temporal_precision":"date","date_value":"2026-09-20"}]',
      p_expected_current := %L::jsonb
    )
  $sql$, :'event_id', :'occurrence_id', :'ticket_snapshot'),
  'an unchanged snapshot permits the reviewed Ticket import'
);
select is((select display_name from public.ticket_opportunities where id = :'opportunity_id'),
          'Imported sale', 'reviewed Ticket import updates the planned row');
select is((select date_value from public.ticket_opportunity_milestones
           where opportunity_id = :'opportunity_id' and milestone_type = 'sale_start'),
          '2026-09-20'::date, 'reviewed Ticket import atomically replaces milestones');

select * from finish();
rollback;
