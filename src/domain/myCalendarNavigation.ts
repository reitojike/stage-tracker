// Pure URL/param handling for the My Calendar feature (Issue #34),
// following the same "month calendar -> selected-day list" pattern
// catalogNavigation.ts already established for the Event Catalog
// (docs/ux-ui.md primary interaction pattern). Param parsing itself
// (resolveCatalogParams, isValidYearMonth/isValidCalendarDate) is generic
// over "a month/day query param pair" - not Event-Catalog-specific despite
// its name/module - so it is reused directly here rather than
// re-implemented; only the href shape below is feature-local (My Calendar
// lives at /calendar, not /catalog).

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
