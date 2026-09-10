import {
  compareInstants,
  instantToTokyoCalendarDate,
  isCanceled,
  type Event,
  type Occurrence,
  type TokyoCalendarDate,
} from "@stage-tracker/domain";
import type { EventCatalogEntry } from "@/lib/data";
import {
  buildMonthGridDays,
  type TokyoYearMonth,
} from "@/app/_lib/calendar-grid";
import {
  calendarDayRole,
  isWithinJapaneseHolidayDataCoverage,
  type CalendarDayRole,
} from "@/app/_lib/calendar-day-role";
import {
  layoutWeekBands,
  type BandSegment,
  type WeekBandLayout,
} from "@/app/_lib/calendar-band-layout";

/**
 * `/catalog`'s month-calendar presentation derivation, ported from
 * `apps/legacy-web/src/domain/calendarMonth.ts` (`docs/v2/oracle-domain.md`
 * §2.9 "Personal schedule / My Calendar": the multi-day-band-only-for-
 * multi-day-Events rule is stated there for "Event Catalog" specifically,
 * distinct from My Calendar's own PersonalSchedule bands). Everything here
 * is derived, read-only presentation computed from an already-fetched
 * `EventCatalogEntry[]` (`@/lib/data`'s `listEventCatalogInRange`) - it never
 * queries Supabase itself.
 *
 * Canonical presentation rule (ported verbatim from the legacy module this
 * mirrors):
 * - a single-day Event (`startsOn === endsOn`) never renders a band. It is
 *   represented only by the day-number count on its own date (see
 *   `computeBadgeCounts`).
 * - a multi-day Event (`startsOn < endsOn`) renders as an Event-range band
 *   only, and never contributes to the day-number count (see
 *   `eventRangeBandSegment`/`buildCatalogMonthViewModel`). The band spans
 *   `startsOn`..`endsOn` inclusive, as-is, regardless of how many
 *   occurrences (if any) exist - the Event range is a first-class fact
 *   (AGENTS.md "Event 開催期間（Event range）"), never split around a day
 *   with no occurrence evidence.
 * - the day-number count is a *single-day Event count*, not an occurrence
 *   count: a 0-occurrence single-day Event still counts once, and a
 *   single-day Event with several occurrences still counts once.
 * - the selected-day occurrence list is derived only from actual occurrence
 *   rows, independent of band/count coverage (see `selectDayOccurrences`).
 */

/**
 * True iff `event`'s Event range is exactly one calendar day. The canonical
 * single-day/multi-day classification for month-view presentation: a
 * single-day Event never bands and is represented only by the day-number
 * count; a multi-day Event is the reverse. The DB invariant `starts_on <=
 * ends_on` means this is equivalent to `!(startsOn < endsOn)`.
 */
export function isSingleDayEvent(event: Event): boolean {
  return event.startsOn === event.endsOn;
}

export interface EventCatalogBandSegment extends BandSegment {
  readonly startDate: TokyoCalendarDate;
  readonly endDate: TokyoCalendarDate;
}

/**
 * One band segment for `event`, spanning its Event range as-is. Only
 * meaningful for a multi-day event - callers must not call this for a
 * single-day one (`isSingleDayEvent`), which never bands.
 */
export function eventRangeBandSegment(event: Event): EventCatalogBandSegment {
  return {
    eventId: event.id,
    eventTitle: event.title,
    startDate: event.startsOn,
    endDate: event.endsOn,
    isCanceled: isCanceled(event),
  };
}

/**
 * Per-day count of *single-day* Events whose Event range is exactly that
 * day. This counts Events, not occurrences or performances: a 0-occurrence
 * single-day Event still counts once (otherwise it would be invisible on
 * the month grid), and a single-day Event with several occurrences (e.g.
 * matinee + evening) still counts once. A multi-day Event never contributes
 * here - it is represented by its band instead.
 */
export function computeBadgeCounts(
  entries: readonly EventCatalogEntry[],
): Map<TokyoCalendarDate, number> {
  const counts = new Map<TokyoCalendarDate, number>();
  for (const { event } of entries) {
    if (isSingleDayEvent(event)) {
      counts.set(event.startsOn, (counts.get(event.startsOn) ?? 0) + 1);
    }
  }
  return counts;
}

export interface DayCellViewModel {
  readonly date: TokyoCalendarDate;
  readonly inCurrentMonth: boolean;
  readonly badgeCount: number;
  readonly role: CalendarDayRole;
}

export interface WeekViewModel {
  readonly days: readonly DayCellViewModel[];
  readonly bandLayout: WeekBandLayout<EventCatalogBandSegment>;
}

export interface MonthCalendarViewModel {
  readonly month: TokyoYearMonth;
  readonly weeks: readonly WeekViewModel[];
  /** True when any date actually inside `month` (not a lead/trail cell)
   * falls outside the Japanese-holiday snapshot's confirmed coverage -
   * drives a month-level-only notice, never a per-day marker. */
  readonly hasUnconfirmedHolidayCoverage: boolean;
}

/**
 * Composes the grid, band segments, and badge counts into the full month
 * view model a presentation component can render directly.
 * `entries` should already cover the whole displayed grid (including
 * lead/trail days from adjacent months - `/catalog/page.tsx` fetches the
 * grid's own range), so lead/trail cells reflect real data instead of
 * always appearing empty.
 */
export function buildCatalogMonthViewModel(
  month: TokyoYearMonth,
  entries: readonly EventCatalogEntry[],
): MonthCalendarViewModel {
  const gridDays = buildMonthGridDays(month);
  const badgeCounts = computeBadgeCounts(entries);
  // Only multi-day events band - a single-day event is represented solely
  // by badgeCounts above, never also as a band, so the two signals never
  // name the same Event twice.
  const allSegments = entries
    .filter(({ event }) => !isSingleDayEvent(event))
    .map(({ event }) => eventRangeBandSegment(event));

  const weeks: WeekViewModel[] = [];
  for (let i = 0; i < gridDays.length; i += 7) {
    const weekDates = gridDays.slice(i, i + 7);
    weeks.push({
      days: weekDates.map((date) => ({
        date,
        inCurrentMonth:
          date.slice(0, 7) ===
          `${String(month.year).padStart(4, "0")}-${String(month.month).padStart(2, "0")}`,
        badgeCount: badgeCounts.get(date) ?? 0,
        role: calendarDayRole(date),
      })),
      bandLayout: layoutWeekBands(weekDates, allSegments),
    });
  }

  const monthKey = `${String(month.year).padStart(4, "0")}-${String(month.month).padStart(2, "0")}`;
  const hasUnconfirmedHolidayCoverage = gridDays.some(
    (date) =>
      date.slice(0, 7) === monthKey &&
      !isWithinJapaneseHolidayDataCoverage(date),
  );

  return { month, weeks, hasUnconfirmedHolidayCoverage };
}

export interface SelectedDayOccurrence {
  readonly event: Event;
  readonly occurrence: Occurrence;
}

function compareSelectedDayOccurrences(
  a: SelectedDayOccurrence,
  b: SelectedDayOccurrence,
): number {
  const byStart = compareInstants(a.occurrence.startsAt, b.occurrence.startsAt);
  if (byStart !== 0) {
    return byStart;
  }
  return a.occurrence.id < b.occurrence.id ? -1 : 1;
}

/**
 * Every occurrence on `date` (Asia/Tokyo calendar day), individually - never
 * collapsed by event or by day (same-day multiple occurrences are distinct
 * entries). This is the escape hatch for whatever the month view
 * bounded/omitted for scanability (band overflow): full detail for any
 * single day is always reachable here.
 */
export function selectDayOccurrences(
  entries: readonly EventCatalogEntry[],
  date: TokyoCalendarDate,
): readonly SelectedDayOccurrence[] {
  const result: SelectedDayOccurrence[] = [];
  for (const { event, occurrences } of entries) {
    for (const occurrence of occurrences) {
      if (instantToTokyoCalendarDate(occurrence.startsAt) === date) {
        result.push({ event, occurrence });
      }
    }
  }
  return result.sort(compareSelectedDayOccurrences);
}

/**
 * Event-level fallback candidates for one selected `date`: an event
 * qualifies iff `date` falls inside its Event range (`startsOn`..`endsOn`,
 * inclusive) *and* the event has no actual occurrence on `date` itself -
 * never "the event has 0 occurrences anywhere in the fetched set". A
 * multi-day event with an occurrence on one day of its range and none on
 * another must still surface as a fallback for the day it has none on.
 *
 * Complementary to `selectDayOccurrences` by construction: for a given
 * event/date pair, at most one of the two ever includes it, so a caller
 * rendering both side by side never shows the same event twice for the
 * same date. Never synthesizes an occurrence.
 */
export function selectEventLevelFallback(
  entries: readonly EventCatalogEntry[],
  date: TokyoCalendarDate,
): readonly EventCatalogEntry[] {
  return entries.filter((entry) => {
    const inRange = entry.event.startsOn <= date && date <= entry.event.endsOn;
    if (!inRange) {
      return false;
    }
    return !entry.occurrences.some(
      (occurrence) => instantToTokyoCalendarDate(occurrence.startsAt) === date,
    );
  });
}
