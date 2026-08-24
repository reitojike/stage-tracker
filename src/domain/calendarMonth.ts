// Pure month-calendar presentation derivation for the Event Catalog vertical
// slice (Issue #20, revised by #91, corrected by #91's PO decision comment
// "restore single-day count / multi-day band presentation" after Production
// revalidation). Everything in this module is derived, read-only
// presentation computed from an already-fetched EventWithOccurrences[] (see
// eventCatalog.ts / Issue #12) - it never queries Supabase, never persists
// anything, and never introduces a run-period/category/priority source of
// truth beyond what is deterministically computable from the fetched data
// itself.
//
// Canonical presentation rule this module encodes (Issue #91 PO decision,
// superseding both Issue #20's occurrence-derived band rule and #91's own
// initial "every event bands uniformly" rule, which regressed Issue #20's
// single-day/multi-day distinction):
// - a single-day Event (`starts_on === ends_on`, see isSingleDayEvent) never
//   renders a band. It is represented only by the day-number count on its
//   own date - see computeBadgeCounts.
// - a multi-day Event (`starts_on < ends_on`) renders as an Event-range band
//   only, and never contributes to the day-number count - see
//   eventRangeBandSegment/buildMonthCalendarViewModel. The band spans
//   `starts_on`..`ends_on` inclusive, as-is, regardless of how many
//   occurrences (if any) exist and never split around a day with no
//   occurrence evidence: the Event range does not claim "an occurrence
//   happens every day in this span" (product-rules.md "Event 開催期間
//   （Event range）": 0 occurrences on some days inside the range is a
//   valid state, not a rest day to render around).
// - the day-number count is therefore a *single-day Event count*, not an
//   occurrence count: a 0-occurrence single-day Event still counts once
//   (otherwise it would be invisible on the month grid, reproducing Issue
//   #88's original bug), and a single-day Event with several occurrences
//   (e.g. matinee + evening) still counts once, since this represents
//   Events, not performances. Because single-day Events never band and
//   multi-day Events never count, a day's band titles and its count are
//   always about disjoint Events - never the same Event's information
//   twice.
// - the selected-day occurrence list is derived only from actual occurrence
//   rows, independent of band/count coverage - see selectDayOccurrences.
//   Nothing here fabricates an occurrence from the range.
//
// Band/count coverage is derived only from whatever event set the caller
// fetched for the current view (src/app/catalog/page.tsx fetches every
// event whose Event range overlaps the displayed grid, including lead/trail
// days - see listEventCatalogInRange). Full, range-independent detail for a
// single event remains available via the event detail page
// (getEventWithOccurrences).

import {
  calendarDayRole,
  isWithinJapaneseHolidayDataCoverage,
  type CalendarDayRole,
} from './calendarDayRole.ts';
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

export interface BandSegment {
  eventId: string;
  eventTitle: string;
  startDate: string;
  endDate: string;
}

/**
 * True iff `event`'s Event range is exactly one calendar day
 * (`starts_on === ends_on`). This is the canonical single-day/multi-day
 * classification for month-view presentation (Issue #91 PO decision): a
 * single-day Event never bands (see buildMonthCalendarViewModel) and is
 * represented only by the day-number count (see computeBadgeCounts); a
 * multi-day Event is the reverse. The DB invariant `starts_on <= ends_on`
 * (Issue #88) means this is equivalent to `!(starts_on < ends_on)`, so no
 * separate "is multi-day" predicate is needed.
 */
export function isSingleDayEvent(event: EventCatalogEvent): boolean {
  return event.startsOn === event.endsOn;
}

/**
 * One band segment for `event`, spanning its Event range (`starts_on` -
 * `ends_on`, both inclusive) as-is. Only meaningful for a multi-day event -
 * callers must not call this for a single-day one (isSingleDayEvent), which
 * never bands (Issue #91 PO decision). Regardless of how many occurrences
 * (if any) the event has, and regardless of any gap in its occurrence
 * dates, the segment spans the whole range: the Event range is the
 * officially published run period, a first-class fact independent of
 * occurrence rows (product-rules.md "Event 開催期間（Event range）"), so it
 * is never split around a day the caller's occurrence data happens not to
 * cover.
 */
export function eventRangeBandSegment(event: EventCatalogEvent): BandSegment {
  return {
    eventId: event.id,
    eventTitle: event.title,
    startDate: event.startsOn,
    endDate: event.endsOn,
  };
}

/**
 * Per-day count of *single-day* Events whose Event range is exactly that
 * day (Issue #91 PO decision - see isSingleDayEvent). This counts Events,
 * not occurrences or performances: a 0-occurrence single-day Event still
 * counts once (otherwise it would be invisible on the month grid,
 * reproducing Issue #88's original bug), and a single-day Event with
 * several occurrences (e.g. matinee + evening) still counts once. A
 * multi-day Event never contributes here regardless of its occurrences -
 * it is represented by its band instead (buildMonthCalendarViewModel), so a
 * day's band titles and its count are always about disjoint Events.
 */
export function computeBadgeCounts(
  eventsWithOccurrences: readonly EventWithOccurrences[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { event } of eventsWithOccurrences) {
    if (isSingleDayEvent(event)) {
      counts.set(event.startsOn, (counts.get(event.startsOn) ?? 0) + 1);
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
  /** `overflowEvents.length` - see that field. */
  overflowCount: number;
  /** The events pushed beyond the lane cap this week (deduplicated by event
   * id, so an event whose range segment itself overflows more than one week
   * is still one hidden event, not one per week - see layoutWeekBands).
   *
   * A presentation layer must not assume this week's own selectDayOccurrences
   * can always recover these: that only holds when the event has an actual
   * occurrence on some day within *this* week. Since Issue #91 a band covers
   * every day in its Event range regardless of occurrence evidence, so an
   * event whose only occurrences fall in a *different* week of the same
   * range can overflow a week where it has none at all - no day selection
   * within that week would ever reveal it. Exposing the events themselves
   * (not just a count) lets the presentation layer link directly to each,
   * rather than pointing at a day selection that would come up empty. */
  overflowEvents: { eventId: string; eventTitle: string }[];
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
  const overflowEventTitles = new Map<string, string>();

  for (const segment of clipped) {
    let lane = laneEndCols.findIndex((endCol) => endCol < segment.startCol);
    if (lane === -1) {
      if (laneEndCols.length < maxLanes) {
        lane = laneEndCols.length;
        laneEndCols.push(segment.endCol);
      } else {
        overflowEventTitles.set(segment.eventId, segment.eventTitle);
        continue;
      }
    } else {
      laneEndCols[lane] = segment.endCol;
    }
    positioned.push({ ...segment, lane });
  }

  const overflowEvents = [...overflowEventTitles].map(([eventId, eventTitle]) => ({
    eventId,
    eventTitle,
  }));

  return {
    weekStartDate: weekStart,
    segments: positioned,
    overflowCount: overflowEvents.length,
    overflowEvents,
  };
}

export interface DayCellViewModel {
  date: string;
  inCurrentMonth: boolean;
  badgeCount: number;
  /** Global weekday/Japanese-holiday presentation role (docs/ux-ui.md
   * "Calendar weekday / Japanese holiday presentation"), from the same
   * calendarDayRole.ts authority My Calendar already wires in - this
   * module never re-derives the classification itself. */
  role: CalendarDayRole;
  /** False when `date` falls outside the Japanese-holiday snapshot's
   * confirmed coverage range - matching MyCalendarDayMarkers.holidayDataConfirmed
   * (myCalendar.ts), so a presentation layer must not show holiday status
   * for this date as a confirmed ordinary day. */
  holidayDataConfirmed: boolean;
}

export interface WeekViewModel {
  days: DayCellViewModel[];
  bandLayout: WeekBandLayout;
}

export interface MonthCalendarViewModel {
  yearMonth: string;
  weeks: WeekViewModel[];
  /** True when any date actually inside `yearMonth` (not a lead/trail cell)
   * falls outside the Japanese-holiday snapshot's confirmed coverage -
   * matching My Calendar's page.tsx-level hasUnconfirmedHolidayCoverage
   * filter/convention, computed here instead since this view model already
   * has every day's holidayDataConfirmed available. */
  hasUnconfirmedHolidayCoverage: boolean;
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
  // Only multi-day events band (Issue #91 PO decision) - a single-day
  // event is represented solely by badgeCounts above, never also as a
  // band, so the two signals never name the same Event twice.
  const allSegments = eventsWithOccurrences
    .filter(({ event }) => !isSingleDayEvent(event))
    .map(({ event }) => eventRangeBandSegment(event));

  const weeks: WeekViewModel[] = grid.weeks.map((weekDates) => ({
    days: weekDates.map((date) => ({
      date,
      inCurrentMonth: date.slice(0, 7) === yearMonth,
      badgeCount: badgeCounts.get(date) ?? 0,
      role: calendarDayRole(date),
      holidayDataConfirmed: isWithinJapaneseHolidayDataCoverage(date),
    })),
    bandLayout: layoutWeekBands(weekDates, allSegments),
  }));

  const hasUnconfirmedHolidayCoverage = weeks.some((week) =>
    week.days.some((day) => day.inCurrentMonth && !day.holidayDataConfirmed),
  );

  return { yearMonth, weeks, hasUnconfirmedHolidayCoverage };
}

export interface SelectedDayOccurrence {
  event: EventCatalogEvent;
  occurrence: EventOccurrence;
}

/**
 * Every occurrence on `date` (Asia/Tokyo calendar day), individually -
 * never collapsed by event or by day (same-day multiple occurrences are
 * distinct entries). This is the escape hatch for whatever the month view
 * bounded/omitted for scanability (band overflow): full detail for any
 * single day is always reachable here, for the same `eventsWithOccurrences`
 * the month view was built from. Derived only from actual occurrence rows
 * (Issue #91): a day within an event's Event range but without an
 * occurrence on it never appears here, regardless of that event's band
 * coverage.
 */
export function selectDayOccurrences(
  eventsWithOccurrences: readonly EventWithOccurrences[],
  date: string,
): SelectedDayOccurrence[] {
  const result: SelectedDayOccurrence[] = [];
  for (const { event, occurrences } of eventsWithOccurrences) {
    for (const occurrence of occurrences) {
      if (tokyoCalendarDateFromInstant(occurrence.startsAt) === date) {
        result.push({ event, occurrence });
      }
    }
  }
  return result.sort((a, b) => compareOccurrencesByStartsAt(a.occurrence, b.occurrence));
}
