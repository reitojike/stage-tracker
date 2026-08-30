// Pure URL/param handling for the My Calendar feature (Issue #34),
// following the same "month calendar -> selected-day list" pattern
// catalogNavigation.ts already established for the Event Catalog
// (docs/ux-ui.md primary interaction pattern). Param parsing itself
// (resolveCatalogParams, isValidYearMonth/isValidCalendarDate) is generic
// over "a month/day query param pair" - not Event-Catalog-specific despite
// its name/module - so it is reused directly here rather than
// re-implemented; only the href shape below is feature-local (My Calendar
// lives at /calendar, not /catalog).

import { isValidCalendarDate, isValidYearMonth } from './calendarMonth.ts';
import {
  previousYearMonth as shiftPreviousYearMonth,
  nextYearMonth as shiftNextYearMonth,
} from './catalogNavigation.ts';

export { resolveCatalogParams as resolveMyCalendarParams } from './catalogNavigation.ts';
export type { CatalogParams as MyCalendarParams } from './catalogNavigation.ts';

export const previousYearMonth = shiftPreviousYearMonth;
export const nextYearMonth = shiftNextYearMonth;

export function myCalendarMonthHref(yearMonth: string): string {
  return `/calendar?month=${yearMonth}`;
}

export function myCalendarDayHref(yearMonth: string, date: string): string {
  return `/calendar?month=${yearMonth}&date=${date}`;
}

/** Issue #196: the selected-day "add" action/row's destination - carries
 * the selected date into /schedule/new's own bounded prefill contract (see
 * personalScheduleWrite.ts's resolveScheduleCreatePrefill), the same
 * "pass current context along" convention myCalendarDayHref/
 * catalogNewEventHref already use. */
export function scheduleNewHrefForDate(date: string): string {
  return `/schedule/new?date=${date}`;
}

/** A Personal Schedule detail link from My Calendar carries only the
 * displayed month, never entry-derived timing, so a later BackLink can
 * restore the user's actual calendar context for multi-day/carry-in entries. */
export function scheduleEntryHref(entryId: string, yearMonth: string): string {
  return `/schedule/${entryId}?month=${yearMonth}`;
}

/** The detail/edit round-trip shares this bounded month context. Invalid or
 * absent query values intentionally fall back to the calendar root. */
export function scheduleEntryBackHref(rawMonth: string | string[] | undefined): string {
  const month = firstValue(rawMonth);
  return month !== undefined && isValidYearMonth(month) ? myCalendarMonthHref(month) : '/calendar';
}

export function scheduleEntryDetailHref(
  entryId: string,
  rawMonth: string | string[] | undefined,
): string {
  const month = firstValue(rawMonth);
  return month !== undefined && isValidYearMonth(month)
    ? scheduleEntryHref(entryId, month)
    : `/schedule/${entryId}`;
}

export function scheduleEntryEditHref(
  entryId: string,
  rawMonth: string | string[] | undefined,
): string {
  const month = firstValue(rawMonth);
  return month !== undefined && isValidYearMonth(month)
    ? `/schedule/${entryId}/edit?month=${month}`
    : `/schedule/${entryId}/edit`;
}

/** Selected-day create links carry `date` for prefill. A valid date also
 * safely identifies the source month for the new-screen BackLink. */
export function scheduleNewBackHref(rawDate: string | string[] | undefined): string {
  const date = firstValue(rawDate);
  return date !== undefined && isValidCalendarDate(date)
    ? myCalendarMonthHref(date.slice(0, 7))
    : '/calendar';
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
