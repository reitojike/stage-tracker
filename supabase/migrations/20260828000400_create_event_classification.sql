-- Event Catalog genre/group classification (Issue #167, PO decision #158).
--
-- Product semantics (see .ai-dev-foundation/product-rules.md "Catalog
-- classification / venue boundary" and #158):
-- - An Event has an optional single primary genre (0..1) - classified or
--   unclassified are both valid states, and "unclassified" is never
--   represented as a fabricated "その他/未分類" row.
-- - Gate A's canonical genre identities are 宝塚/歌舞伎/アイドル, but a
--   lookup table + FK (rather than a DB enum/CHECK list) is used
--   deliberately: #158 requires this NOT be designed as a permanent
--   3-value closed world, and a future genre should be addable by
--   inserting a row, not by a schema migration that touches every
--   constraint naming the current three.
-- - 宝塚's 組 and idol の「グループ」share one generic canonical group
--   identity mechanism (this table), not per-genre columns
--   (`troupe`/`idol_group`) or per-genre tables - #158 "同じgeneric
--   canonical group identity mechanismへ載せる" / "troupe / idol_group
--   等のdomain-specific columnを分けて作らない". A group is not bound to a
--   genre by any column here; the association is purely through which
--   Events reference it via event_groups, which is what lets a future
--   cross-genre or multi-troupe joint Event exist without a schema change.
-- - Event <-> group is 0..N (event_groups below), representing festival/
--   joint-event Events with multiple associated groups.
--
-- Deliberately NOT here:
-- - venue classification: `events.venue` (existing nullable text) stays
--   the venue filter source unchanged - no venue master/canonical venue
--   identity table (#158 "canonical venue masterは作らない").
-- - alias/hierarchy/social-follow/recommendation metadata on groups - #158
--   "alias / hierarchy / recommendation / social-follow等のgeneric group
--   platformを作らない". Gate A needs only a stable canonical identity,
--   a display name, and the Event association below.
-- - raw group color / visual cue columns - deferred per #158 "raw color
--   code をdomain dataとしてこのTask群で追加しない".

create table public.genres (
  id uuid primary key default gen_random_uuid(),
  -- Stable canonical identity, independent of display_name (which is
  -- Japanese product-facing text) - matches the existing convention of
  -- English-slug identity + separate display text elsewhere in this
  -- schema (ticket_opportunities.target_scope, milestone_type, ...).
  key text not null unique,
  display_name text not null,
  -- Gate A's UI needs a fixed, deterministic 宝塚→歌舞伎→アイドル
  -- ordering (product-rules.md); a lookup table's row order is not
  -- itself deterministic, so this is stated as data rather than left to
  -- callers to hard-code the current 3 keys' relative order.
  sort_order smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.set_genres_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger genres_set_updated_at
  before update on public.genres
  for each row
  execute function public.set_genres_updated_at();

alter table public.genres enable row level security;

-- See 20260822093000_create_ticket_acquisitions.sql for why the blanket
-- revoke is required before granting anything back on this stack (default
-- privileges otherwise leave anon/authenticated with residual
-- TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on every new public table).
revoke all on public.genres from public, anon, authenticated;

grant select, insert, update, delete on public.genres to service_role;

-- Shared catalog data, read-only for ordinary authenticated users - #158
-- "authenticated usersはEvent classification/group associationをread可能".
-- No authenticated INSERT/UPDATE/DELETE grant: genre identities are
-- operator/import-managed only (see
-- 20260828000600_create_import_event_classification_rpc.sql), matching
-- how ticket_opportunities draws the same shared-read/operator-write
-- boundary.
grant select on public.genres to authenticated;

create policy genres_select_authenticated
  on public.genres
  for select
  to authenticated
  using (true);

-- Gate A canonical genre seed (#158). Associating an existing Event with
-- one of these is a separate, reviewed operator-import act (Issue #167
-- "既存Event data" - no heuristic backfill happens here); this only
-- creates the 3 canonical identities themselves so the import RPC has
-- something to resolve p_genre_key against from the first migration
-- onward.
insert into public.genres (key, display_name, sort_order) values
  ('takarazuka', '宝塚', 1),
  ('kabuki', '歌舞伎', 2),
  ('idol', 'アイドル', 3);

-- Canonical group identity (#158): shared by 宝塚's 組 and idol グループ
-- alike. key is a stable, human-reviewable identity chosen by the
-- operator/agent authoring an import seed (see the import runbook) -
-- independent of display_name, so correcting a display label (e.g. a
-- typo) never changes which Events a group is associated with and never
-- creates a duplicate row for what is really the same group.
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.set_groups_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger groups_set_updated_at
  before update on public.groups
  for each row
  execute function public.set_groups_updated_at();

alter table public.groups enable row level security;

revoke all on public.groups from public, anon, authenticated;

grant select, insert, update, delete on public.groups to service_role;

grant select on public.groups to authenticated;

create policy groups_select_authenticated
  on public.groups
  for select
  to authenticated
  using (true);

-- Event <-> group association (#158 "Event ↔ group は 0..N"). The primary
-- key itself is what makes a duplicate (event_id, group_id) pair
-- structurally impossible - Issue #167's "duplicate Event-group
-- association protection" requirement is enforced here, not left to
-- application-side deduplication.
--
-- group_id has no ON DELETE action (defaults to RESTRICT): unlike
-- events/occurrences, no group deletion path exists anywhere in this
-- Task (Gate A group management is import-only - #158 explicitly rules
-- out an alias/lifecycle platform), so there is nothing for this FK's
-- delete behavior to accommodate yet. event_id cascades because deleting
-- an Event (Issue #124's owner-only hard delete, "誤登録の除去") should
-- not be blocked by its own classification rows, matching how
-- ticket_opportunities.event_id also cascades from the same delete_event
-- path.
create table public.event_groups (
  event_id uuid not null references public.events (id) on delete cascade,
  group_id uuid not null references public.groups (id),
  created_at timestamptz not null default now(),
  primary key (event_id, group_id)
);

-- Supports catalog-wide "which groups exist for this genre" option
-- discovery (Issue #167 "Catalog-wide filter options"), which joins from
-- groups/genres through this table by group_id rather than event_id.
create index event_groups_group_id_idx on public.event_groups (group_id);

alter table public.event_groups enable row level security;

revoke all on public.event_groups from public, anon, authenticated;

grant select, insert, update, delete on public.event_groups to service_role;

grant select on public.event_groups to authenticated;

create policy event_groups_select_authenticated
  on public.event_groups
  for select
  to authenticated
  using (true);
