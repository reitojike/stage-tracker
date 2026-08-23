// My Calendar composition (Issue #34): pure, DB-free derivation that merges
// three already-fetched personal planning slices - participation-registered
// occurrences, event-independent personal schedule (own + shared), and
// ticket acquisition state - into one calendar-day index a presentation
// layer can render directly, plus the weekday/Japanese-holiday role from
// calendarDayRole.ts.
//
// This module never queries Supabase and never re-derives visibility: the
// caller (src/app/calendar/page.tsx) is expected to have already fetched
// exactly what RLS allows the current caller to see (listMyParticipations,
// listVisiblePersonalSchedule, listMyAcquisitions - all in
// src/infrastructure/supabase/) and to hand that data in here as-is. This
// module performs no additional filtering that could substitute for RLS.
//
// Scope note (Issue #34 Task Contract "In scope"): this is a day-level
// marker/list composition, not the Event Catalog's band-run layout
// (calendarMonth.ts's isBandEvent/computeBandSegments/layoutWeekBands) -
// run-period/band presentation for My Calendar is explicitly left open by
// docs/ux-ui.md ("本ドキュメントで固定しないもの": run-period / rest-dayの
// calendar上の表示方法), so this module only needs to answer "what touches
// this day" and "how many", not "how to lay out a multi-day band".

import { addDaysToDate, compareDates } from './calendarMonth.ts';
import { calendarDayRole, type CalendarDayRole } from './calendarDayRole.ts';
import {
  compareOccurrencesByStartsAt,
  tokyoCalendarDateFromInstant,
  type EventCatalogEvent,
  type EventOccurrence,
  type EventWithOccurrences,
} from './eventCatalog.ts';
import type { Participation } from './participation.ts';
import type { PersonalScheduleEntry } from './personalSchedule.ts';
import type { TicketAcquisition } from './ticketAcquisition.ts';

// --- Occurrence + participation + ticket state ---

/**
 * A ticket acquisition's display state, aggregated across every acquisition
 * attempt the caller has made for one occurrence (product-rules.md allows
 * multiple attempts per occurrence/user). Priority, most-resolved first:
 * any `secured` attempt means the occurrence is covered, regardless of how
 * many other attempts failed; otherwise any `pending` attempt means the
 * outcome is still open; `'unsuccessful'` only when every attempt is
 * unsuccessful; `'none'` when the caller never opened an acquisition at
 * all for this occurrence. `'none'` and `'pending'` are exactly the two
 * states Issue #34's acceptance criteria calls "pending/unconfirmed" - both
 * need a visible, non-color-only marker in the calendar presentation.
 */
export type TicketDisplayStatus = 'none' | 'pending' | 'secured' | 'unsuccessful';

export function aggregateTicketDisplayStatus(
  acquisitions: readonly TicketAcquisition[],
): TicketDisplayStatus {
  if (acquisitions.length === 0) {
    return 'none';
  }
  if (acquisitions.some((acquisition) => acquisition.status === 'secured')) {
    return 'secured';
  }
  if (acquisitions.some((acquisition) => acquisition.status === 'pending')) {
    return 'pending';
  }
  return 'unsuccessful';
}

export interface MyCalendarOccurrenceEntry {
  event: EventCatalogEvent;
  occurrence: EventOccurrence;
  participation: Participation;
  ticketStatus: TicketDisplayStatus;
}

/**
 * Every occurrence the caller has participation-registered (Issue #34 MVP
 * surface: "participation登録済みoccurrence表示"), paired with that
 * participation row and the caller's aggregated ticket state for it.
 * `eventsWithOccurrences` should already be scoped to whatever range the
 * caller fetched (src/app/calendar/page.tsx); an occurrence with no entry
 * in `participationsByOccurrenceId` is simply not participation-registered
 * and is excluded here - this list is deliberately narrower than "every
 * occurrence in range" (that is the Event Catalog's own concern, not My
 * Calendar's).
 */
export function buildMyCalendarOccurrenceEntries(
  eventsWithOccurrences: readonly EventWithOccurrences[],
  participationsByOccurrenceId: ReadonlyMap<string, Participation>,
  acquisitionsByOccurrenceId: ReadonlyMap<string, readonly TicketAcquisition[]>,
): MyCalendarOccurrenceEntry[] {
  const entries: MyCalendarOccurrenceEntry[] = [];
  for (const { event, occurrences } of eventsWithOccurrences) {
    for (const occurrence of occurrences) {
      const participation = participationsByOccurrenceId.get(occurrence.id);
      if (participation === undefined) {
        continue;
      }
      const acquisitions = acquisitionsByOccurrenceId.get(occurrence.id) ?? [];
      entries.push({
        event,
        occurrence,
        participation,
        ticketStatus: aggregateTicketDisplayStatus(acquisitions),
      });
    }
  }
  return entries;
}

/** Every entry on `date` (Asia/Tokyo calendar day), sorted by occurrence
 * start time - the selected-day full-detail escape hatch, matching
 * calendarMonth.ts's selectDayOccurrences convention for the Event
 * Catalog. */
export function selectMyCalendarOccurrenceEntries(
  entries: readonly MyCalendarOccurrenceEntry[],
  date: string,
): MyCalendarOccurrenceEntry[] {
  return entries
    .filter((entry) => tokyoCalendarDateFromInstant(entry.occurrence.startsAt) === date)
    .sort((a, b) => compareOccurrencesByStartsAt(a.occurrence, b.occurrence));
}

// --- Event-independent personal schedule ---

/**
 * Every Asia/Tokyo calendar date `entry` is active on, clipped to
 * `[rangeFirstDate, rangeLastDate]` (inclusive both ends - matching
 * calendarMonth.ts's MonthGrid.gridFirstDate/gridLastDate convention, so a
 * caller can pass the displayed grid's own bounds directly). Bounded by
 * that clip, never by the entry's own (potentially far wider) span, so
 * this always terminates in at most the grid's own day count regardless of
 * how long the underlying entry runs.
 *
 * A time-bounded entry with no endsAt (product-rules.md: unset end is a
 * legitimate state, never implicitly defaulted) is treated as active only
 * on its start date for calendar-marker purposes - extending it forward
 * indefinitely would be exactly the implicit "assume it ends today/soon"
 * default product-rules.md rules out, just inverted into "assume it never
 * ends". The entry's own detail (still reachable via the selected-day
 * list) continues to show the unresolved end exactly as scheduleTemporalLabel
 * already renders it.
 */
export function scheduleEntryDatesInRange(
  entry: PersonalScheduleEntry,
  rangeFirstDate: string,
  rangeLastDate: string,
): string[] {
  const [entryStartDate, entryEndDate] =
    entry.temporal.kind === 'all-day'
      ? [entry.temporal.startsOn, entry.temporal.endsOn]
      : [
          tokyoCalendarDateFromInstant(entry.temporal.startsAt),
          entry.temporal.endsAt === null
            ? tokyoCalendarDateFromInstant(entry.temporal.startsAt)
            : tokyoCalendarDateFromInstant(entry.temporal.endsAt),
        ];

  const clippedStart =
    compareDates(entryStartDate, rangeFirstDate) > 0 ? entryStartDate : rangeFirstDate;
  const clippedEnd = compareDates(entryEndDate, rangeLastDate) < 0 ? entryEndDate : rangeLastDate;
  if (compareDates(clippedStart, clippedEnd) > 0) {
    return [];
  }

  const dates: string[] = [];
  let cursor = clippedStart;
  while (compareDates(cursor, clippedEnd) <= 0) {
    dates.push(cursor);
    cursor = addDaysToDate(cursor, 1);
  }
  return dates;
}

export interface MyCalendarScheduleEntry {
  entry: PersonalScheduleEntry;
  /** True when the caller is this entry's owner; false when it was shared
   * with them (entry.ownerId !== callerId). Both are visible via the same
   * listVisiblePersonalSchedule read (RLS already merges owner-or-shared),
   * so this is the only signal a presentation layer needs to label
   * "自分の予定" vs. "共有されている予定" (matching src/app/schedule/page.tsx's
   * existing convention). */
  isOwner: boolean;
}

/** Every visible schedule entry active on `date`, each paired with its
 * owner/shared distinction for this caller. */
export function selectMyCalendarScheduleEntries(
  entries: readonly PersonalScheduleEntry[],
  callerId: string,
  date: string,
  rangeFirstDate: string,
  rangeLastDate: string,
): MyCalendarScheduleEntry[] {
  return entries
    .filter((entry) =>
      scheduleEntryDatesInRange(entry, rangeFirstDate, rangeLastDate).includes(date),
    )
    .map((entry) => ({ entry, isOwner: entry.ownerId === callerId }));
}

// --- Per-day markers for the month view ---

export interface MyCalendarDayMarkers {
  date: string;
  role: CalendarDayRole;
  occurrenceCount: number;
  /** True when at least one occurrence on this day has a `'none'` or
   * `'pending'` ticketStatus (Issue #34 acceptance: "ticket pending/
   * unconfirmed状態を色だけに依存せず識別可能"). */
  hasUnconfirmedTicket: boolean;
  ownScheduleCount: number;
  sharedScheduleCount: number;
}

/**
 * Builds one MyCalendarDayMarkers per date in `gridDates` (the whole
 * displayed grid, including lead/trail days - matching
 * calendarMonth.buildMonthGrid's own weeks.flat() shape), from the same
 * occurrence-entry and schedule-entry sets a selected-day view would use.
 */
export function buildMyCalendarDayMarkers(
  gridDates: readonly string[],
  occurrenceEntries: readonly MyCalendarOccurrenceEntry[],
  scheduleEntries: readonly PersonalScheduleEntry[],
  callerId: string,
): MyCalendarDayMarkers[] {
  if (gridDates.length === 0) {
    return [];
  }
  const rangeFirstDate = gridDates[0];
  const rangeLastDate = gridDates[gridDates.length - 1];
  if (rangeFirstDate === undefined || rangeLastDate === undefined) {
    return [];
  }

  return gridDates.map((date) => {
    const dayOccurrences = selectMyCalendarOccurrenceEntries(occurrenceEntries, date);
    const daySchedules = selectMyCalendarScheduleEntries(
      scheduleEntries,
      callerId,
      date,
      rangeFirstDate,
      rangeLastDate,
    );
    return {
      date,
      role: calendarDayRole(date),
      occurrenceCount: dayOccurrences.length,
      hasUnconfirmedTicket: dayOccurrences.some(
        (entry) => entry.ticketStatus === 'none' || entry.ticketStatus === 'pending',
      ),
      ownScheduleCount: daySchedules.filter((s) => s.isOwner).length,
      sharedScheduleCount: daySchedules.filter((s) => !s.isOwner).length,
    };
  });
}
