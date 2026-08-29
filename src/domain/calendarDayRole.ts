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
import {
  isJapaneseHoliday,
  isWithinJapaneseHolidayDataCoverage,
  japaneseHolidayName,
} from './japaneseHolidays.ts';

export type CalendarDayRole = 'holiday' | 'saturday' | 'sunday' | 'weekday';

/** Re-exported from japaneseHolidays.ts so callers of this module (the
 * *presentation role* boundary) don't also need a separate import from the
 * *holiday data* module just to know whether a date's holiday status is
 * confirmed - see that module's own header for what "confirmed" means. */
export { isWithinJapaneseHolidayDataCoverage };

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
 *
 * `'holiday'` is only ever reported for a date within the snapshot's
 * confirmed coverage (`isWithinJapaneseHolidayDataCoverage`) - this is an
 * explicit guard, not merely relying on `isJapaneseHoliday` already
 * returning `false` outside coverage, so this function can never fabricate
 * a holiday for a date the snapshot hasn't confirmed one way or the other
 * (PO adjudication on Issue #34: "Do NOT compute/guess/infer holiday
 * status for out-of-coverage dates"). Saturday/Sunday are still reported
 * for an out-of-coverage date - weekday-of-week is plain calendar
 * arithmetic, independent of the holiday snapshot - but callers that need
 * to know whether *this date's holiday status itself* is confirmed must
 * separately consult `isWithinJapaneseHolidayDataCoverage` (re-exported
 * above), since an out-of-coverage Saturday could still turn out to be a
 * holiday once the Cabinet Office publishes that year.
 */
export function calendarDayRole(tokyoDate: string): CalendarDayRole {
  if (isWithinJapaneseHolidayDataCoverage(tokyoDate) && isJapaneseHoliday(tokyoDate)) {
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

const WEEKDAY_GLYPHS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** The visible weekday character for a date, always present regardless of
 * role - unlike calendarDayRoleLabel above, which returns the *holiday
 * name* for a holiday and `null` for an ordinary weekday. Issue #189: a
 * list-date heading's visible weekday glyph must never be replaced by the
 * holiday name (that would suppress "which day of the week" information a
 * holiday-on-Tuesday date still needs to show). */
export function calendarDateWeekdayGlyph(tokyoDate: string): string {
  const glyph = WEEKDAY_GLYPHS[weekdayOf(tokyoDate)];
  if (glyph === undefined) {
    throw new Error(`unexpected weekday index for ${tokyoDate}`);
  }
  return glyph;
}

/**
 * "8月30日（日）" - the single shared "M月D日（曜）" list-date label (Issue
 * #189 Task Contract), full-width parentheses, every weekday included (not
 * just Saturday/Sunday/holiday). This is the one place every list-date
 * surface (Home upcoming, Event Catalog selected-date, My Calendar
 * selected-date, Tickets date column) derives its visible date text from -
 * callers must not re-implement their own month/day/weekday formatting.
 */
export function calendarDateWeekdayLabel(tokyoDate: string): string {
  const { month, day } = parseTokyoCalendarDate(tokyoDate);
  return `${String(month)}月${String(day)}日（${calendarDateWeekdayGlyph(tokyoDate)}）`;
}

/**
 * `calendarDateWeekdayLabel` plus the official holiday name for a
 * `'holiday'`-role date - for a non-visible-text accessibility channel
 * (e.g. an `aria-label`), since the visible label itself deliberately never
 * substitutes the holiday name for the weekday glyph (see
 * calendarDateWeekdayGlyph). Color is never the sole carrier of a holiday's
 * meaning (this module's own accessibility baseline, see header) - callers
 * that render this module's color role for a date should pair it with this
 * label somewhere non-color, not just the plain calendarDateWeekdayLabel.
 * Identical to calendarDateWeekdayLabel for every non-holiday role.
 */
export function calendarDateAccessibleWeekdayLabel(tokyoDate: string): string {
  const label = calendarDateWeekdayLabel(tokyoDate);
  const holidayName = calendarDayRoleLabel(tokyoDate);
  if (calendarDayRole(tokyoDate) !== 'holiday' || holidayName === null) {
    return label;
  }
  return `${label}（${holidayName}）`;
}
