import type { TokyoCalendarDate } from "@stage-tracker/domain";
import { dayOfWeek } from "./calendar-grid";
import {
  isJapaneseHoliday,
  isWithinJapaneseHolidayDataCoverage,
  japaneseHolidayName,
} from "./japanese-holidays";

/**
 * Weekday / Japanese-holiday calendar presentation role, ported from the
 * M8 calendar-day-role oracle
 * (`docs/v2/oracle-domain.md` §2.11 "Calendar day role (曜日・祝日表示)").
 *
 * This is a *global* month-calendar rule, not `/catalog`-specific - kept in
 * `app/_lib` (like `./calendar-grid.ts`, whose own header already documents
 * being "shared by `/calendar` and `/catalog`") rather than under
 * `(app)/catalog/_lib`, so a later Task giving `/calendar` (My Calendar) the
 * same day-role coloring (a separate, already-known gap - see this Task's
 * report) can import this module unchanged instead of duplicating it.
 *
 * Rule (verbatim from the oracle):
 *   - Saturday is the "blue" role, Sunday and a Japanese national holiday
 *     are both the "red" role.
 *   - Saturday + holiday: holiday role wins.
 *   - Color is never the sole carrier of meaning (accessibility baseline) -
 *     this module returns a role, not a color; presentation code pairs it
 *     with non-color text (see `calendarDayRoleLabel`).
 */
export type CalendarDayRole = "holiday" | "saturday" | "sunday" | "weekday";

export { isWithinJapaneseHolidayDataCoverage };

/**
 * The presentation role for one Asia/Tokyo calendar date. Holiday takes
 * priority over Saturday. `'holiday'` is only ever reported for a date
 * within the snapshot's confirmed coverage (`isWithinJapaneseHolidayDataCoverage`)
 * - this is an explicit guard, not merely relying on `isJapaneseHoliday`
 * already returning `false` outside coverage, so this function can never
 * fabricate a holiday for a date the snapshot has not confirmed one way or
 * the other. Saturday/Sunday are still reported for an out-of-coverage date
 * - weekday-of-week is plain calendar arithmetic, independent of the
 * holiday snapshot.
 */
export function calendarDayRole(tokyoDate: TokyoCalendarDate): CalendarDayRole {
  if (
    isWithinJapaneseHolidayDataCoverage(tokyoDate) &&
    isJapaneseHoliday(tokyoDate)
  ) {
    return "holiday";
  }
  const weekday = dayOfWeek(tokyoDate);
  if (weekday === 6) {
    return "saturday";
  }
  if (weekday === 0) {
    return "sunday";
  }
  return "weekday";
}

/** A short, non-color label to pair with the role's color (accessibility
 * baseline: never color-only). For `'holiday'`, this is the actual official
 * holiday name; for the weekday roles, a fixed short marker. `'weekday'` has
 * no marker - an ordinary day carries no special-day semantics to
 * announce. */
export function calendarDayRoleLabel(
  tokyoDate: TokyoCalendarDate,
): string | null {
  const role = calendarDayRole(tokyoDate);
  if (role === "holiday") {
    return japaneseHolidayName(tokyoDate);
  }
  if (role === "saturday") {
    return "土";
  }
  if (role === "sunday") {
    return "日";
  }
  return null;
}
