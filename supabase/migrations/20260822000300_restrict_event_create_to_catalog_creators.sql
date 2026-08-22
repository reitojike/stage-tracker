-- Restrict Event creation to designated catalog creators (Issue #29).
--
-- 20260821000200_create_event_with_occurrence_rpc.sql made this RPC the
-- only path a normal authenticated client has for creating an event, so it
-- is also the only place the MVP creator restriction has to be enforced
-- for that client. The function body, its signature, its SECURITY DEFINER
-- execution, and the atomic event + initial occurrence create boundary are
-- otherwise unchanged: this migration adds a membership check and nothing
-- else. In particular, owner_id is still derived from auth.uid() (the
-- creator becomes the owner, per product-rules.md ownership semantics),
-- both inserts still happen in one function call that rolls back as a
-- unit, and no new parameter is introduced.

create or replace function public.create_event_with_occurrence(
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

  -- MVP Event catalog write boundary: creating a shared catalog entry is
  -- restricted to designated catalog creators (see
  -- 20260822000200_create_catalog_creators.sql). This runs SECURITY
  -- DEFINER, so the lookup is not itself filtered by
  -- catalog_creators_select_own - it sees the whole allowlist and checks
  -- the caller's own membership explicitly.
  --
  -- 42501 (insufficient_privilege) is raised rather than a bare exception
  -- so PostgREST answers 403 and the calling application can distinguish
  -- "you may not do this" from a validation or infrastructure failure -
  -- docs/ux-ui.md requires permission denial to be presented distinctly
  -- from an empty or failed read, which needs a distinguishable signal to
  -- rest on.
  if not exists (
    select 1
    from public.catalog_creators cc
    where cc.user_id = auth.uid()
  ) then
    raise exception 'event creation is restricted to designated catalog creators'
      using errcode = '42501';
  end if;

  -- owner_id is derived from the caller, never taken from an argument -
  -- there is no input surface for owner spoofing here. This function runs
  -- SECURITY DEFINER (as its owner, not the calling authenticated role),
  -- which is what lets it perform this INSERT despite the revoke in
  -- 20260821000200_create_event_with_occurrence_rpc.sql.
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

-- CREATE OR REPLACE preserves the existing privileges, so the revoke/grant
-- pair from 20260821000200_create_event_with_occurrence_rpc.sql still
-- holds. They are re-asserted here (both are idempotent) so this file
-- states the reachable-caller set outright rather than requiring a reader
-- to reconstruct it from the earlier migration.
revoke execute on function public.create_event_with_occurrence(
  text, timestamptz, text, timestamptz, text, text
) from public;
grant execute on function public.create_event_with_occurrence(
  text, timestamptz, text, timestamptz, text, text
) to authenticated;

-- Defense-in-depth on the direct-INSERT path. authenticated currently has
-- no INSERT grant on events at all (revoked in
-- 20260821000200_create_event_with_occurrence_rpc.sql), which makes this
-- policy unreachable today - it is kept, and now also carries the creator
-- restriction, so that re-granting INSERT in the future cannot silently
-- reopen event creation to every authenticated user. Without this, the
-- creator gate would live only inside the RPC body and would be exactly
-- one `grant insert` away from being bypassed.
drop policy events_insert_own on public.events;

create policy events_insert_own
  on public.events
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.catalog_creators cc
      where cc.user_id = auth.uid()
    )
  );
