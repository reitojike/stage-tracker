// Pure URL/param handling for the Catalog feature (Issue #20)'s
// "month calendar -> selected-day list -> event detail" navigation
// (docs/ux-ui.md primary interaction pattern). Kept free of Next.js types
// so it is plain, DB-free, unit-testable logic like the rest of src/domain.
//
// Validity of a "YYYY-MM"/"YYYY-MM-DD" value is delegated to
// calendarMonth.ts's isValidYearMonth/isValidCalendarDate (which reuse
// eventCatalog.ts's Date.UTC round-trip check) rather than a shape-only
// regex here: a value like "2026-13" or "2026-02-30" is digit-shape-valid
// but not a real calendar month/date, and treating it as valid would let a
// malformed query param silently drive the grid to a rolled-over month
// instead of being ignored like any other malformed value.

import { isValidCalendarDate, isValidYearMonth } from './calendarMonth.ts';

export interface CatalogParams {
  yearMonth: string;
  /** null when no day is selected yet (bare month-calendar view). */
  selectedDate: string | null;
}

/**
 * Resolves the effective month/selected-day from raw (and possibly
 * missing/malformed) query params, given the caller's notion of "today"
 * (Asia/Tokyo calendar date) as the default. A valid `date` always wins for
 * deriving the displayed month - a `month` param that disagreed with it
 * would otherwise let the grid and the selected day silently drift apart.
 * Malformed values are ignored rather than surfaced as an error: this is
 * client-supplied navigation state, not domain data.
 */
export function resolveCatalogParams(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
  todayTokyoDate: string,
): CatalogParams {
  const rawDate = firstValue(searchParams.date);
  const selectedDate = rawDate !== undefined && isValidCalendarDate(rawDate) ? rawDate : null;

  const rawMonth = firstValue(searchParams.month);
  const monthFromDate = selectedDate?.slice(0, 7) ?? null;
  const monthFromParam = rawMonth !== undefined && isValidYearMonth(rawMonth) ? rawMonth : null;
  const yearMonth = monthFromDate ?? monthFromParam ?? todayTokyoDate.slice(0, 7);

  return { yearMonth, selectedDate };
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function previousYearMonth(yearMonth: string): string {
  return shiftYearMonth(yearMonth, -1);
}

export function nextYearMonth(yearMonth: string): string {
  return shiftYearMonth(yearMonth, 1);
}

function shiftYearMonth(yearMonth: string, delta: number): string {
  if (!isValidYearMonth(yearMonth)) {
    throw new Error(`expected a valid "YYYY-MM" month, got: ${yearMonth}`);
  }
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  // Absolute zero-based month index (from year 0), so both the year carry
  // and the month wraparound fall out of one division/modulo instead of
  // needing separate under/overflow branches.
  const totalMonths = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = ((totalMonths % 12) + 12) % 12;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth + 1).padStart(2, '0')}`;
}

export function catalogMonthHref(yearMonth: string): string {
  return `/catalog?month=${yearMonth}`;
}

export function catalogDayHref(yearMonth: string, date: string): string {
  return `/catalog?month=${yearMonth}&date=${date}`;
}

export function catalogEventHref(eventId: string, context: CatalogParams): string {
  const params = new URLSearchParams({ month: context.yearMonth });
  if (context.selectedDate !== null) {
    params.set('date', context.selectedDate);
  }
  return `/catalog/events/${eventId}?${params.toString()}`;
}
