-- Preserve existing events.starts_at / ends_at as occurrence rows, then
-- drop those columns so event temporal data has a single source of truth
-- (Issue #17).
--
-- This is wrapped in an explicit transaction (supabase's migration runner
-- does not itself wrap a migration file's statements in one, and `lock
-- table` below requires an active transaction block), so there is no point
-- at which the columns are gone without a corresponding occurrence row, no
-- point with both a flat interval and an occurrence row disagreeing, and
-- no window for a concurrent INSERT into events - still permitted at this
-- point in the migration sequence, since the following migration is what
-- revokes it - to commit a new row between this migration's snapshot read
-- and its column drop. Without the lock, such a row would be invisible to
-- the backfill SELECT and then have its starts_at/ends_at permanently
-- destroyed by DROP COLUMN with no occurrence ever created for it, rather
-- than merely being missed and left un-migrated.
--
-- Column drop automatically revokes any column-level privileges that
-- referenced starts_at/ends_at (e.g. the authenticated INSERT/UPDATE grants
-- in 20260820000000_create_events.sql); nothing else needs to reference
-- those columns after this migration.
begin;

lock table public.events in access exclusive mode;

insert into public.event_occurrences (event_id, starts_at, ends_at)
select id, starts_at, ends_at
from public.events;

alter table public.events
  drop column starts_at,
  drop column ends_at;

commit;
