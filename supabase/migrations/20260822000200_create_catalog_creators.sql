-- Designated catalog creator membership (Issue #29).
--
-- Product semantics (see .ai-dev-foundation/product-rules.md "MVP Event
-- catalog write boundary"): in MVP, creating an Event is restricted to a
-- designated catalog creator (Administrator); it is not open to every
-- authenticated user. Everything else about the catalog is unchanged -
-- shared read stays open to all authenticated users, the creator becomes
-- the event owner under the existing ownership semantics, and update /
-- occurrence management stay owner-only.
--
-- Why a capability-scoped allowlist table, and not the alternatives:
-- - Hard-coding a specific user UUID/email into a migration or into
--   application code is explicitly ruled out by product-rules.md
--   ("特定 user UUID を application code / migration へ hard-code
--   しません"). Membership therefore lives in data, granted out of band
--   through service_role, and no identity appears in this repository.
-- - A `profiles.is_admin` flag is explicitly listed under "先行実装
--   しないもの", and a general role/permission framework is out of scope
--   for this Task. This table is named after the one capability MVP
--   actually needs (creating shared catalog entries), not after a role,
--   so it does not grow into a generic admin system by accident: adding
--   an unrelated capability would require its own decision, not just a
--   new row here.
-- - A JWT custom claim would push this into auth-hook configuration that
--   lives outside repository migrations, which is a larger and less
--   bounded mechanism than this Task needs.
--
-- Deliberately NOT here: verification/moderation status for broadening
-- create permission later (product-rules.md's Post-MVP governance gate
-- owns that, and speculative schema for it is ruled out), and any notion
-- of revocation workflow beyond deleting the row.

create table public.catalog_creators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.catalog_creators enable row level security;

-- Grants are additive to RLS, not a substitute for it - see the comment in
-- 20260820000000_create_events.sql for why authenticated needs explicit
-- grants at all, and why service_role needs its own table-level grant
-- despite BYPASSRLS.
--
-- service_role is the *only* role with any write privilege here: granting
-- and revoking designated-creator membership is an operational step
-- performed with the service key (see scripts/grant-catalog-creator.mjs),
-- never something a normal authenticated client can do to itself or to
-- anyone else. authenticated deliberately receives no INSERT/UPDATE/DELETE
-- grant at all, so even a future permissive policy on this table could not
-- open a self-promotion path without also re-granting privileges here.
-- Strip the platform's residual default privileges before granting
-- anything deliberately. Supabase's default privileges on public leave a
-- newly created table carrying TRUNCATE, REFERENCES and TRIGGER for anon
-- and authenticated even though the DML privileges are not present. The
-- comment above claims this table has no write path for a normal client,
-- and TRUNCATE would falsify that claim: TRUNCATE is not filtered by RLS
-- at all, so one statement would empty the whole allowlist regardless of
-- catalog_creators_select_own. PostgREST exposes no TRUNCATE verb, so
-- this is defense-in-depth rather than a reachable hole today - but the
-- privilege posture of the table that gates event creation should be
-- stated here outright, not inherited from whatever the platform
-- defaults happen to be.
revoke all on public.catalog_creators from anon, authenticated;

grant select, insert, update, delete on public.catalog_creators to service_role;

grant select on public.catalog_creators to authenticated;

-- Own-row only, unlike events' `using (true)`: the UI needs to answer "may
-- *I* create an event?" so it can present the create affordance and a
-- permission-denial state honestly, and that question needs nothing beyond
-- the caller's own row. Exposing the full allowlist to every authenticated
-- user is not required by any approved product semantics, so it is not
-- granted. anon receives no grant and no policy.
create policy catalog_creators_select_own
  on public.catalog_creators
  for select
  to authenticated
  using (user_id = auth.uid());

-- ON DELETE CASCADE above, unlike events.owner_id's deliberate lack of an
-- ON DELETE action: an event row carries shared catalog data that must not
-- vanish silently with an account, whereas a membership row is meaningless
-- once the user it names is gone. This is a fixture/operational
-- convenience about permission bookkeeping only; it decides nothing about
-- event or occurrence deletion semantics, which remain out of scope.
