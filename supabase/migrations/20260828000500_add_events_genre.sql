-- Event optional single primary genre (Issue #167, PO decision #158).
--
-- 0..1 cardinality is expressed structurally: a single nullable FK column,
-- not a join table. #158 is explicit that a many-to-many genre mechanism
-- must not be built ahead of a concrete cross-genre need ("future-only
--理由でmany-to-many genre machineryを先行しない") - unlike groups
-- (event_groups, 20260828000400_create_event_classification.sql), which
-- #158 requires as 0..N from the start for festival/joint Events. If a
-- real multi-genre need appears later, that is a new product decision,
-- not something to pre-empt with unused join-table machinery today.
--
-- No ON DELETE action (defaults to RESTRICT): no genre deletion path
-- exists (the 3 Gate A genres are a seeded, operator-import-only lookup
-- table with no DELETE grant to anything but service_role, and no RPC
-- ever deletes a row from it), so there is nothing for this FK's delete
-- behavior to accommodate yet.
alter table public.events
  add column genre_id uuid references public.genres (id);

create index events_genre_id_idx on public.events (genre_id);

-- Deliberately NOT granted to authenticated, on either INSERT or UPDATE.
-- events' write grants are column-level (20260820000000_create_events.sql:
-- `grant update (title, venue, source_url, memo) ...`), and genre_id is
-- not named there or here - so even the Event's own owner cannot set it
-- through the ordinary owner-authenticated write path
-- (events_update_own), regardless of RLS. This is the write-boundary
-- decision Issue #167 requires directly: "classification導入を理由に
-- ordinary authenticated userへshared write authorityを広げない" - the
-- only path that can ever set genre_id is the service_role-only
-- import_event_classification RPC
-- (20260828000600_create_import_event_classification_rpc.sql), matching
-- how ticket_opportunities' entire authenticated write surface is import-
-- RPC-only from the start rather than an owner-authenticated column grant
-- narrowed after the fact.
--
-- SELECT needs no new grant: events' authenticated SELECT is table-level
-- (`grant select on public.events to authenticated`, unchanged since
-- 20260820000000_create_events.sql), which already covers this new
-- column - shared classification read (#158 "authenticated usersはEvent
-- classification/group associationをread可能") falls out of that
-- automatically. service_role likewise needs no new grant: its grant on
-- events is also table-level.
