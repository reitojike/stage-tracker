import type { TokyoCalendarDate } from "@stage-tracker/domain";
import {
  formatMonthParam,
  tokyoYearMonthOf,
  type TokyoYearMonth,
} from "@/app/_lib/calendar-grid";

/**
 * `/catalog`'s own month/day/event href builders (`docs/v2/oracle-domain.md`
 * §2.10 "Catalog navigation"). Kept local to this feature (unlike
 * `@/app/_lib/calendar-grid.ts`'s date math) since the destination paths
 * (`/catalog`, `/catalog/events/[id]`) are `/catalog`-specific, mirroring
 * the M8 catalog-navigation oracle's href helpers.
 */

export function catalogMonthHref(month: TokyoYearMonth): string {
  return `/catalog?month=${formatMonthParam(month)}`;
}

/** A day-cell href always carries `date`'s own month (not necessarily the
 * currently displayed `month`) - a lead/trail cell from an adjacent month
 * must navigate the grid onto that month, not stay pinned to the currently
 * displayed one. Matches `/calendar`'s own `dayHref` (`CalendarView.tsx`). */
export function catalogDayHref(date: TokyoCalendarDate): string {
  return `/catalog?month=${formatMonthParam(tokyoYearMonthOf(date))}&date=${date}`;
}

export function catalogEventHref(
  eventId: string,
  month: TokyoYearMonth,
  selectedDate: TokyoCalendarDate | null,
  occurrenceId?: string,
): string {
  const params = new URLSearchParams({ month: formatMonthParam(month) });
  if (selectedDate !== null) {
    params.set("date", selectedDate);
  }
  if (occurrenceId !== undefined) {
    params.set("occurrence", occurrenceId);
  }
  return `/catalog/events/${eventId}?${params.toString()}`;
}
