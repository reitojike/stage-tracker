-- Event-independent personal schedule (Issue #31): MVP persistence, sharing,
-- and RLS baseline. See .ai-dev-foundation/product-rules.md
-- ("Event-independent personal schedule") for the approved product
-- semantics this migration implements.
--
-- Product semantics:
-- - A schedule entry is independent of the event catalog (public.events /
--   public.event_occurrences): it is not a `blocked` boolean, and it is not
--   linked to any event/occurrence row.
-- - Every entry has exactly one of two temporal shapes, never a mix:
--     * all-day (single-day or multi-day): a closed [starts_on, ends_on]
--       date range with no time-of-day. Represented as plain `date`, not
--       timestamptz, because an all-day entry is a calendar-date concept
--       (Asia/Tokyo date boundary per product-rules.md), not an instant.
--     * time-bounded: starts_at is required; ends_at may be left unset
--       (an unknown end time is a legitimate state, mirroring
--       event_occurrences.ends_at - see
--       20260821000000_create_event_occurrences.sql).
--   personal_schedule_entries_temporal_shape enforces this at the DB level
--   so a caller can never silently persist an ambiguous or mixed row (e.g.
--   is_all_day = true with starts_at set, or ends_on before starts_on).
-- - schedule_type is a closed MVP vocabulary (paid_leave / work / travel /
--   other); enforced with a CHECK rather than a Postgres enum so adding a
--   value later is a plain migration, not a type-alteration.
-- - Creator = owner (owner_id, immutable after insert - see the owner_id
--   UPDATE grant omission below, mirroring events.owner_id).
-- - Default visibility is private: an entry is readable only by its owner
--   until explicitly shared (see personal_schedule_shares below). This is
--   the opposite default from the shared events catalog, so there is no
--   "select using (true)" policy here.
-- - Deletion is out of scope for this slice, mirroring events/
--   event_occurrences: no deleted_at, no DELETE policy.
create table public.personal_schedule_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id),
  schedule_type text not null check (schedule_type in ('paid_leave', 'work', 'travel', 'other')),
  memo text,
  is_all_day boolean not null,
  starts_on date,
  ends_on date,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_schedule_entries_temporal_shape check (
    (
      is_all_day
      and starts_on is not null
      and ends_on is not null
      and ends_on >= starts_on
      and starts_at is null
      and ends_at is null
    )
    or (
      not is_all_day
      and starts_at is not null
      and starts_on is null
      and ends_on is null
      and (ends_at is null or ends_at >= starts_at)
    )
  )
);

create index personal_schedule_entries_owner_id_idx on public.personal_schedule_entries (owner_id);

-- Mirrors public.set_events_updated_at(): search_path is pinned empty
-- (Postgres function_search_path_mutable hardening) since the function
-- body only touches NEW/now(), which are resolved without any schema
-- lookup.
create function public.set_personal_schedule_entries_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger personal_schedule_entries_set_updated_at
  before update on public.personal_schedule_entries
  for each row
  execute function public.set_personal_schedule_entries_updated_at();

alter table public.personal_schedule_entries enable row level security;

-- Sharing (Issue #31): a minimal, independent record of "who this entry has
-- been explicitly shared with". Sharing takes effect immediately on insert
-- (no approval flow/state machine); a share row's mere existence is the
-- sharing state. A row has nothing mutable on it - editing "the share"
-- means removing and re-adding it (add/remove is the only supported
-- operation), so there is no UPDATE policy or grant below.
--
-- The unique constraint prevents duplicate shares of the same entry to the
-- same recipient from accumulating as separate rows.
create table public.personal_schedule_shares (
  id uuid primary key default gen_random_uuid(),
  schedule_entry_id uuid not null references public.personal_schedule_entries (id),
  shared_with_user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (schedule_entry_id, shared_with_user_id)
);

create index personal_schedule_shares_schedule_entry_id_idx
  on public.personal_schedule_shares (schedule_entry_id);
create index personal_schedule_shares_shared_with_user_id_idx
  on public.personal_schedule_shares (shared_with_user_id);

alter table public.personal_schedule_shares enable row level security;

-- Grants are additive to RLS, not a substitute for it - local Supabase does
-- not auto-expose newly created tables to PostgREST roles, so authenticated
-- needs explicit grants to reach the policies below at all, and service_role
-- needs its own table-level grant despite BYPASSRLS (see the comment in
-- 20260820000000_create_events.sql for the full rationale). anon
-- intentionally receives no grant on either table below, which is what
-- makes anonymous access impossible regardless of the policies defined.
--
-- Column-level grants are the system-managed-field boundary on
-- personal_schedule_entries: id, created_at, and updated_at are never
-- grantable. owner_id remains grantable on INSERT only (constrained there
-- by personal_schedule_entries_insert_own's WITH CHECK, the creator = owner
-- rule) and is withheld entirely on UPDATE, which blocks ownership transfer
-- even before RLS is evaluated - mirroring events.owner_id.
grant select, insert, update, delete on public.personal_schedule_entries to service_role;

grant select on public.personal_schedule_entries to authenticated;
grant insert (owner_id, schedule_type, memo, is_all_day, starts_on, ends_on, starts_at, ends_at)
  on public.personal_schedule_entries to authenticated;
grant update (schedule_type, memo, is_all_day, starts_on, ends_on, starts_at, ends_at)
  on public.personal_schedule_entries to authenticated;

grant select, insert, update, delete on public.personal_schedule_shares to service_role;

grant select on public.personal_schedule_shares to authenticated;
grant insert (schedule_entry_id, shared_with_user_id) on public.personal_schedule_shares to authenticated;
grant delete on public.personal_schedule_shares to authenticated;
-- No UPDATE grant: see the "nothing mutable on a share row" note above.

-- Owner always sees their own entries; a recipient sees an entry only once
-- explicitly shared with them (personal_schedule_shares row exists). This
-- is the private-by-default / explicit-share boundary from
-- product-rules.md, enforced independently of any application-layer query
-- shape.
create policy personal_schedule_entries_select_owner_or_shared
  on public.personal_schedule_entries
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1
      from public.personal_schedule_shares s
      -- Qualified as personal_schedule_entries.id, not bare `id`: the
      -- subquery's own FROM (personal_schedule_shares) also has an `id`
      -- column (its own PK), and an unqualified `id` here resolves to the
      -- innermost scope (s.id) per SQL name resolution, not the outer row
      -- - silently comparing s.schedule_entry_id to s.id and making this
      -- branch permanently near-always-false instead of correlating to the
      -- entry actually being selected. Reproduced against real local
      -- Postgres: a shared recipient could not read the entry at all
      -- before this qualification.
      where s.schedule_entry_id = personal_schedule_entries.id
        and s.shared_with_user_id = auth.uid()
    )
  );

create policy personal_schedule_entries_insert_own
  on public.personal_schedule_entries
  for insert
  to authenticated
  with check (owner_id = auth.uid());

-- Only the owner can ever match this USING/WITH CHECK - a recipient a row
-- was shared with has no UPDATE path here, which is what makes
-- "shared user cannot edit the entry" true independent of the UI.
create policy personal_schedule_entries_update_own
  on public.personal_schedule_entries
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- The three shares-side policies below need "is auth.uid() the owner of
-- the referenced entry" as a condition. A raw correlated subquery on
-- personal_schedule_entries here (as used before this was reproduced
-- against real local Postgres) re-triggers that table's own SELECT policy
-- (personal_schedule_entries_select_owner_or_shared above), which itself
-- subqueries personal_schedule_shares - an unconditional mutual reference
-- that Postgres detects as "infinite recursion detected in policy for
-- relation \"personal_schedule_entries\"" on every insert/select/delete
-- touching either table, not merely a slow query. A SECURITY DEFINER
-- function resolves ownership by reading personal_schedule_entries as its
-- owner role (which bypasses RLS on this local/CI setup, matching
-- create_event_with_occurrence's rationale above), breaking the cycle
-- without changing what the check requires: still an exact
-- owner_id = auth.uid() match, nothing more permissive. It intentionally
-- takes no target-user argument (only entry_id) and reads auth.uid()
-- internally, so exposing it as a PostgREST RPC (`public` schema, EXECUTE
-- granted to authenticated below - the same defense-in-depth revoke-then-
-- grant as the RPC above) only ever answers "do I own this entry", which
-- callers already know from their own rows and is not a new information
-- disclosure.
create function public.is_personal_schedule_entry_owner(p_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.personal_schedule_entries e
    where e.id = p_entry_id
      and e.owner_id = auth.uid()
  );
$$;

revoke execute on function public.is_personal_schedule_entry_owner(uuid) from public;
grant execute on function public.is_personal_schedule_entry_owner(uuid) to authenticated;

-- A share is visible to the two parties it actually concerns: the entry
-- owner (who manages all recipients) and the recipient themselves (who
-- needs to see their own share rows in order to remove themselves - see the
-- DELETE policy below). No one else can enumerate an entry's recipients.
create policy personal_schedule_shares_select_owner_or_recipient
  on public.personal_schedule_shares
  for select
  to authenticated
  using (
    shared_with_user_id = auth.uid()
    or public.is_personal_schedule_entry_owner(schedule_entry_id)
  );

-- Only the owner of the referenced entry can add a recipient - a recipient
-- cannot add further recipients on an entry they don't own, even one that
-- has been shared with them ("shared user ... 他recipient管理不可").
create policy personal_schedule_shares_insert_owner
  on public.personal_schedule_shares
  for insert
  to authenticated
  with check (public.is_personal_schedule_entry_owner(schedule_entry_id));

-- Two independent grounds for removing a share row: the entry owner can
-- remove any recipient (including one that isn't the caller), and a
-- recipient can remove only their own row (self-removal). A recipient can
-- never delete another recipient's share - that requires the owner branch,
-- which a non-owning recipient never satisfies.
create policy personal_schedule_shares_delete_owner_or_self
  on public.personal_schedule_shares
  for delete
  to authenticated
  using (
    shared_with_user_id = auth.uid()
    or public.is_personal_schedule_entry_owner(schedule_entry_id)
  );
