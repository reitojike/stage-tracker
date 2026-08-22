// Event-independent personal schedule domain model (Issue #33), over the
// persistence/RLS baseline Issue #31 established
// (supabase/migrations/20260822000000_create_personal_schedule.sql).
//
// Product semantics (see .ai-dev-foundation/product-rules.md,
// "Event-independent personal schedule"):
// - Independent of the event catalog - not linked to any event/occurrence.
// - Exactly one of two temporal shapes, never a mix: all-day (single- or
//   multi-day, a closed [startsOn, endsOn] calendar-date range) or
//   time-bounded (startsAt required, endsAt optionally unset).
// - schedule_type is a closed MVP vocabulary: paid_leave / work / travel /
//   other.
// - Sharing is a separate concept from the entry itself: a share grants the
//   recipient read access to the *existing* entry, never mutation rights.
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs).

import { tokyoCalendarDayRangeUtc } from './eventCatalog.ts';
import { compareByFieldThenId, sortByFieldThenId } from './ordering.ts';

export type ScheduleType = 'paid_leave' | 'work' | 'travel' | 'other';

const SCHEDULE_TYPES: ReadonlySet<string> = new Set<ScheduleType>([
  'paid_leave',
  'work',
  'travel',
  'other',
]);

function isScheduleType(value: string): value is ScheduleType {
  return SCHEDULE_TYPES.has(value);
}

/**
 * The DB's temporal shape CHECK constraint
 * (personal_schedule_entries_temporal_shape) as a TypeScript discriminated
 * union, so "all-day" and "time-bounded" can never be represented with the
 * wrong fields present/absent on this side either.
 */
export type ScheduleTemporal =
  | { kind: 'all-day'; startsOn: string; endsOn: string }
  | { kind: 'time-bounded'; startsAt: string; endsAt: string | null };

export interface PersonalScheduleEntry {
  id: string;
  ownerId: string;
  scheduleType: ScheduleType;
  memo: string | null;
  temporal: ScheduleTemporal;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalScheduleEntryInput {
  scheduleType: ScheduleType;
  memo: string | null;
  temporal: ScheduleTemporal;
}

export interface ScheduleShare {
  id: string;
  scheduleEntryId: string;
  sharedWithUserId: string;
  createdAt: string;
}

/** The persistence row shape mapPersonalScheduleEntryRow expects, declared
 * locally matching the convention in domain/eventCatalog.ts's RawEventRow. */
export interface RawPersonalScheduleEntryRow {
  id: string;
  owner_id: string;
  schedule_type: string;
  memo: string | null;
  is_all_day: boolean;
  starts_on: string | null;
  ends_on: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RawScheduleShareRow {
  id: string;
  schedule_entry_id: string;
  shared_with_user_id: string;
  created_at: string;
}

function mapTemporal(row: RawPersonalScheduleEntryRow): ScheduleTemporal {
  if (row.is_all_day) {
    if (row.starts_on === null || row.ends_on === null) {
      throw new Error(`all-day personal schedule entry ${row.id} is missing starts_on/ends_on`);
    }
    return { kind: 'all-day', startsOn: row.starts_on, endsOn: row.ends_on };
  }
  if (row.starts_at === null) {
    throw new Error(`time-bounded personal schedule entry ${row.id} is missing starts_at`);
  }
  return { kind: 'time-bounded', startsAt: row.starts_at, endsAt: row.ends_at };
}

export function mapPersonalScheduleEntryRow(
  row: RawPersonalScheduleEntryRow,
): PersonalScheduleEntry {
  if (!isScheduleType(row.schedule_type)) {
    throw new Error(
      `personal schedule entry ${row.id} has an unrecognized schedule_type: ${row.schedule_type}`,
    );
  }
  return {
    id: row.id,
    ownerId: row.owner_id,
    scheduleType: row.schedule_type,
    memo: row.memo,
    temporal: mapTemporal(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapScheduleShareRow(row: RawScheduleShareRow): ScheduleShare {
  return {
    id: row.id,
    scheduleEntryId: row.schedule_entry_id,
    sharedWithUserId: row.shared_with_user_id,
    createdAt: row.created_at,
  };
}

/**
 * Converts a ScheduleTemporal into the four persistence columns it maps to.
 * The unused shape's columns are explicit nulls (not omitted), matching the
 * CHECK constraint's expectation that the *other* shape's columns are null,
 * not merely absent from the request body.
 */
export function temporalToColumns(temporal: ScheduleTemporal): {
  is_all_day: boolean;
  starts_on: string | null;
  ends_on: string | null;
  starts_at: string | null;
  ends_at: string | null;
} {
  if (temporal.kind === 'all-day') {
    return {
      is_all_day: true,
      starts_on: temporal.startsOn,
      ends_on: temporal.endsOn,
      starts_at: null,
      ends_at: null,
    };
  }
  return {
    is_all_day: false,
    starts_on: null,
    ends_on: null,
    starts_at: temporal.startsAt,
    ends_at: temporal.endsAt,
  };
}

/**
 * Deterministic ordering for a personal schedule listing: all-day entries
 * order by startsOn, time-bounded entries by startsAt - both are the
 * "when does this entry begin" field for their shape - with id as a stable
 * tie-breaker (see domain/ordering.ts).
 *
 * An all-day entry's startsOn ("YYYY-MM-DD") is converted to the UTC
 * instant its Asia/Tokyo calendar day begins at before comparing, rather
 * than compared as a bare date string against a full ISO timestamp
 * directly. Naive string comparison of the two different formats is not
 * equivalent to chronological order whenever they fall close together:
 * Tokyo's UTC+9 offset means a UTC timestamp from 15:00 onward already
 * belongs to the *next* Tokyo calendar day, so e.g. all-day "2026-01-01"
 * (Tokyo midnight = instant 2025-12-31T15:00:00Z) sorts after the
 * time-bounded instant "2025-12-31T16:00:00Z" as bare strings ("2026-..." >
 * "2025-...") even though 15:00Z is earlier than 16:00Z - the reverse of
 * the correct order. Converting both sides to actual UTC instants first
 * avoids that.
 */
function entryStart(entry: PersonalScheduleEntry): string {
  return entry.temporal.kind === 'all-day'
    ? tokyoCalendarDayRangeUtc(entry.temporal.startsOn).startUtc
    : entry.temporal.startsAt;
}

export function comparePersonalScheduleEntriesByStart(
  a: PersonalScheduleEntry,
  b: PersonalScheduleEntry,
): number {
  return compareByFieldThenId(a, b, entryStart);
}

export function sortPersonalScheduleEntries(
  entries: readonly PersonalScheduleEntry[],
): PersonalScheduleEntry[] {
  return sortByFieldThenId(entries, entryStart);
}
