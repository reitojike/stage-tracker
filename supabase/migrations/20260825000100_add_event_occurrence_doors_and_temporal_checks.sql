-- 開場 / 開演 / 終演 (Issue #87 product decision, #88 implementation).
--
-- event_occurrences gains doors_at (開場, nullable - an unpublished doors
-- time is a legitimate state, same treatment as ends_at). starts_at keeps
-- meaning 開演 (unchanged). This also lands Issue #46's
-- ends_at >= starts_at hardening at the DB level: it was previously
-- enforced only in src/domain/eventCatalogWrite.ts's parseOccurrence
-- (see that file's comment on the now-superseded gap), so every existing
-- row has already been going through a write path that held this rule -
-- the ALTER below fails loudly rather than silently succeeding if that
-- turns out not to hold for some row.
alter table public.event_occurrences
  add column doors_at timestamptz;

alter table public.event_occurrences
  add constraint event_occurrences_doors_at_le_starts_at
  check (doors_at is null or doors_at <= starts_at);

alter table public.event_occurrences
  add constraint event_occurrences_starts_at_le_ends_at
  check (ends_at is null or starts_at <= ends_at);

-- Additive to the existing insert/update column grants from
-- 20260821000000_create_event_occurrences.sql (see events_starts_on note
-- in 20260825000000_add_event_range.sql for why a bare `grant ... (col)`
-- is safe to add here rather than needing to restate starts_at/ends_at).
grant insert (doors_at) on public.event_occurrences to authenticated;
grant update (doors_at) on public.event_occurrences to authenticated;
