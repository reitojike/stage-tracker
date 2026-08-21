-- Occurrence-level participation (Issue #30).
--
-- Product semantics (see .ai-dev-foundation/product-rules.md, "Participation"):
-- - Participation targets an occurrence (公演回), never an event. There is
--   deliberately no event_id here: an event-level participation would be a
--   second, competing representation of the same intent.
-- - MVP status vocabulary is exactly `considering` / `attending`.
--   `not_attending` is intentionally absent: the absence of a row already
--   means "not participating", and product-rules.md forbids duplicating
--   that state as a persisted status. Removing an enum value later is not
--   supported by Postgres, so this enum stays minimal on purpose.
-- - Visibility defaults to `private` (owner only); `public` means every
--   authenticated user. anon sees nothing either way.
-- - Participation intent and ticket acquisition are independent concepts:
--   nothing here references or is driven by ticket state.
--
-- Deliberately not implemented here (product-rules.md "先行実装しないもの"):
-- no invite approval states, no status history table, no event-level
-- "interested" flag.

create type public.participation_status as enum ('considering', 'attending');
create type public.participation_visibility as enum ('private', 'public');

create table public.occurrence_participations (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.event_occurrences (id),
  user_id uuid not null references auth.users (id),
  -- No default: a client must state which of the two MVP statuses it means.
  status public.participation_status not null,
  visibility public.participation_visibility not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One participation per (occurrence, user). Beyond deduplication, this is
  -- the concurrency boundary the invitation RPC relies on: it is what makes
  -- "create a `considering` row only if the invitee has no row yet" safe
  -- against a concurrent insert by the invitee themselves. See
  -- 20260822010200_create_invite_to_occurrence_rpc.sql.
  constraint occurrence_participations_occurrence_user_key unique (occurrence_id, user_id)
);

-- (occurrence_id, user_id) lookups are served by the unique constraint's
-- index; this covers the other direction ("all of my participations"), which
-- that index cannot serve because occurrence_id leads it.
create index occurrence_participations_user_id_idx on public.occurrence_participations (user_id);

-- Shared updated_at trigger function for the tables added by this Task.
-- public.set_events_updated_at() and
-- public.set_event_occurrences_updated_at() are identical in body but
-- predate this one; rewiring their triggers would mean touching tables
-- outside this Task's scope, so they are left as they are rather than
-- migrated here.
--
-- search_path is pinned empty (Postgres function_search_path_mutable
-- hardening) since the body only touches NEW/now(), which resolve without
-- any schema lookup.
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger occurrence_participations_set_updated_at
  before update on public.occurrence_participations
  for each row
  execute function public.set_updated_at();

alter table public.occurrence_participations enable row level security;

-- Grants are additive to RLS, not a substitute for it - see the comment in
-- 20260820000000_create_events.sql for why authenticated needs explicit
-- grants at all, and why service_role needs its own table-level grant
-- despite BYPASSRLS.
--
-- The blanket revoke first makes the column-level boundary below exact
-- rather than merely additive: whatever a future Supabase default-privilege
-- change might hand to PUBLIC/anon/authenticated on table creation, the
-- privileges that survive this migration are only the ones granted
-- explicitly underneath it. anon is named here so it is visibly closed, not
-- closed by omission.
revoke all on public.occurrence_participations from public, anon, authenticated;

grant select, insert, update, delete on public.occurrence_participations to service_role;

grant select on public.occurrence_participations to authenticated;
-- Column-level grants are the system-managed-field boundary: id,
-- created_at, and updated_at are never grantable. user_id is grantable on
-- INSERT because occurrence_participations_insert_own's WITH CHECK is what
-- constrains it there; on UPDATE it is withheld entirely, so a
-- participation can never be reassigned to another user even before RLS is
-- evaluated. occurrence_id is likewise INSERT-only: re-pointing an existing
-- participation at a different occurrence is not a supported operation.
grant insert (occurrence_id, user_id, status, visibility)
  on public.occurrence_participations to authenticated;
grant update (status, visibility) on public.occurrence_participations to authenticated;
-- DELETE is granted (unlike events/event_occurrences) because "no row" is
-- the canonical representation of "not participating": product-rules.md
-- rules out persisting `not_attending`, so withdrawing a participation has
-- to be expressible as removing the row. Without this, `considering` and
-- `attending` would be one-way doors. It only ever reaches the caller's own
-- rows (occurrence_participations_delete_own).
grant delete on public.occurrence_participations to authenticated;

-- Private is the default, so the shared-catalog "everyone can read"
-- treatment used for events/event_occurrences deliberately does not apply
-- here: a row is readable by its owner, or by any authenticated user only
-- once its owner has opted that row into `public`.
create policy occurrence_participations_select_visible
  on public.occurrence_participations
  for select
  to authenticated
  using (user_id = auth.uid() or visibility = 'public');

-- user_id is part of the INSERT column grant above (so a client can send
-- it), but this WITH CHECK requires it to be the caller: a participation
-- cannot be created on someone else's behalf through the table API. The
-- invitation RPC is the only thing that creates a row for another user, and
-- it does so as SECURITY DEFINER with its own hard-coded `considering`
-- status.
create policy occurrence_participations_insert_own
  on public.occurrence_participations
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- USING gates which rows the caller may touch; WITH CHECK re-validates the
-- resulting row. Together with the withheld user_id/occurrence_id UPDATE
-- grants, this is what makes "only the invitee themselves can move
-- `considering` -> `attending`" true: an inviter's UPDATE matches zero rows.
create policy occurrence_participations_update_own
  on public.occurrence_participations
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy occurrence_participations_delete_own
  on public.occurrence_participations
  for delete
  to authenticated
  using (user_id = auth.uid());
