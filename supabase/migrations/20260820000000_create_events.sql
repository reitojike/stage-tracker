-- Shared event catalog (PR B / Issue #3).
--
-- Product semantics (see .ai-dev-foundation/product-rules.md and Issue #3):
-- - events is a catalog shared across all authenticated users.
-- - owner_id is the creator; owner is an information manager only, not an
--   implied participant/organizer/inviter.
-- - Owner transfer is not a supported operation in this slice: UPDATE must
--   not be able to change owner_id.
-- - Deletion is out of scope for this slice: no deleted_at, no DELETE policy.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id),
  title text not null,
  venue text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  source_url text,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index events_owner_id_idx on public.events (owner_id);

-- Keep updated_at accurate on every real UPDATE, independent of what the
-- caller supplies for that column. search_path is pinned empty (Postgres
-- function_search_path_mutable hardening) since the function body only
-- touches NEW/now(), which are resolved without any schema lookup.
create function public.set_events_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger events_set_updated_at
  before update on public.events
  for each row
  execute function public.set_events_updated_at();

alter table public.events enable row level security;

-- Grants are additive to RLS, not a substitute for it: local Supabase does
-- not auto-expose newly created tables to PostgREST roles, so authenticated
-- needs explicit grants to reach the policies below at all. anon
-- intentionally receives no grant here.
--
-- Column-level grants are the system-managed-field boundary: id,
-- owner_id (on UPDATE), created_at, and updated_at are deliberately absent
-- from the authenticated grants below, so a normal authenticated client
-- cannot include them in an INSERT/UPDATE target list regardless of RLS.
-- owner_id remains grantable on INSERT because events_insert_own's WITH
-- CHECK is what constrains it there (creator ownership); on UPDATE it is
-- withheld entirely, which blocks owner transfer even before RLS is
-- evaluated.
-- service_role's BYPASSRLS role attribute bypasses the policies below, but
-- table-level privilege grants are a separate, still-enforced check by
-- PostgREST; without this, backend/admin access (including test fixture
-- setup/teardown) fails with a plain permission error before RLS is even
-- relevant.
grant select, insert, update, delete on public.events to service_role;

grant select on public.events to authenticated;
grant insert (owner_id, title, venue, starts_at, ends_at, source_url, memo)
  on public.events to authenticated;
grant update (title, venue, starts_at, ends_at, source_url, memo)
  on public.events to authenticated;

create policy events_select_authenticated
  on public.events
  for select
  to authenticated
  using (true);

create policy events_insert_own
  on public.events
  for insert
  to authenticated
  with check (owner_id = auth.uid());

-- WITH CHECK re-validates the *new* row, so owner_id = auth.uid() here
-- blocks both non-owner updates (USING) and any attempt - including by the
-- current owner - to change owner_id to someone else (WITH CHECK).
create policy events_update_own
  on public.events
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
