-- Atomic operator-import create path (Issue #73, closure review finding).
--
-- 20260823030000_add_events_source_key.sql made operator import idempotent,
-- but the create path in scripts/import-catalog-events.mjs still wrote the
-- event row and its occurrences as two separate PostgREST requests. A
-- compensating DELETE was added for the case where the occurrence INSERT
-- returns an error, and that is not enough: if the event INSERT commits and
-- its response is lost, or the process is killed between the two requests,
-- nothing runs the compensation and a zero-occurrence event stays in the
-- shared catalog, visible to every authenticated user.
--
-- "An event has >= 1 occurrence" (product-rules.md D4) is the same
-- invariant create_event_with_occurrence holds for the UI path, and it is
-- held there by doing both inserts inside one function call. This function
-- gives the operator path that same guarantee: one call, one transaction,
-- so either the event and all of its occurrences exist or none of them do.
-- No client-side compensation is involved, and no abort window remains.
--
-- Deliberately NOT a change to the user-facing path: this does not touch
-- create_event_with_occurrence, its designated-creator check, RLS, grants,
-- or any auth flow. It adds a second create path that only service_role can
-- reach.
--
-- SECURITY INVOKER (the default), unlike create_event_with_occurrence's
-- SECURITY DEFINER. That RPC has to run as its owner because a normal
-- authenticated client has no INSERT grant on events at all. This one is
-- only ever called by service_role, which already carries the table
-- privileges and BYPASSRLS, so running as the caller keeps it from becoming
-- a privilege-escalation surface: if the EXECUTE grant below were ever
-- loosened, the caller would still be stopped by table grants and RLS
-- rather than borrowing this function's owner rights.
create function public.import_event_with_occurrences(
  p_owner_id uuid,
  p_source_key text,
  p_title text,
  p_occurrences jsonb,
  p_venue text default null,
  p_source_url text default null,
  p_memo text default null
) returns public.events
language plpgsql
set search_path = ''
as $$
declare
  v_event public.events;
  v_inserted integer;
  v_expected integer;
begin
  if p_owner_id is null then
    raise exception 'owner is required' using errcode = '22004';
  end if;

  if p_source_key is null or btrim(p_source_key) = '' then
    -- This function is the *import* create path; an entry with no source
    -- identity has no idempotency key and would be indistinguishable from a
    -- manually created event on the next run.
    raise exception 'source_key is required for an imported event' using errcode = '22004';
  end if;

  -- The invariant this function exists for. Checked before the event row is
  -- written, so an empty payload cannot create an event at all.
  if p_occurrences is null
    or jsonb_typeof(p_occurrences) <> 'array'
    or jsonb_array_length(p_occurrences) = 0 then
    raise exception 'an imported event must have at least one occurrence'
      using errcode = '23514';
  end if;

  -- Defence in depth for the MVP Event catalog write boundary. The calling
  -- script checks catalog_creators membership too, but service_role bypasses
  -- RLS and the check inside create_event_with_occurrence, so without this
  -- the only thing standing between an operator mistake and a catalog entry
  -- owned by a non-creator would be client-side code. This does not widen
  -- the boundary: the same membership table decides both paths.
  if not exists (
    select 1
    from public.catalog_creators cc
    where cc.user_id = p_owner_id
  ) then
    raise exception 'event creation is restricted to designated catalog creators'
      using errcode = '42501';
  end if;

  insert into public.events (owner_id, title, venue, source_url, memo, source_key)
  values (p_owner_id, p_title, p_venue, p_source_url, p_memo, p_source_key)
  returning * into v_event;

  insert into public.event_occurrences (event_id, starts_at, ends_at)
  select
    v_event.id,
    (element ->> 'startsAt')::timestamptz,
    (element ->> 'endsAt')::timestamptz
  from jsonb_array_elements(p_occurrences) as element;

  -- A malformed element that yields no row would otherwise pass silently and
  -- produce an event with fewer occurrences than the operator reviewed. Any
  -- raise here rolls the whole call back, including the event row.
  get diagnostics v_inserted = row_count;
  v_expected := jsonb_array_length(p_occurrences);
  if v_inserted <> v_expected then
    raise exception 'expected % occurrences, inserted %', v_expected, v_inserted
      using errcode = '23514';
  end if;

  return v_event;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation, and
-- every role (anon and authenticated included) is implicitly a member of
-- PUBLIC, so this must be revoked explicitly before granting to
-- service_role alone. anon and authenticated are additionally revoked by
-- name so this file states the reachable-caller set outright rather than
-- relying on the PUBLIC revoke to have covered them.
revoke execute on function public.import_event_with_occurrences(
  uuid, text, text, jsonb, text, text, text
) from public;
revoke execute on function public.import_event_with_occurrences(
  uuid, text, text, jsonb, text, text, text
) from anon, authenticated;
grant execute on function public.import_event_with_occurrences(
  uuid, text, text, jsonb, text, text, text
) to service_role;

-- Deliberately NOT here:
-- - An ends_at >= starts_at check. That invariant is Issue #46's, and
--   adding it only on this path would make the operator path stricter than
--   every other write path in the schema.
-- - Rejection of duplicate starts_at within the payload. Whether
--   (event_id, starts_at) must be unique is Issue #79's product question;
--   the calling script rejects duplicates within a single seed entry, and
--   pre-empting the decision here would create the invariant by the back
--   door.
