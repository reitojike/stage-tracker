-- Preserve existing events.starts_at / ends_at as occurrence rows, then
-- drop those columns so event temporal data has a single source of truth
-- (Issue #17). Both steps run in this migration's implicit transaction, so
-- there is no point at which the columns are gone without a corresponding
-- occurrence row, and no point with both a flat interval and an occurrence
-- row disagreeing.
--
-- Column drop automatically revokes any column-level privileges that
-- referenced starts_at/ends_at (e.g. the authenticated INSERT/UPDATE grants
-- in 20260820000000_create_events.sql); nothing else needs to reference
-- those columns after this migration.

insert into public.event_occurrences (event_id, starts_at, ends_at)
select id, starts_at, ends_at
from public.events;

alter table public.events
  drop column starts_at,
  drop column ends_at;
