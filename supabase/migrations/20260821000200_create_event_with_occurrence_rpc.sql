-- Sole supported authenticated event-create path (Issue #17 / PO-approved
-- technical checkpoint, issue comment 5364910300).
--
-- Adding event_occurrences and moving events.starts_at/ends_at there does
-- not by itself guarantee "an event has >= 1 occurrence" (product-rules.md
-- D4): a foreign key only guarantees occurrence -> event, not the reverse,
-- and a direct authenticated INSERT into events would let a normal client
-- create a durable zero-occurrence event. This RPC creates an event and
-- its required initial occurrence atomically, and is the only path a
-- normal authenticated client has for creating an event at all (direct
-- INSERT on public.events is revoked below).
--
-- This is deliberately the minimal write boundary for create only: it does
-- not add bulk occurrence creation, a general CRUD/update RPC layer, or
-- service_role/direct-SQL-level enforcement (e.g. a constraint trigger) -
-- those are out of scope for this Task.
create function public.create_event_with_occurrence(
  p_title text,
  p_starts_at timestamptz,
  p_venue text default null,
  p_ends_at timestamptz default null,
  p_source_url text default null,
  p_memo text default null
) returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
begin
  -- Defense-in-depth: EXECUTE is restricted to authenticated below (never
  -- PUBLIC/anon), so this should be unreachable in practice, but owner_id
  -- is derived from auth.uid() below and must never be null.
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  -- owner_id is derived from the caller, never taken from an argument -
  -- there is no input surface for owner spoofing here. This function runs
  -- SECURITY DEFINER (as its owner, not the calling authenticated role),
  -- which is what lets it perform this INSERT despite the revoke below.
  insert into public.events (owner_id, title, venue, source_url, memo)
  values (auth.uid(), p_title, p_venue, p_source_url, p_memo)
  returning * into v_event;

  -- p_starts_at has no default, so PostgREST requires the caller to supply
  -- it; event_occurrences.starts_at is also NOT NULL as a second,
  -- independent enforcement layer. Either insert failing raises and rolls
  -- back this whole function call (both inserts), so the event and its
  -- initial occurrence are created atomically or not at all.
  insert into public.event_occurrences (event_id, starts_at, ends_at)
  values (v_event.id, p_starts_at, p_ends_at);

  return v_event;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation; every
-- role (including anon) is implicitly a member of PUBLIC, so this must be
-- revoked explicitly before granting only to authenticated.
revoke execute on function public.create_event_with_occurrence(
  text, timestamptz, text, timestamptz, text, text
) from public;
grant execute on function public.create_event_with_occurrence(
  text, timestamptz, text, timestamptz, text, text
) to authenticated;

-- Direct authenticated INSERT into events is no longer a supported
-- operation now that the RPC above is the only path that can satisfy the
-- >= 1 occurrence invariant for a normal client. events_insert_own (from
-- 20260820000000_create_events.sql) is intentionally left in place rather
-- than dropped: with no INSERT grant, it is unreachable via this revoke
-- alone, but it remains a second, independent layer (its WITH CHECK still
-- requires owner_id = auth.uid()) if that grant is ever loosened again.
revoke insert on public.events from authenticated;
