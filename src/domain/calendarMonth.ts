// Pure month-calendar presentation derivation for the Event Catalog vertical
// slice (Issue #20). Everything in this module is derived, read-only
// presentation computed from an already-fetched EventWithOccurrences[] (see
// eventCatalog.ts / Issue #12) - it never queries Supabase, never persists
// anything, and never introduces a run-period/category/priority source of
// truth beyond what is deterministically computable from the occurrence set
// itself.
//
// PO decision this module encodes (Issue #20 Task Contract - "PO-approved
// calendar / presentation decision", C+B hybrid - this is a checkpoint
// recorded on the Issue, not a section of .ai-dev-foundation/product-rules.md):
// - an event is a month-view "band" iff its (fetched) occurrences fall on
//   >= 2 distinct Asia/Tokyo calendar days - see isBandEvent.
// - a band is never drawn across a day it has no occurrence evidence for -
//   see computeBandSegments, which breaks at any gap in the date set.
// - a day's badge number counts only *non-band* occurrences on that day -
//   see computeBadgeCounts. A band's own occurrences are already visible as
//   the band itself, so counting them again would double the same
//   information.
//
// Band/badge classification is derived only from whatever occurrence range
// the caller fetched for the current view (src/app/catalog/page.tsx fetches
// the whole displayed grid, including lead/trail days). A run that extends
// mostly outside that range can therefore classify differently on an
// adjacent month's page - the same bounded-per-view tradeoff any calendar
// UI has when it does not fetch every month an event ever touches. Full,
// range-independent detail for a single event remains available via the
// event detail page (getEventWithOccurrences).

import {
  compareOccurrencesByStartsAt,
  parseTokyoCalendarDate,
  tokyoCalendarDateFromInstant,
  type EventCatalogEvent,
  type EventOccurrence,
  type EventWithOccurrences,
} from './eventCatalog.ts';

// --- Plain "YYYY-MM-DD" calendar-date arithmetic ---
//
// This is proleptic-Gregorian calendar math (weekday-of / add-days /
// days-in-month), which is independent of any timezone offset: the weekday
// and length of "2026-08-21" do not depend on Asia/Tokyo vs. UTC. Only
// tokyoCalendarDateFromInstant (eventCatalog.ts) needs the actual +9h
// offset, to decide which calendar date a UTC instant belongs to in the
// first place. Date.UTC(y, m-1, d) is used purely as calendar arithmetic
// here, never compared against a real instant.
//
// Parsing/validating a "YYYY-MM-DD" string reuses eventCatalog.ts's
// parseTokyoCalendarDate rather than a second, shape-only regex: that
// function's Date.UTC round-trip is what rejects a format-valid but
// calendar-invalid value (month 13, Feb 30, or a 1-2 digit year that would
// hit JS's legacy Date.UTC 19xx remap) instead of silently normalizing it
// into a different real date - see addDaysToDate/monthBounds below, which
// would otherwise happily compute a boundary for the wrong month/year.

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDaysToDate(dateStr: string, days: number): string {
  const { year, month, day } = parseTokyoCalendarDate(dateStr);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return formatDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

export function compareDates(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function weekdayOf(dateStr: string): number {
  const { year, month, day } = parseTokyoCalendarDate(dateStr);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** True iff `dateStr` is both shape- and calendar-valid ("2026-02-30" and
 * "2026-13-01" are rejected, not silently rolled over). */
export function isValidCalendarDate(dateStr: string): boolean {
  try {
    parseTokyoCalendarDate(dateStr);
    return true;
  } catch {
    return false;
  }
}

/** True iff `yearMonth` is a shape- and range-valid "YYYY-MM" (month 01-12;
 * also rejects a 1-2 digit year that would hit JS's legacy Date.UTC 19xx
 * remap, via the same round-trip technique parseTokyoCalendarDate uses for
 * days). */
export function isValidYearMonth(yearMonth: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match) {
    return false;
  }
  const [, yearStr, monthStr] = match;
  if (yearStr === undefined || monthStr === undefined) {
    return false;
  }
  const year = Number(yearStr);
  const month = Number(monthStr);
  const roundTrip = new Date(Date.UTC(year, month - 1, 1));
  return roundTrip.getUTCFullYear() === year && roundTrip.getUTCMonth() === month - 1;
}

/** First/last calendar date of a "YYYY-MM" month. Caller must ensure
 * `yearMonth` is valid (isValidYearMonth) - an invalid month throws here
 * rather than silently rolling over, since Date.UTC's own month/year
 * normalization would otherwise compute bounds for a different month. */
export function monthBounds(yearMonth: string): { firstDate: string; lastDate: string } {
  if (!isValidYearMonth(yearMonth)) {
    throw new Error(`expected a valid "YYYY-MM" month, got: ${yearMonth}`);
  }
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const firstDate = formatDate(year, month, 1);
  // Date.UTC(year, month, 0) is day 0 of the *next* month, i.e. the last
  // day of `month` itself (month here is already 1-indexed).
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDate = formatDate(year, month, lastDay);
  return { firstDate, lastDate };
}

export interface MonthGrid {
  yearMonth: string;
  /** First/last date actually displayed, including lead/trail days from
   * the adjacent month needed to fill the first/last week. A caller that
   * fetches occurrences for the *displayed* range (not just the calendar
   * month) should use these, so lead/trail cells reflect real data instead
   * of always appearing empty. */
  gridFirstDate: string;
  gridLastDate: string;
  /** Sunday-start weeks; each has exactly 7 "YYYY-MM-DD" dates. Feature-local
   * presentation choice - the exact week-start convention is left open
   * upstream (docs/ux-ui.md). */
  weeks: string[][];
}

export function buildMonthGrid(yearMonth: string): MonthGrid {
  const { firstDate, lastDate } = monthBounds(yearMonth);
  const leadDays = weekdayOf(firstDate);
  const gridFirstDate = addDaysToDate(firstDate, -leadDays);
  const trailDays = 6 - weekdayOf(lastDate);
  const gridLastDate = addDaysToDate(lastDate, trailDays);

  const weeks: string[][] = [];
  let cursor = gridFirstDate;
  while (compareDates(cursor, gridLastDate) <= 0) {
    const week: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(cursor);
      cursor = addDaysToDate(cursor, 1);
    }
    weeks.push(week);
  }
  return { yearMonth, gridFirstDate, gridLastDate, weeks };
}

/**
 * An event is rendered as a month-view band iff its occurrences (within
 * whatever range was fetched) fall on 2 or more distinct Asia/Tokyo
 * calendar days. A single calendar day with several occurrences (e.g. a
 * matinee + evening show) is not by itself a "run": it stays a normal
 * (non-band) entry, so its occurrences still count toward that day's
 * badge. This is a deterministic rule over existing occurrence data only -
 * no persistent category/priority is introduced.
 */
export function isBandEvent(occurrences: readonly EventOccurrence[]): boolean {
  const distinctDays = new Set(
    occurrences.map((occ) => tokyoCalendarDateFromInstant(occ.startsAt)),
  );
  return distinctDays.size >= 2;
}

export interface BandSegment {
  eventId: string;
  eventTitle: string;
  startDate: string;
  endDate: string;
}

/**
 * Splits one (band) event's occurrence dates into maximal runs of
 * *consecutive* calendar days. A day with no occurrence for this event
 * breaks the run into a separate segment - a band is never drawn across a
 * rest day it has no occurrence evidence for.
 */
export function computeBandSegments(
  event: EventCatalogEvent,
  occurrences: readonly EventOccurrence[],
): BandSegment[] {
  const dates = [
    ...new Set(occurrences.map((occ) => tokyoCalendarDateFromInstant(occ.startsAt))),
  ].sort(compareDates);

  const segments: BandSegment[] = [];
  let segmentStart: string | undefined;
  let segmentEnd: string | undefined;
  for (const date of dates) {
    if (segmentStart === undefined || segmentEnd === undefined) {
      segmentStart = date;
      segmentEnd = date;
      continue;
    }
    if (addDaysToDate(segmentEnd, 1) === date) {
      segmentEnd = date;
    } else {
      segments.push({
        eventId: event.id,
        eventTitle: event.title,
        startDate: segmentStart,
        endDate: segmentEnd,
      });
      segmentStart = date;
      segmentEnd = date;
    }
  }
  if (segmentStart !== undefined && segmentEnd !== undefined) {
    segments.push({
      eventId: event.id,
      eventTitle: event.title,
      startDate: segmentStart,
      endDate: segmentEnd,
    });
  }
  return segments;
}

/**
 * Per-day badge count: only occurrences belonging to *non-band* events
 * (isBandEvent === false) count. A band's own occurrences are already
 * visible as the band itself; counting them again here would double the
 * same information on the same day (Issue #20 PO decision: 日付badgeの
 * 数字はband対象公演をカウントしない). This holds regardless of whether
 * the band actually got a lane that week or overflowed (layoutWeekBands) -
 * making the badge depend on an unrelated event's lane pressure that week
 * would be more surprising than a day whose only performance is a band
 * one, which selectDayOccurrences always still surfaces on demand.
 */
export function computeBadgeCounts(
  eventsWithOccurrences: readonly EventWithOccurrences[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { occurrences } of eventsWithOccurrences) {
    if (isBandEvent(occurrences)) {
      continue;
    }
    for (const occurrence of occurrences) {
      const date = tokyoCalendarDateFromInstant(occurrence.startsAt);
      counts.set(date, (counts.get(date) ?? 0) + 1);
    }
  }
  return counts;
}

export interface PositionedBandSegment extends BandSegment {
  lane: number;
  /** 0-6 column index within the week, inclusive on both ends. */
  startCol: number;
  endCol: number;
}

export interface WeekBandLayout {
  weekStartDate: string;
  /** Bounded to at most `maxLanes` entries - see layoutWeekBands. */
  segments: PositionedBandSegment[];
  /** Count of additional *distinct events* active this week beyond the
   * lane cap (never double-counted when one event's run is itself split
   * into multiple segments by a rest day - see layoutWeekBands). Full
   * detail for any day in this week remains reachable via
   * selectDayOccurrences regardless of this overflow. */
  overflowCount: number;
}

/** Bounded lane count for month-view band rendering - mobile scanability
 * over showing every concurrent run (a bounded display + overflow
 * indicator is within the feature-local implementation discretion the
 * Issue #20 Task Contract leaves to this module). */
export const MAX_BAND_LANES = 3;

/**
 * Lays out the band segments active during one week (7 consecutive dates,
 * Sunday..Saturday) into a bounded number of non-overlapping lanes.
 * Segments are clipped to the week's own date range first: a run spanning
 * a week boundary produces one positioned segment per week it touches.
 *
 * Lane assignment is the standard interval-partitioning greedy: sort by
 * start column ascending (ties broken by the longer segment first, so a
 * multi-day run sharing a start column with a single-day one is not
 * arbitrarily preferred over it), then assign each segment to any lane
 * whose last-placed segment already ended before it starts, opening a new
 * lane only when none is free. Sorting by length instead of start (as an
 * earlier version of this function did) is not optimal for minimizing lane
 * count: it can force spurious overflow for segments that would fit
 * cleanly once sorted by start.
 */
export function layoutWeekBands(
  weekDates: readonly string[],
  segments: readonly BandSegment[],
  maxLanes: number = MAX_BAND_LANES,
): WeekBandLayout {
  if (weekDates.length !== 7) {
    throw new Error('expected exactly 7 dates (Sunday..Saturday) for a week');
  }
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];
  if (weekStart === undefined || weekEnd === undefined) {
    throw new Error('expected exactly 7 dates (Sunday..Saturday) for a week');
  }

  const clipped = segments
    .filter(
      (segment) =>
        compareDates(segment.startDate, weekEnd) <= 0 &&
        compareDates(segment.endDate, weekStart) >= 0,
    )
    .map((segment) => {
      const clippedStart =
        compareDates(segment.startDate, weekStart) > 0 ? segment.startDate : weekStart;
      const clippedEnd = compareDates(segment.endDate, weekEnd) < 0 ? segment.endDate : weekEnd;
      return {
        ...segment,
        startCol: weekDates.indexOf(clippedStart),
        endCol: weekDates.indexOf(clippedEnd),
      };
    })
    .sort((a, b) => {
      if (a.startCol !== b.startCol) {
        return a.startCol - b.startCol;
      }
      const lengthA = a.endCol - a.startCol;
      const lengthB = b.endCol - b.startCol;
      return lengthB - lengthA;
    });

  const laneEndCols: number[] = [];
  const positioned: PositionedBandSegment[] = [];
  const overflowEventIds = new Set<string>();

  for (const segment of clipped) {
    let lane = laneEndCols.findIndex((endCol) => endCol < segment.startCol);
    if (lane === -1) {
      if (laneEndCols.length < maxLanes) {
        lane = laneEndCols.length;
        laneEndCols.push(segment.endCol);
      } else {
        overflowEventIds.add(segment.eventId);
        continue;
      }
    } else {
      laneEndCols[lane] = segment.endCol;
    }
    positioned.push({ ...segment, lane });
  }

  return { weekStartDate: weekStart, segments: positioned, overflowCount: overflowEventIds.size };
}

export interface DayCellViewModel {
  date: string;
  inCurrentMonth: boolean;
  badgeCount: number;
}

export interface WeekViewModel {
  days: DayCellViewModel[];
  bandLayout: WeekBandLayout;
}

export interface MonthCalendarViewModel {
  yearMonth: string;
  weeks: WeekViewModel[];
}

/**
 * Composes the grid, band segments, and badge counts into the full month
 * view model a presentation component can render directly. `eventsWithOccurrences`
 * should already cover the whole displayed grid (including lead/trail days
 * from adjacent months) - see src/app/catalog/page.tsx - so lead/trail
 * cells reflect real data instead of always appearing empty.
 */
export function buildMonthCalendarViewModel(
  yearMonth: string,
  eventsWithOccurrences: readonly EventWithOccurrences[],
): MonthCalendarViewModel {
  const grid = buildMonthGrid(yearMonth);
  const badgeCounts = computeBadgeCounts(eventsWithOccurrences);
  const allSegments = eventsWithOccurrences.flatMap(({ event, occurrences }) =>
    isBandEvent(occurrences) ? computeBandSegments(event, occurrences) : [],
  );

  const weeks: WeekViewModel[] = grid.weeks.map((weekDates) => ({
    days: weekDates.map((date) => ({
      date,
      inCurrentMonth: date.slice(0, 7) === yearMonth,
      badgeCount: badgeCounts.get(date) ?? 0,
    })),
    bandLayout: layoutWeekBands(weekDates, allSegments),
  }));

  return { yearMonth, weeks };
}

export interface SelectedDayOccurrence {
  event: EventCatalogEvent;
  occurrence: EventOccurrence;
  isBandEvent: boolean;
}

/**
 * Every occurrence on `date` (Asia/Tokyo calendar day), from both band and
 * non-band events, individually - never collapsed by event or by day (same-
 * day multiple occurrences are distinct entries). This is the escape hatch
 * for whatever the month view bounded/omitted for scanability (badge
 * exclusion, band overflow): full detail for any single day is always
 * reachable here, for the same `eventsWithOccurrences` the month view was
 * built from.
 */
export function selectDayOccurrences(
  eventsWithOccurrences: readonly EventWithOccurrences[],
  date: string,
): SelectedDayOccurrence[] {
  const result: SelectedDayOccurrence[] = [];
  for (const { event, occurrences } of eventsWithOccurrences) {
    const banded = isBandEvent(occurrences);
    for (const occurrence of occurrences) {
      if (tokyoCalendarDateFromInstant(occurrence.startsAt) === date) {
        result.push({ event, occurrence, isBandEvent: banded });
      }
    }
  }
  return result.sort((a, b) => compareOccurrencesByStartsAt(a.occurrence, b.occurrence));
}
