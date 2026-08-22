-- Public schema client-role grant hardening (Issue #42).
--
-- Root cause: this local/CI Postgres stack has an ALTER DEFAULT PRIVILEGES
-- entry for role `postgres` in schema `public` (`postgres=arwdDxtm/postgres,
-- anon=Dxtm/postgres, authenticated=Dxtm/postgres` on relations) - every new
-- table created by `postgres` in `public` automatically gets `anon` and
-- `authenticated` = TRUNCATE + REFERENCES + TRIGGER + MAINTAIN (`Dxtm`),
-- independent of any GRANT statement the migration itself writes. A
-- migration that only ever *adds* grants (`grant select ...`,
-- `grant insert (...) ...`) never touches this residual ACL, so it survives
-- untouched next to the intended grants. TRUNCATE bypasses RLS entirely;
-- REFERENCES/TRIGGER/MAINTAIN are also not part of any intended client
-- boundary in this product.
--
-- 20260822010000_create_occurrence_participations.sql (Issue #30) was the
-- first migration to close this by revoking before granting, and
-- #32's tables (ticket_acquisitions/tickets/ticket_transfers) and
-- catalog_creators followed the same pattern. The tables created before
-- that convention existed - events, event_occurrences (PR B / Issue #17),
-- personal_schedule_entries, personal_schedule_shares (Issue #31) - never
-- got it, and #42's fresh actual-grant inventory (has_table_privilege /
-- information_schema.role_table_grants / pg_class.relacl against a
-- `db reset` local stack) confirms all four still carry `anon`/
-- `authenticated` = Dxtm today. Every other current `public` table
-- (catalog_creators, occurrence_invitations, occurrence_participations,
-- ticket_acquisitions, tickets, ticket_transfers) already revokes this and
-- needs no change here.
--
-- This migration only removes the residual Dxtm privileges and restores
-- exactly the current SELECT/INSERT/UPDATE/DELETE (including column-level)
-- grants each table actually has today - re-derived from a fresh grant
-- inventory against a `db reset` local stack, not copy-pasted from each
-- table's original creating migration - since later migrations narrowed
-- some of them further (most notably
-- 20260821000200_create_event_with_occurrence_rpc.sql revoking
-- authenticated's direct INSERT on public.events entirely once the RPC
-- became the only supported create path; re-granting it here would regress
-- that boundary). It does not change RLS policies, product semantics, or
-- any intended access boundary. `revoke all` clears column-level grants
-- too, so every column-scoped INSERT/UPDATE grant below is re-stated in
-- full, not just the table-level SELECT/DELETE ones.

revoke all on public.events from public, anon, authenticated;
revoke all on public.event_occurrences from public, anon, authenticated;
revoke all on public.personal_schedule_entries from public, anon, authenticated;
revoke all on public.personal_schedule_shares from public, anon, authenticated;

-- public.events: SELECT + UPDATE only. No authenticated INSERT grant -
-- 20260821000200_create_event_with_occurrence_rpc.sql revoked it once
-- create_event_with_occurrence() became the sole supported create path;
-- this table has never had an authenticated DELETE grant.
grant select on public.events to authenticated;
grant update (title, venue, source_url, memo) on public.events to authenticated;

-- public.event_occurrences: same intended grants as
-- 20260821000000_create_event_occurrences.sql (unchanged by later
-- migrations). No authenticated DELETE grant.
grant select on public.event_occurrences to authenticated;
grant insert (event_id, starts_at, ends_at) on public.event_occurrences to authenticated;
grant update (starts_at, ends_at) on public.event_occurrences to authenticated;

-- public.personal_schedule_entries: same intended grants as
-- 20260822000000_create_personal_schedule.sql (unchanged by later
-- migrations). No authenticated DELETE grant.
grant select on public.personal_schedule_entries to authenticated;
grant insert (owner_id, schedule_type, memo, is_all_day, starts_on, ends_on, starts_at, ends_at)
  on public.personal_schedule_entries to authenticated;
grant update (schedule_type, memo, is_all_day, starts_on, ends_on, starts_at, ends_at)
  on public.personal_schedule_entries to authenticated;

-- public.personal_schedule_shares: same intended grants as
-- 20260822000000_create_personal_schedule.sql (unchanged by later
-- migrations). No UPDATE grant - a share row has nothing mutable (add/
-- remove only).
grant select on public.personal_schedule_shares to authenticated;
grant insert (schedule_entry_id, shared_with_user_id) on public.personal_schedule_shares to authenticated;
grant delete on public.personal_schedule_shares to authenticated;

-- service_role keeps its full table-level grant on all four tables
-- (BYPASSRLS bypasses policies, but PostgREST still enforces table-level
-- privilege separately - see the comment in 20260820000000_create_events.sql).
-- `revoke all` above did not touch service_role (it was scoped to public,
-- anon, authenticated), so no re-grant is needed here; this is stated only
-- to make that omission legible rather than accidental.
