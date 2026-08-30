// My Calendar is a pure, DB-free projection of two already-fetched personal
// planning slices: participation-registered occurrences and visible,
// event-independent personal schedules (own + shared). It also supplies the
// calendar-day role used by the presentation layer.
//
// The caller (src/app/calendar/page.tsx) is responsible for typed reads and
// RLS-scoped visibility. This module consumes those results as provided and
// does not query Supabase or make a second permission decision.
//
// Participation is occurrence-scoped: a registered occurrence contributes on
// its own Asia/Tokyo calendar date only. No Event-range coverage or Event-level
// fallback is inferred for My Calendar. Personal schedules use their own
// temporal span: multi-day entries become bands, while single-day entries
// contribute to the per-day dot. The entry's `blocking` value determines the
// band's fill/outline semantics for both owners and shared recipients.
//
// Month-level participation markers and counts use the canonical
// `isEffectivelyCanceled` predicate. Effective-canceled occurrences are
// excluded from those aggregates, while the selected-day detail continues to
// receive the input participation entries, including canceled ones.

import {
  addDaysToDate,
  compareDates,
  layoutWeekBands,
  MAX_BAND_LANES,
  monthBounds,
  type BandSegment,
  type WeekBandLayout,
} from './calendarMonth.ts';
import {
  calendarDayRole,
  isWithinJapaneseHolidayDataCoverage,
  type CalendarDayRole,
} from './calendarDayRole.ts';
import {
  compareOccurrencesByStartsAt,
  tokyoCalendarDateFromInstant,
  type EventCatalogEvent,
  type EventOccurrence,
  type EventWithOccurrences,
} from './eventCatalog.ts';
import { isEffectivelyCanceled } from './eventCancellation.ts';
import type { Participation } from './participation.ts';
import { entryStart, instantSortKey, type PersonalScheduleEntry } from './personalSchedule.ts';

// --- Occurrence + participation state ---

export interface MyCalendarOccurrenceEntry {
  event: EventCatalogEvent;
  occurrence: EventOccurrence;
  participation: Participation;
}

/**
 * Builds entries for occurrences that have a participation row, pairing each
 * occurrence with its parent Event and participation. The input is already
 * bounded by the caller's fetched range; an occurrence without a matching
 * participation row is excluded because My Calendar represents registered
 * occurrences, not every occurrence in the Event Catalog range.
 */
export function buildMyCalendarOccurrenceEntries(
  eventsWithOccurrences: readonly EventWithOccurrences[],
  participationsByOccurrenceId: ReadonlyMap<string, Participation>,
): MyCalendarOccurrenceEntry[] {
  const entries: MyCalendarOccurrenceEntry[] = [];
  for (const { event, occurrences } of eventsWithOccurrences) {
    for (const occurrence of occurrences) {
      const participation = participationsByOccurrenceId.get(occurrence.id);
      if (participation === undefined) {
        continue;
      }
      entries.push({ event, occurrence, participation });
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
 * since a UTC-sliced date can never be *later* than the true Tokyo date.
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
 * clipping to a displayed range, factored out so
 * buildMyCalendarScheduleBandSegments
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

/** True when the entry's own Asia/Tokyo span is exactly one calendar day.
 * Single-day entries feed the per-day dot; multi-day entries feed the band
 * layout. */
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

// --- Month landing agenda ---

/** A presentation-ready item shared by the selected-day list and the month
 * landing agenda. Keeping the two source shapes explicit lets their row
 * presenter reuse the exact same Badge, link, and temporal semantics without
 * making either source look like the other. */
export type MyCalendarEntry =
  | {
      kind: 'occurrence';
      occurrenceEntry: MyCalendarOccurrenceEntry;
    }
  | {
      kind: 'schedule';
      scheduleEntry: MyCalendarScheduleEntry;
    };

/** One item in the month landing agenda. `date` is the date group/anchor,
 * not necessarily the schedule's actual start date: a multi-day schedule
 * that carries in from a previous month is anchored at the displayed
 * month's first date while its row still renders its actual temporal range. */
export type MyCalendarAgendaItem = MyCalendarEntry & {
  date: string;
};

export interface MyCalendarAgendaDateGroup {
  date: string;
  items: MyCalendarAgendaItem[];
}

export function agendaItemId(item: MyCalendarAgendaItem): string {
  return item.kind === 'occurrence'
    ? item.occurrenceEntry.occurrence.id
    : item.scheduleEntry.entry.id;
}

/** One normalized chronological key across raw occurrence instants and
 * all-day/time-bounded schedule starts. These are the same precision-aware
 * helpers used by Home's mixed upcoming projection; direct comparison of a
 * raw timestamp with an all-day calendar date would not be safe here. */
function agendaItemStartKey(item: MyCalendarAgendaItem): string {
  return item.kind === 'occurrence'
    ? instantSortKey(item.occurrenceEntry.occurrence.startsAt)
    : entryStart(item.scheduleEntry.entry);
}

/** Stable same-date ordering for the mixed agenda. The temporal key is the
 * actual source start (so a previous-month carry-in naturally precedes a
 * timed item on the month-start anchor date); id and kind make equal starts
 * deterministic across the two source tables. */
function compareAgendaItems(a: MyCalendarAgendaItem, b: MyCalendarAgendaItem): number {
  const startA = agendaItemStartKey(a);
  const startB = agendaItemStartKey(b);
  if (startA !== startB) {
    return startA < startB ? -1 : 1;
  }

  const idA = agendaItemId(a);
  const idB = agendaItemId(b);
  if (idA !== idB) {
    return idA < idB ? -1 : 1;
  }
  if (a.kind === b.kind) {
    return 0;
  }
  return a.kind === 'occurrence' ? -1 : 1;
}

/** True when an entry's own Tokyo calendar-date range overlaps the inclusive
 * displayed-month range. The range is intentionally not expanded to the
 * calendar grid's lead/trail dates: month landing owns only the actual
 * displayed month, while the calendar grid may still show adjacent-cell
 * markers for navigation context. */
function scheduleOverlapsMonth(
  entry: PersonalScheduleEntry,
  monthFirstDate: string,
  monthLastDate: string,
): boolean {
  const { startDate, endDate } = scheduleEntryDateRange(entry);
  return compareDates(startDate, monthLastDate) <= 0 && compareDates(endDate, monthFirstDate) >= 0;
}

/**
 * Builds the displayed month's chronological agenda from the same
 * participation-registered occurrence and visible schedule slices used by
 * the calendar grid and selected-day detail.
 *
 * Occurrences are included once on their own exact Asia/Tokyo start date,
 * including canceled occurrences so their existing detail semantics remain
 * reachable from the month landing. Schedules are included once per logical
 * entry when their own date range overlaps the month. A schedule that starts
 * before the month is anchored to the first displayed date, but its row keeps
 * the un-clipped temporal label via the original entry. Lead/trail
 * adjacent-month occurrence dates never enter this projection.
 */
export function buildMyCalendarMonthAgenda(
  yearMonth: string,
  occurrenceEntries: readonly MyCalendarOccurrenceEntry[],
  scheduleEntries: readonly PersonalScheduleEntry[],
  callerId: string,
): MyCalendarAgendaDateGroup[] {
  const { firstDate: monthFirstDate, lastDate: monthLastDate } = monthBounds(yearMonth);
  const items: MyCalendarAgendaItem[] = [];
  const seenOccurrenceIds = new Set<string>();
  const seenScheduleIds = new Set<string>();

  for (const occurrenceEntry of occurrenceEntries) {
    const occurrenceId = occurrenceEntry.occurrence.id;
    const date = tokyoCalendarDateFromInstant(occurrenceEntry.occurrence.startsAt);
    if (compareDates(date, monthFirstDate) < 0 || compareDates(date, monthLastDate) > 0) {
      continue;
    }
    if (seenOccurrenceIds.has(occurrenceId)) {
      continue;
    }
    seenOccurrenceIds.add(occurrenceId);
    items.push({ date, kind: 'occurrence', occurrenceEntry });
  }

  for (const entry of scheduleEntries) {
    if (!scheduleOverlapsMonth(entry, monthFirstDate, monthLastDate)) {
      continue;
    }
    if (seenScheduleIds.has(entry.id)) {
      continue;
    }
    seenScheduleIds.add(entry.id);
    const { startDate } = scheduleEntryDateRange(entry);
    const date = compareDates(startDate, monthFirstDate) < 0 ? monthFirstDate : startDate;
    items.push({
      date,
      kind: 'schedule',
      scheduleEntry: { entry, isOwner: entry.ownerId === callerId },
    });
  }

  const itemsByDate = new Map<string, MyCalendarAgendaItem[]>();
  for (const item of items) {
    const bucket = itemsByDate.get(item.date);
    if (bucket === undefined) {
      itemsByDate.set(item.date, [item]);
    } else {
      bucket.push(item);
    }
  }

  return [...itemsByDate.entries()]
    .sort(([dateA], [dateB]) => compareDates(dateA, dateB))
    .map(([date, dateItems]) => ({
      date,
      items: dateItems.sort(compareAgendaItems),
    }));
}

// --- Multi-day band segments ---
//
// Only multi-day personal-schedule entries are constructed as My Calendar
// bands. Participation entries remain exact-date signals and never derive
// coverage from their parent Event range. Event Catalog range bands belong to
// a separate projection.
//
// The `kind: 'event'` arm remains accepted because MyMonthCalendar.tsx still
// receives and renders the shared segment shape. This module does not construct
// that arm; narrowing the type would expand the change into the presentation
// boundary.

export interface MyCalendarBandSegment extends BandSegment {
  kind: 'event' | 'schedule';
  /** A blocking schedule fills its band; a non-blocking schedule outlines it.
   * The value is copied from the entry itself and is not recipient-specific. */
  blocking: boolean;
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

/** One WeekBandLayout per week in `gridWeeks` (same shape/order as
 * `calendarMonth.buildMonthGrid`), using the shared `MAX_BAND_LANES` cap.
 * Personal-schedule entries are the only source of bands; participation is
 * represented by the per-day dot instead. */
export function buildMyCalendarWeekBandLayouts(
  gridWeeks: readonly (readonly string[])[],
  scheduleEntries: readonly PersonalScheduleEntry[],
): WeekBandLayout<MyCalendarBandSegment>[] {
  const segments = buildMyCalendarScheduleBandSegments(scheduleEntries);
  return gridWeeks.map((weekDates) => layoutWeekBands(weekDates, segments, MAX_BAND_LANES));
}

// --- Per-day markers for the month view ---

/**
 * The unified dot state for one day: `'filled'` when an active `attending`
 * occurrence or blocking single-day schedule exists, `'outline'` when only
 * active `considering` occurrences or non-blocking single-day schedules exist,
 * and `'none'` otherwise. Participation is evaluated on the occurrence's
 * exact Asia/Tokyo date and effective-canceled occurrences are excluded.
 * Multi-day schedules are represented by bands, leaving dot and band sources
 * disjoint; multiple qualifying sources still produce at most one dot.
 */
export type MyCalendarDotState = 'filled' | 'outline' | 'none';

/** Filters day occurrences to the active participation set using the
 * canonical Event/Occurrence cancellation predicate. The visible dot and
 * accessible counts share this result, while selected-day detail continues to
 * use the unfiltered entries so canceled occurrences remain reachable. */
function activeOccurrenceEntries(
  dayOccurrences: readonly MyCalendarOccurrenceEntry[],
): MyCalendarOccurrenceEntry[] {
  return dayOccurrences.filter((entry) => !isEffectivelyCanceled(entry.event, entry.occurrence));
}

function computeDotState(
  activeDayOccurrences: readonly MyCalendarOccurrenceEntry[],
  daySchedules: readonly MyCalendarScheduleEntry[],
): MyCalendarDotState {
  const singleDaySchedules = daySchedules.filter((s) => isSingleDayScheduleEntry(s.entry));

  const filled =
    activeDayOccurrences.some((entry) => entry.participation.status === 'attending') ||
    singleDaySchedules.some((s) => s.entry.blocking);
  if (filled) {
    return 'filled';
  }

  const outlined =
    activeDayOccurrences.some((entry) => entry.participation.status === 'considering') ||
    singleDaySchedules.some((s) => !s.entry.blocking);
  return outlined ? 'outline' : 'none';
}

export interface MyCalendarDayMarkers {
  date: string;
  role: CalendarDayRole;
  /** False when `date` is outside the Japanese-holiday snapshot's confirmed
   * coverage range. Its role may later become `'holiday'`, so presentation
   * must distinguish unconfirmed holiday data from a confirmed ordinary day. */
  holidayDataConfirmed: boolean;
  /** The unified single-day marker for this day - see computeDotState. */
  dot: MyCalendarDotState;
  /** Active occurrences on this day whose participation status is
   * `attending`. The accessible count remains independent from `dot`, but
   * both use the same cancellation-filtered exact-date occurrence set. */
  attendingCount: number;
  /** Active occurrences on this day whose participation status is
   * `considering`. */
  consideringCount: number;
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
    const activeDayOccurrences = activeOccurrenceEntries(dayOccurrences);
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
      dot: computeDotState(activeDayOccurrences, daySchedules),
      attendingCount: activeDayOccurrences.filter(
        (entry) => entry.participation.status === 'attending',
      ).length,
      consideringCount: activeDayOccurrences.filter(
        (entry) => entry.participation.status === 'considering',
      ).length,
      ownScheduleCount: daySchedules.filter((s) => s.isOwner).length,
      sharedScheduleCount: daySchedules.filter((s) => !s.isOwner).length,
    };
  });
}
