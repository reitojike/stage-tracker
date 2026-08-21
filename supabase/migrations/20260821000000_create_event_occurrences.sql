-- Event occurrences / 公演回 (Issue #17): each event has one or more
-- occurrences, previously only representable as a single flat
-- events.starts_at/ends_at interval.
--
-- This migration only establishes occurrence persistence, RLS, and grants.
-- See the following migration for backfilling existing
-- events.starts_at/ends_at into occurrence rows and dropping those columns
-- from events, and the migration after that for the create RPC that
-- replaces direct authenticated INSERT on events.
--
-- Product semantics (see .ai-dev-foundation/product-rules.md and Issue #17):
-- - An occurrence always belongs to exactly one event and has no
--   independent owner; create/update permission is derived from the
--   parent event's owner_id.
-- - starts_at is required; ends_at may be unset. An unknown end time is
--   not converted to an implicit default.
-- - Reassigning an occurrence to a different parent event is not a
--   supported operation.
-- - Deletion/cancellation is out of scope for this slice: no deleted_at,
--   no DELETE policy.

create table public.event_occurrences (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index event_occurrences_event_id_idx on public.event_occurrences (event_id);

-- Mirrors public.set_events_updated_at(): search_path is pinned empty
-- (Postgres function_search_path_mutable hardening) since the function
-- body only touches NEW/now(), which are resolved without any schema
-- lookup.
create function public.set_event_occurrences_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger event_occurrences_set_updated_at
  before update on public.event_occurrences
  for each row
  execute function public.set_event_occurrences_updated_at();

alter table public.event_occurrences enable row level security;

-- Grants are additive to RLS, not a substitute for it - see the comment in
-- 20260820000000_create_events.sql for why authenticated needs explicit
-- grants at all, and why service_role needs its own table-level grant
-- despite BYPASSRLS.
--
-- Column-level grants are the system-managed-field boundary: id,
-- created_at, and updated_at are never grantable. event_id remains
-- grantable on INSERT because event_occurrences_insert_own's WITH CHECK is
-- what constrains it there (parent event ownership); on UPDATE it is
-- withheld entirely, which blocks reassigning an occurrence to a different
-- event even before RLS is evaluated.
grant select, insert, update, delete on public.event_occurrences to service_role;

grant select on public.event_occurrences to authenticated;
grant insert (event_id, starts_at, ends_at) on public.event_occurrences to authenticated;
grant update (starts_at, ends_at) on public.event_occurrences to authenticated;

-- Occurrences are visible as part of the shared event catalog, same as
-- events themselves - no independent per-occurrence privacy.
create policy event_occurrences_select_authenticated
  on public.event_occurrences
  for select
  to authenticated
  using (true);

-- event_id is part of the INSERT column grant above (so a client can
-- target a specific event), but this WITH CHECK still requires the caller
-- to own that event - it does not permit inserting an occurrence for
-- someone else's event.
create policy event_occurrences_insert_own
  on public.event_occurrences
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.events e
      where e.id = event_id
        and e.owner_id = auth.uid()
    )
  );

-- event_id has no UPDATE column grant (see above), so USING here is what
-- actually gates non-owner updates; WITH CHECK is symmetric defense-in-
-- depth in case that grant is ever loosened.
create policy event_occurrences_update_own
  on public.event_occurrences
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.events e
      where e.id = event_id
        and e.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.events e
      where e.id = event_id
        and e.owner_id = auth.uid()
    )
  );
