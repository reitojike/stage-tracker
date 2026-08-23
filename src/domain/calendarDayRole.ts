// Weekday / Japanese-holiday calendar presentation role (Issue #34), per
// docs/ux-ui.md "Calendar weekday / Japanese holiday presentation" - a
// *global* rule (applies to "month calendar全体"), so this module is kept
// independent of any single feature's calendar (My Calendar wires it in for
// this Task; a later Task may wire the same module into the Event Catalog
// calendar without re-deriving this classification).
//
// Rule, verbatim from docs/ux-ui.md:
//   - Saturday is the "blue" role.
//   - Sunday is the "red" role.
//   - A Japanese national holiday is the "red" role.
//   - Saturday + holiday: holiday role wins.
//   - Color is never the sole carrier of meaning (accessibility baseline) -
//     this module returns a role, not a color; presentation code pairs it
//     with an icon/text/pattern.
//
// Pure domain logic: no Supabase/DB import (see the architecture import
// boundary in eslint.config.mjs).

import { parseTokyoCalendarDate } from './eventCatalog.ts';
import { isJapaneseHoliday, japaneseHolidayName } from './japaneseHolidays.ts';

export type CalendarDayRole = 'holiday' | 'saturday' | 'sunday' | 'weekday';

/** Plain proleptic-Gregorian weekday-of, matching calendarMonth.ts's own
 * (private) weekdayOf - this is calendar arithmetic, independent of any
 * timezone offset (see calendarMonth.ts's header for why Date.UTC is safe
 * to use this way for a "YYYY-MM-DD" string). Not imported from
 * calendarMonth.ts to avoid a two-way dependency between the two modules;
 * duplicating this one-line calculation is cheaper than either importing
 * it or exporting it from an unrelated module solely for this reuse. */
function weekdayOf(tokyoDate: string): number {
  const { year, month, day } = parseTokyoCalendarDate(tokyoDate);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The presentation role for one Asia/Tokyo calendar date. Holiday takes
 * priority over Saturday (docs/ux-ui.md: "SaturdayとJapanese holidayが
 * 重なる場合は、holiday presentationを優先"), so a holiday that falls on a
 * Saturday reports `'holiday'`, never `'saturday'`.
 */
export function calendarDayRole(tokyoDate: string): CalendarDayRole {
  if (isJapaneseHoliday(tokyoDate)) {
    return 'holiday';
  }
  const weekday = weekdayOf(tokyoDate);
  if (weekday === 6) {
    return 'saturday';
  }
  if (weekday === 0) {
    return 'sunday';
  }
  return 'weekday';
}

/** A short, non-color label to pair with the role's color (accessibility
 * baseline: never color-only). For `'holiday'`, this is the actual
 * official holiday name (more informative than a generic "holiday" label);
 * for the weekday roles, a fixed short marker. `'weekday'` has no marker -
 * an ordinary day carries no special-day semantics to announce. */
export function calendarDayRoleLabel(tokyoDate: string): string | null {
  const role = calendarDayRole(tokyoDate);
  if (role === 'holiday') {
    return japaneseHolidayName(tokyoDate);
  }
  if (role === 'saturday') {
    return '土';
  }
  if (role === 'sunday') {
    return '日';
  }
  return null;
}
