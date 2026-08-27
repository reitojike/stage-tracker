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
// Band/dot scope (Issue #142, superseding #34's original "run-period
// presentation is out of scope" note): My Calendar now follows the same
// multi-day-band/single-day-dot marker rule the Event Catalog uses
// (calendarMonth.ts's own layoutWeekBands, reused directly rather than
// re-implemented - see buildMyCalendarWeekBandLayouts below), for both of
// its entry kinds - a participation-registered occurrence whose Event spans
// multiple days, and a personal-schedule entry whose own span does.

import {
  addDaysToDate,
  compareDates,
  isSingleDayEvent,
  layoutWeekBands,
  MAX_BAND_LANES,
  selectEventLevelFallback,
  type BandSegment,
  type WeekBandLayout,
} from './calendarMonth.ts';
import {
  calendarDayRole,
  isWithinJapaneseHolidayDataCoverage,
  type CalendarDayRole,
} from './calendarDayRole.ts';
import { isEventCanceled } from './eventCancellation.ts';
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

/**
 * The selected-day counterpart to a multi-day Event band (Issue #142):
 * events the caller participates in (has at least one occurrence entry for)
 * whose Event range covers `date` but have no actual occurrence on it -
 * same complement relationship calendarMonth.ts's own
 * selectEventLevelFallback has with selectDayOccurrences for the Event
 * Catalog. Without this, a day inside a multi-day Event's band the caller
 * is attending/considering, but with no occurrence that specific day, would
 * show My Calendar's own "no entries" empty state despite the band visibly
 * covering it - this closes that gap by reusing calendarMonth.ts's own
 * selector rather than re-deriving the range-membership check, narrowed to
 * only the Events `occurrenceEntries` actually names (My Calendar must
 * never surface a catalog Event the caller has no participation in at all).
 */
export function selectMyCalendarEventLevelFallback(
  eventsWithOccurrences: readonly EventWithOccurrences[],
  occurrenceEntries: readonly MyCalendarOccurrenceEntry[],
  date: string,
): EventWithOccurrences[] {
  const participatingEventIds = new Set(occurrenceEntries.map((entry) => entry.event.id));
  return selectEventLevelFallback(eventsWithOccurrences, date).filter((group) =>
    participatingEventIds.has(group.event.id),
  );
}

/**
 * A cheap, UTC-date-slice pre-filter callers (src/app/calendar/page.tsx)
 * can apply *before* fetching event/occurrence detail for a set of
 * occurrence ids, to avoid resolving occurrences far outside the displayed
 * grid. This is deliberately a superset, never exact: the authoritative
 * per-day membership is always tokyoCalendarDateFromInstant, applied by
 * selectMyCalendarOccurrenceEntries/buildMyCalendarDayMarkers once the full
 * occurrence set is available - this function only needs to never exclude
 * an occurrence that truly belongs in the grid.
 *
 * Since Asia/Tokyo is UTC+9, an instant's true Tokyo calendar date is
 * always its UTC-sliced date or one day *later* (never earlier) - e.g.
 * `startsAt = "2026-07-31T16:30:00Z"` has UTC date "2026-07-31" but Tokyo
 * date "2026-08-01" (01:30 JST). So the lower bound must be widened by one
 * day to remain a safe superset (an occurrence starting between
 * 00:00-08:59 JST on `gridFirstDate` has a UTC-sliced date of
 * `gridFirstDate` minus one day); the upper bound needs no such widening,
 * since a UTC-sliced date can never be *later* than the true Tokyo date. A
 * previous revision of this check compared the UTC-sliced date directly
 * against `gridFirstDate` with no widening, which silently excluded any
 * occurrence starting 00:00-08:59 JST on the grid's first displayed day.
 */
export function isOccurrenceStartUtcDateInGridSuperset(
  occurrenceStartsAtUtc: string,
  gridFirstDate: string,
  gridLastDate: string,
): boolean {
  const occurrenceUtcDate = occurrenceStartsAtUtc.slice(0, 10);
  const lowerBound = addDaysToDate(gridFirstDate, -1);
  return occurrenceUtcDate >= lowerBound && occurrenceUtcDate <= gridLastDate;
}

// --- Event-independent personal schedule ---

/**
 * `entry`'s own Asia/Tokyo calendar date span, unclipped - the same
 * start/end derivation scheduleEntryDatesInRange (below) uses before
 * clipping to a displayed range, factored out so buildMyCalendarBandSegments
 * and isSingleDayScheduleEntry (both below) can classify an entry's
 * single-day/multi-day shape without re-deriving this. A time-bounded entry
 * with no endsAt is single-day here too (its own start date only) - same
 * "never implicitly extend an unresolved end" rule scheduleEntryDatesInRange
 * documents.
 */
function scheduleEntryDateRange(entry: PersonalScheduleEntry): {
  startDate: string;
  endDate: string;
} {
  if (entry.temporal.kind === 'all-day') {
    return { startDate: entry.temporal.startsOn, endDate: entry.temporal.endsOn };
  }
  const startDate = tokyoCalendarDateFromInstant(entry.temporal.startsAt);
  const endDate =
    entry.temporal.endsAt === null
      ? startDate
      : tokyoCalendarDateFromInstant(entry.temporal.endsAt);
  return { startDate, endDate };
}

/**
 * True iff `entry`'s own span (scheduleEntryDateRange) is exactly one
 * calendar day - the same single-day/multi-day classification
 * calendarMonth.ts's isSingleDayEvent applies to Events, mirrored here for
 * personal schedule entries (Issue #142: "複数日にまたがるものは帯、単日は
 * dot。イベントと個人予定で同じ規則").
 */
export function isSingleDayScheduleEntry(entry: PersonalScheduleEntry): boolean {
  const { startDate, endDate } = scheduleEntryDateRange(entry);
  return startDate === endDate;
}

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
  const { startDate: entryStartDate, endDate: entryEndDate } = scheduleEntryDateRange(entry);

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

// --- Multi-day band segments (Issue #142) ---
//
// Issue #142 unifies the Event Catalog's own multi-day/single-day marker
// rule ("複数日にまたがるものは帯、単日は dot") across My Calendar too, for
// both of its two entry kinds: a participation-registered occurrence whose
// *Event* spans multiple days, and a personal-schedule entry whose own span
// (scheduleEntryDateRange above) does. Both reuse calendarMonth.ts's own
// layoutWeekBands - the lane-packing/overflow algorithm is not
// feature-specific - via the shared MyCalendarBandSegment shape below, which
// extends BandSegment with the blocking/non-blocking (fill vs. outline) axis
// and which of the two source kinds a segment came from.

export interface MyCalendarBandSegment extends BandSegment {
  kind: 'event' | 'schedule';
  /** Fill (true) vs. outline (false) - Issue #142's shared axis: a
   * confirmed/attending Event or a `blocking` schedule entry fills, a
   * considering-only Event or a `non-blocking` schedule entry outlines. */
  blocking: boolean;
}

/**
 * One band segment per distinct multi-day Event the caller has at least one
 * attending/considering occurrence for, deduplicated by event id (an event
 * with several participation-registered occurrences still bands once - same
 * "one Event, one band" rule calendarMonth.ts's own eventRangeBandSegment
 * follows). The segment spans the full Event range (starts_on..ends_on), not
 * just the caller's own occurrence dates - matching calendarMonth.ts's
 * "band means the officially published run period, independent of
 * occurrence evidence" rule (product-rules.md "Event 開催期間"), so My
 * Calendar's own band for the same Event is never a narrower shape than the
 * Event Catalog's. A single-day Event never contributes here (isSingleDayEvent) -
 * it is represented by the per-day dot instead (see computeDotState below).
 *
 * `blocking` is true iff at least one of the caller's occurrences for this
 * Event is `attending` - present alongside any `considering`-only occurrence
 * for the same Event, attending is the more committed state and wins (same
 * "attending is the fill signal" priority the per-day dot uses).
 */
export function buildMyCalendarEventBandSegments(
  occurrenceEntries: readonly MyCalendarOccurrenceEntry[],
): MyCalendarBandSegment[] {
  const byEventId = new Map<string, { event: EventCatalogEvent; blocking: boolean }>();
  for (const { event, participation } of occurrenceEntries) {
    if (isSingleDayEvent(event)) {
      continue;
    }
    const existing = byEventId.get(event.id);
    const blocking = (existing?.blocking ?? false) || participation.status === 'attending';
    byEventId.set(event.id, { event, blocking });
  }
  return [...byEventId.values()].map(({ event, blocking }) => ({
    eventId: event.id,
    eventTitle: event.title,
    startDate: event.startsOn,
    endDate: event.endsOn,
    isCanceled: isEventCanceled(event),
    kind: 'event',
    blocking,
  }));
}

/**
 * One band segment per visible multi-day personal-schedule entry (own or
 * shared) - a single-day entry never contributes here (isSingleDayScheduleEntry),
 * it is represented by the per-day dot instead. `blocking` is the entry's
 * own `blocking` field directly (product-rules.md: an attribute of the
 * entry itself, not per-recipient), so a schedule band's fill/outline reads
 * the same for the owner and every recipient it is shared with.
 */
export function buildMyCalendarScheduleBandSegments(
  entries: readonly PersonalScheduleEntry[],
): MyCalendarBandSegment[] {
  const segments: MyCalendarBandSegment[] = [];
  for (const entry of entries) {
    if (isSingleDayScheduleEntry(entry)) {
      continue;
    }
    const { startDate, endDate } = scheduleEntryDateRange(entry);
    segments.push({
      eventId: entry.id,
      eventTitle: entry.title,
      startDate,
      endDate,
      isCanceled: false,
      kind: 'schedule',
      blocking: entry.blocking,
    });
  }
  return segments;
}

/**
 * One WeekBandLayout per week in `gridWeeks` (same shape/order as
 * calendarMonth.buildMonthGrid's own MonthGrid.weeks), laying out this
 * caller's Event bands and personal-schedule bands together into the same
 * bounded lane set (MAX_BAND_LANES) - the two kinds share lane capacity on a
 * given day exactly like the Event Catalog's own bands do, per Issue #142's
 * "1セルの marker は最大3（dot 1個 + 帯 2本）" cap.
 */
export function buildMyCalendarWeekBandLayouts(
  gridWeeks: readonly (readonly string[])[],
  occurrenceEntries: readonly MyCalendarOccurrenceEntry[],
  scheduleEntries: readonly PersonalScheduleEntry[],
): WeekBandLayout<MyCalendarBandSegment>[] {
  const segments = [
    ...buildMyCalendarEventBandSegments(occurrenceEntries),
    ...buildMyCalendarScheduleBandSegments(scheduleEntries),
  ];
  return gridWeeks.map((weekDates) => layoutWeekBands(weekDates, segments, MAX_BAND_LANES));
}

// --- Per-day markers for the month view ---

/**
 * The unified dot state for one day (Issue #142): `'filled'` when a
 * confirmed/blocking single-day signal is present (an `attending`
 * single-day-Event occurrence, or a `blocking` single-day schedule entry),
 * `'outline'` when only a considering/non-blocking single-day signal is
 * present, `'none'` otherwise. Multi-day Events/entries never reach this -
 * they are represented by a band instead (see buildMyCalendarWeekBandLayouts
 * above), so a day's dot and its bands are always about disjoint sources,
 * the same "never the same thing twice" invariant calendarMonth.ts's own
 * badge/band split follows. At most one dot per day regardless of how many
 * qualifying single-day sources it has (Issue #142: "dot は1セル1個").
 */
export type MyCalendarDotState = 'filled' | 'outline' | 'none';

function computeDotState(
  dayOccurrences: readonly MyCalendarOccurrenceEntry[],
  daySchedules: readonly MyCalendarScheduleEntry[],
): MyCalendarDotState {
  const singleDayOccurrences = dayOccurrences.filter((entry) => isSingleDayEvent(entry.event));
  const singleDaySchedules = daySchedules.filter((s) => isSingleDayScheduleEntry(s.entry));

  const filled =
    singleDayOccurrences.some((entry) => entry.participation.status === 'attending') ||
    singleDaySchedules.some((s) => s.entry.blocking);
  if (filled) {
    return 'filled';
  }

  const outlined =
    singleDayOccurrences.some((entry) => entry.participation.status === 'considering') ||
    singleDaySchedules.some((s) => !s.entry.blocking);
  return outlined ? 'outline' : 'none';
}

export interface MyCalendarDayMarkers {
  date: string;
  role: CalendarDayRole;
  /** False when `date` falls outside the Japanese-holiday snapshot's
   * confirmed coverage range (`isWithinJapaneseHolidayDataCoverage`) - i.e.
   * `role` for this date could still change to `'holiday'` once the
   * Cabinet Office publishes that year, so presentation must show holiday
   * status as unconfirmed rather than silently rendering it as an
   * ordinary/confirmed-non-holiday day (PO adjudication, Issue #34). */
  holidayDataConfirmed: boolean;
  /** The unified single-day marker for this day - see computeDotState. */
  dot: MyCalendarDotState;
  /** Occurrences on this day whose participation.status is 'attending'
   * (Issue #92: month-calendar scanability requires attending/considering
   * to read as distinct signals, never collapsed into one generic
   * "participation-registered" count - a day with both must show both).
   * Kept as an aria-label/emptiness signal independent of `dot` above -
   * unlike `dot`, this counts every occurrence on the day regardless of
   * whether its Event is single- or multi-day (Issue #142's dot/band split
   * is a *visual* marker rule, not a narrower definition of "has
   * participation"). */
  attendingCount: number;
  /** Occurrences on this day whose participation.status is 'considering'. */
  consideringCount: number;
  /** True when at least one occurrence on this day has a `'none'` or
   * `'pending'` ticketStatus (Issue #34 acceptance: "ticket pending/
   * unconfirmed状態を色だけに依存せず識別可能"). Independent of
   * attending/considering - product-rules.md's ticket/participation
   * concepts stay separate here too. Issue #142's marker vocabulary has no
   * dedicated glyph for this (it never invents one - see that Issue's "Do
   * not invent product semantics"), so this is surfaced via aria-label text
   * only, not a visual cell marker. */
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
      holidayDataConfirmed: isWithinJapaneseHolidayDataCoverage(date),
      dot: computeDotState(dayOccurrences, daySchedules),
      attendingCount: dayOccurrences.filter((entry) => entry.participation.status === 'attending')
        .length,
      consideringCount: dayOccurrences.filter(
        (entry) => entry.participation.status === 'considering',
      ).length,
      hasUnconfirmedTicket: dayOccurrences.some(
        (entry) => entry.ticketStatus === 'none' || entry.ticketStatus === 'pending',
      ),
      ownScheduleCount: daySchedules.filter((s) => s.isOwner).length,
      sharedScheduleCount: daySchedules.filter((s) => !s.isOwner).length,
    };
  });
}
