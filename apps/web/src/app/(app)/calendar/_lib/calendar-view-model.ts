import {
  compareInstants,
  instantToTokyoCalendarDate,
  isEffectivelyCanceled,
  tokyoCalendarDayRangeUtc,
  type PersonalScheduleEntry,
  type TokyoCalendarDate,
  type UserId,
} from "@stage-tracker/domain";
import {
  buildMonthGridDays,
  enumerateTokyoCalendarDates,
  firstDayOfMonth,
  lastDayOfMonth,
  maxTokyoCalendarDate,
  minTokyoCalendarDate,
  formatMonthParam,
  type TokyoYearMonth,
} from "@/app/_lib/calendar-grid";
import {
  calendarDayRole,
  isWithinJapaneseHolidayDataCoverage,
  type CalendarDayRole,
} from "@/app/_lib/calendar-day-role";
import {
  layoutWeekBands,
  MAX_BAND_LANES,
  type BandSegment,
  type WeekBandLayout,
} from "@/app/_lib/calendar-band-layout";
import type {
  CalendarOccurrenceItem,
  CalendarScheduleItem,
  TokyoDateIndex,
} from "./calendar-loader";

/**
 * Pure My Calendar projection (`docs/v2/oracle-domain.md` §2.9/§2.11).
 *
 * The loader owns read classification and only indexes data that is actually
 * visible in the grid. This module owns the deterministic presentation
 * derivation: cancellation-filtered dots/counts, Tokyo-date schedule spans,
 * personal-schedule bands, lane allocation, holiday coverage, and agenda
 * grouping. It does not query Supabase or decide whether a failed read is
 * empty; callers pass only the data from reads that succeeded.
 */

export type MyCalendarDotState = "filled" | "outline" | "none";

export interface CalendarDayViewModel {
  readonly date: TokyoCalendarDate;
  readonly inCurrentMonth: boolean;
  readonly role: CalendarDayRole;
  readonly holidayDataConfirmed: boolean;
  readonly dot: MyCalendarDotState;
  readonly attendingCount: number;
  readonly consideringCount: number;
  readonly ownScheduleCount: number;
  readonly sharedScheduleCount: number;
}

export interface CalendarScheduleBandSegment extends BandSegment {
  readonly kind: "schedule";
  readonly blocking: boolean;
}

export interface CalendarWeekViewModel {
  readonly days: readonly CalendarDayViewModel[];
  readonly bandLayout: WeekBandLayout<CalendarScheduleBandSegment>;
}

export interface CalendarMonthViewModel {
  readonly month: TokyoYearMonth;
  readonly weeks: readonly CalendarWeekViewModel[];
  readonly hasUnconfirmedHolidayCoverage: boolean;
}

export interface CalendarScheduleViewItem {
  readonly entry: PersonalScheduleEntry;
  readonly isOwner: boolean;
}

function scheduleViewSortInstant(entry: PersonalScheduleEntry) {
  return entry.temporal.kind === "all-day"
    ? tokyoCalendarDayRangeUtc(entry.temporal.startsOn).startInstant
    : entry.temporal.startsAt;
}

function compareScheduleViewItems(
  a: CalendarScheduleViewItem,
  b: CalendarScheduleViewItem,
): number {
  const byStart = compareInstants(
    scheduleViewSortInstant(a.entry),
    scheduleViewSortInstant(b.entry),
  );
  return byStart !== 0
    ? byStart
    : String(a.entry.id).localeCompare(String(b.entry.id));
}

export interface CalendarOccurrenceDateGroup {
  readonly date: TokyoCalendarDate;
  readonly items: readonly CalendarOccurrenceItem[];
}

export interface CalendarScheduleDateGroup {
  readonly date: TokyoCalendarDate;
  readonly items: readonly CalendarScheduleViewItem[];
}

export interface CalendarScheduleDateRange {
  readonly startDate: TokyoCalendarDate;
  readonly endDate: TokyoCalendarDate;
}

/** Stable chronological order for an occurrence list. */
export function compareCalendarOccurrenceItems(
  a: CalendarOccurrenceItem,
  b: CalendarOccurrenceItem,
): number {
  const byStart = compareInstants(a.occurrence.startsAt, b.occurrence.startsAt);
  if (byStart !== 0) {
    return byStart;
  }
  if (a.participation.id === b.participation.id) {
    return 0;
  }
  return a.participation.id < b.participation.id ? -1 : 1;
}

/**
 * Returns an entry's own inclusive Asia/Tokyo calendar-date range.
 *
 * A time-bounded entry with a known end can span multiple Tokyo dates. A
 * missing end is deliberately limited to the start date for calendar
 * projection; it is not treated as an indefinitely active item.
 */
export function calendarScheduleDateRange(
  entry: PersonalScheduleEntry,
): CalendarScheduleDateRange {
  if (entry.temporal.kind === "all-day") {
    return {
      startDate: entry.temporal.startsOn,
      endDate: entry.temporal.endsOn,
    };
  }

  const startDate = instantToTokyoCalendarDate(entry.temporal.startsAt);
  return {
    startDate,
    endDate:
      entry.temporal.endsAt === null
        ? startDate
        : instantToTokyoCalendarDate(entry.temporal.endsAt),
  };
}

export function isSingleDayScheduleEntry(
  entry: PersonalScheduleEntry,
): boolean {
  const range = calendarScheduleDateRange(entry);
  return range.startDate === range.endDate;
}

/** Returns every active Tokyo date, clipped to the visible grid range. */
export function scheduleEntryDatesInRange(
  entry: PersonalScheduleEntry,
  gridStart: TokyoCalendarDate,
  gridEnd: TokyoCalendarDate,
): readonly TokyoCalendarDate[] {
  const range = calendarScheduleDateRange(entry);
  const start = maxTokyoCalendarDate(range.startDate, gridStart);
  const end = minTokyoCalendarDate(range.endDate, gridEnd);
  return enumerateTokyoCalendarDates(start, end);
}

function uniqueOccurrenceItems(
  items: readonly CalendarOccurrenceItem[],
): readonly CalendarOccurrenceItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.occurrence.id)) {
      return false;
    }
    seen.add(item.occurrence.id);
    return true;
  });
}

function uniqueScheduleItems(
  items: readonly CalendarScheduleItem[],
): readonly CalendarScheduleItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.entry.id)) {
      return false;
    }
    seen.add(item.entry.id);
    return true;
  });
}

export function selectCalendarOccurrenceItems(
  index: TokyoDateIndex<CalendarOccurrenceItem>,
  date: TokyoCalendarDate,
): readonly CalendarOccurrenceItem[] {
  return [...uniqueOccurrenceItems(index.byDate.get(date) ?? [])].sort(
    compareCalendarOccurrenceItems,
  );
}

export function selectCalendarScheduleItems(
  index: TokyoDateIndex<CalendarScheduleItem>,
  callerId: UserId,
  date: TokyoCalendarDate,
): readonly CalendarScheduleViewItem[] {
  return uniqueScheduleItems(index.byDate.get(date) ?? []).map((item) => ({
    entry: item.entry,
    isOwner: item.entry.ownerId === callerId,
  }));
}

function activeOccurrenceItems(
  items: readonly CalendarOccurrenceItem[],
): readonly CalendarOccurrenceItem[] {
  return items.filter(
    (item) => !isEffectivelyCanceled(item.event, item.occurrence),
  );
}

function dayDot(
  occurrences: readonly CalendarOccurrenceItem[],
  schedules: readonly CalendarScheduleItem[],
): MyCalendarDotState {
  const singleDaySchedules = schedules.filter((item) =>
    isSingleDayScheduleEntry(item.entry),
  );

  if (
    occurrences.some((item) => item.participation.status === "attending") ||
    singleDaySchedules.some((item) => item.entry.blocking)
  ) {
    return "filled";
  }
  if (
    occurrences.some((item) => item.participation.status === "considering") ||
    singleDaySchedules.some((item) => !item.entry.blocking)
  ) {
    return "outline";
  }
  return "none";
}

export function buildMyCalendarScheduleBandSegments(
  items: readonly CalendarScheduleItem[],
): readonly CalendarScheduleBandSegment[] {
  return uniqueScheduleItems(items)
    .filter((item) => !isSingleDayScheduleEntry(item.entry))
    .map((item) => {
      const range = calendarScheduleDateRange(item.entry);
      return {
        eventId: item.entry.id,
        eventTitle: item.entry.title,
        startDate: range.startDate,
        endDate: range.endDate,
        isCanceled: false,
        kind: "schedule" as const,
        blocking: item.entry.blocking,
      };
    });
}

function buildDayViewModel(
  date: TokyoCalendarDate,
  month: TokyoYearMonth,
  occurrenceIndex: TokyoDateIndex<CalendarOccurrenceItem>,
  scheduleIndex: TokyoDateIndex<CalendarScheduleItem>,
  callerId: UserId,
): CalendarDayViewModel {
  const allOccurrences = selectCalendarOccurrenceItems(occurrenceIndex, date);
  const activeOccurrences = activeOccurrenceItems(allOccurrences);
  const schedules = uniqueScheduleItems(scheduleIndex.byDate.get(date) ?? []);

  return {
    date,
    inCurrentMonth: date.slice(0, 7) === formatMonthParam(month),
    role: calendarDayRole(date),
    holidayDataConfirmed: isWithinJapaneseHolidayDataCoverage(date),
    dot: dayDot(activeOccurrences, schedules),
    attendingCount: activeOccurrences.filter(
      (item) => item.participation.status === "attending",
    ).length,
    consideringCount: activeOccurrences.filter(
      (item) => item.participation.status === "considering",
    ).length,
    ownScheduleCount: schedules.filter(
      (item) => item.entry.ownerId === callerId,
    ).length,
    sharedScheduleCount: schedules.filter(
      (item) => item.entry.ownerId !== callerId,
    ).length,
  };
}

/**
 * Builds the complete month view model. Canceled occurrences are omitted
 * only from month markers/counts; the source index remains untouched so the
 * selected-day detail can still render them with an explicit cancellation
 * badge.
 */
export function buildMyCalendarMonthViewModel(
  month: TokyoYearMonth,
  occurrenceIndex: TokyoDateIndex<CalendarOccurrenceItem>,
  scheduleIndex: TokyoDateIndex<CalendarScheduleItem>,
  callerId: UserId,
): CalendarMonthViewModel {
  const gridDays = buildMonthGridDays(month);
  const bandSegments = buildMyCalendarScheduleBandSegments(scheduleIndex.items);
  const weeks: CalendarWeekViewModel[] = [];

  for (let offset = 0; offset < gridDays.length; offset += 7) {
    const weekDates = gridDays.slice(offset, offset + 7);
    weeks.push({
      days: weekDates.map((date) =>
        buildDayViewModel(
          date,
          month,
          occurrenceIndex,
          scheduleIndex,
          callerId,
        ),
      ),
      bandLayout: layoutWeekBands(weekDates, bandSegments, MAX_BAND_LANES),
    });
  }

  const monthStart = firstDayOfMonth(month);
  const monthEnd = lastDayOfMonth(month);
  const hasUnconfirmedHolidayCoverage = gridDays.some(
    (date) =>
      date >= monthStart &&
      date <= monthEnd &&
      !isWithinJapaneseHolidayDataCoverage(date),
  );

  return { month, weeks, hasUnconfirmedHolidayCoverage };
}

export function selectCalendarMonthOccurrenceGroups(
  index: TokyoDateIndex<CalendarOccurrenceItem>,
  month: TokyoYearMonth,
): readonly CalendarOccurrenceDateGroup[] {
  const monthStart = firstDayOfMonth(month);
  const monthEnd = lastDayOfMonth(month);
  return [...index.byDate.keys()]
    .filter((date) => date >= monthStart && date <= monthEnd)
    .sort()
    .map((date) => ({
      date,
      items: selectCalendarOccurrenceItems(index, date),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * Groups each schedule entry once on the first date visible in the displayed
 * month. A carry-in entry is anchored to the month's first day while its
 * detail row keeps the original, unclipped temporal range.
 */
export function selectCalendarMonthScheduleGroups(
  index: TokyoDateIndex<CalendarScheduleItem>,
  month: TokyoYearMonth,
  callerId: UserId,
): readonly CalendarScheduleDateGroup[] {
  const monthStart = firstDayOfMonth(month);
  const monthEnd = lastDayOfMonth(month);
  const groups = new Map<TokyoCalendarDate, CalendarScheduleViewItem[]>();

  for (const item of uniqueScheduleItems(index.items)) {
    const range = calendarScheduleDateRange(item.entry);
    if (range.startDate > monthEnd || range.endDate < monthStart) {
      continue;
    }
    const anchor = range.startDate < monthStart ? monthStart : range.startDate;
    const existing = groups.get(anchor);
    const viewItem = {
      entry: item.entry,
      isOwner: item.entry.ownerId === callerId,
    };
    if (existing === undefined) {
      groups.set(anchor, [viewItem]);
    } else {
      existing.push(viewItem);
    }
  }

  return [...groups.entries()]
    .sort(([dateA], [dateB]) => (dateA < dateB ? -1 : dateA > dateB ? 1 : 0))
    .map(([date, items]) => ({
      date,
      items: [...items].sort(compareScheduleViewItems),
    }));
}
