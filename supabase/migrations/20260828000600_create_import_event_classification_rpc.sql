-- Atomic operator-import write boundary for Event genre/group
-- classification (Issue #167, PO decision #158).
--
-- This is the *only* write path for events.genre_id / event_groups /
-- groups(display_name correction): neither grants any authenticated
-- INSERT/UPDATE/DELETE (see the two preceding migrations), so ordinary
-- users - including an Event's own owner - cannot mutate classification
-- through any other path, matching #158 "classification導入を理由に
-- ordinary authenticated userへshared write authorityを広げない". The
-- calling script (scripts/import-catalog-events.mjs, extended by this
-- Task) is Issue #167's scope, not this migration's - this only
-- materializes the boundary that script consumes, mirroring how
-- 20260828000300_create_import_ticket_opportunity_rpc.sql gave the
-- Ticket Opportunity import script its atomic write path.
--
-- Two independent "touch this facet or not" flags (p_set_genre /
-- p_set_groups) are what let a re-import correct genre and/or groups
-- without being forced to also touch the other, and let an old seed with
-- no classification fields at all leave existing classification
-- completely untouched (Issue #167 "既存seedを突然壊す必要がなければ
-- optional extensionを優先") - the calling script only ever passes
-- p_set_genre/p_set_groups = true for a field the seed entry actually
-- names, never as a blanket "always overwrite" default. Within a touched
-- facet, "clear" is expressed explicitly (p_genre_key = null while
-- p_set_genre = true; p_groups = '[]' while p_set_groups = true) rather
-- than conflated with "not specified" - the same "genre訂正/genre解除/
-- group追加/削除/置換" requirement #157's TicketOpportunity import RPC
-- meets with its own replace-all-on-touch semantics.
--
-- SECURITY INVOKER (the default), matching every other import RPC in this
-- schema: this function is only ever reachable by service_role (see the
-- revoke/grant below), which already carries the underlying table
-- privileges and BYPASSRLS, so running as the caller keeps this from
-- becoming a privilege-escalation surface if the EXECUTE grant is ever
-- loosened.
create function public.import_event_classification(
  p_event_id uuid,
  p_set_genre boolean default false,
  p_genre_key text default null,
  p_set_groups boolean default false,
  p_groups jsonb default '[]'::jsonb
) returns public.events
language plpgsql
set search_path = ''
as $$
declare
  v_event public.events;
  v_genre_id uuid;
  v_group_ids uuid[];
begin
  if p_event_id is null then
    raise exception 'event id is required' using errcode = '22004';
  end if;

  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then
    raise exception 'event % not found', p_event_id using errcode = '22023';
  end if;

  if p_set_genre then
    if p_genre_key is not null then
      select id into v_genre_id from public.genres where key = p_genre_key;
      -- Defense-in-depth: the calling script's seed validator already
      -- rejects an unknown genre key before any RPC call is made (Issue
      -- #167 "unknown genre identity" required validation), but this
      -- table's real authority is the DB, not the script - a stale
      -- script/seed pairing must not be able to silently create an event
      -- pointing at a genre that does not exist.
      if v_genre_id is null then
        raise exception 'unknown genre key: %', p_genre_key using errcode = '22023';
      end if;
    else
      -- Explicit clear: p_set_genre = true with p_genre_key = null is how
      -- the calling script represents "this re-import removes the
      -- Event's genre" (Issue #167 "genre解除"), not "leave unchanged" -
      -- leaving unchanged is p_set_genre = false, checked above.
      v_genre_id := null;
    end if;

    -- Conditional, not unconditional (mirrors import_update_event's own
    -- "an UPDATE that writes back the same values still counts as a real
    -- update to events_set_updated_at" comment): a re-import that
    -- reaffirms the same genre a re-run apart must not bump
    -- events.updated_at every time, or an operator re-running the same
    -- reviewed seed with no actual change would see every reclassified
    -- Event's updated_at drift forward for no product reason.
    if v_event.genre_id is distinct from v_genre_id then
      update public.events set genre_id = v_genre_id where id = p_event_id
      returning * into v_event;
    end if;
  end if;

  if p_set_groups then
    if p_groups is null or jsonb_typeof(p_groups) <> 'array' then
      raise exception 'groups must be a json array' using errcode = '22023';
    end if;

    -- Defense-in-depth, mirroring the genre check above: the calling
    -- script's validator already rejects a malformed/empty key or
    -- displayName (Issue #167 "malformed group entry").
    if exists (
      select 1
      from jsonb_array_elements(p_groups) as elem
      where btrim(coalesce(elem ->> 'key', '')) = ''
         or btrim(coalesce(elem ->> 'displayName', '')) = ''
    ) then
      raise exception 'each group entry requires a non-empty key and displayName'
        using errcode = '22023';
    end if;

    -- Canonical group identity resolve-or-create-or-correct, keyed on the
    -- stable `key` (#158 "同じ「月組」や「Meme Tokyo」をimportのたびに
    --別group rowとして増やさない" / "stable canonical group identityで
    -- resolve/upsert可能にする"): re-importing the same key with a
    -- corrected displayName updates the existing canonical row in place
    -- rather than creating a second one. `distinct` collapses an
    -- identical (key, displayName) pair repeated in the payload; a
    -- differing displayName for the same key within one payload is left
    -- to surface as a Postgres "ON CONFLICT DO UPDATE command cannot
    -- affect row a second time" error - the calling script's validator is
    -- the primary defense against that case ("duplicate group within one
    -- Event seed" / "inconsistent classification payload").
    with input_groups as (
      select distinct
        btrim(elem ->> 'key') as key,
        btrim(elem ->> 'displayName') as display_name
      from jsonb_array_elements(p_groups) as elem
    )
    insert into public.groups (key, display_name)
    select key, display_name from input_groups
    on conflict (key) do update set display_name = excluded.display_name;

    select array_agg(g.id) into v_group_ids
    from public.groups g
    where g.key in (
      select distinct btrim(elem ->> 'key') from jsonb_array_elements(p_groups) as elem
    );

    -- Replace-all on the touched facet (#167 "Current reviewed seedを
    -- そのEventのclassification truthとして扱うreplace-style semantics
    -- は採用可"): a group removed from the source seed disappears from
    -- this Event's associations on the next import rather than lingering,
    -- the same convergent-on-current-content semantics
    -- import_ticket_opportunity uses for milestones/target occurrences.
    -- This never deletes a `groups` row itself (a group referenced by no
    -- Event is simply an unreferenced canonical identity, not orphaned
    -- data - #158 defines no group deletion/lifecycle operation), only
    -- this Event's own event_groups edges.
    delete from public.event_groups where event_id = p_event_id;

    if v_group_ids is not null then
      insert into public.event_groups (event_id, group_id)
      select p_event_id, gid from unnest(v_group_ids) as gid;
    end if;
  end if;

  return v_event;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation - see
-- 20260823040000_create_import_event_with_occurrences_rpc.sql for why
-- anon/authenticated are also named explicitly rather than relying on the
-- PUBLIC revoke alone.
revoke execute on function public.import_event_classification(
  uuid, boolean, text, boolean, jsonb
) from public;
revoke execute on function public.import_event_classification(
  uuid, boolean, text, boolean, jsonb
) from anon, authenticated;
grant execute on function public.import_event_classification(
  uuid, boolean, text, boolean, jsonb
) to service_role;

-- Deliberately NOT here:
-- - catalog_creators membership validation, unlike
--   import_event_with_occurrences. That check defends the "who may create
--   an Event" boundary; this function never creates or reassigns an
--   Event, only classifies one that already exists, and requires no
--   p_owner_id at all.
-- - Any heuristic/inferred classification of an Event this call is not
--   explicitly told to classify. Issue #167 "既存Event data": an Event
--   this RPC is never called for (p_set_genre/p_set_groups both left
--   false, or the RPC never called at all) stays exactly as classified
--   (or unclassified) as it already was.
