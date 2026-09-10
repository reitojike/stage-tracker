import type { TokyoCalendarDate } from "@stage-tracker/domain";
import {
  JAPANESE_HOLIDAY_DATA,
  JAPANESE_HOLIDAY_DATA_COVERAGE_END,
  JAPANESE_HOLIDAY_DATA_COVERAGE_START,
  type JapaneseHolidayRow,
} from "./japanese-holidays-data";

/**
 * Japanese national holiday lookup, ported from
 * `apps/legacy-web/src/domain/japaneseHolidays.ts` (`docs/v2/oracle-domain.md`
 * §2.11 "Calendar day role"). Reuses the same generated snapshot data
 * (`./japanese-holidays-data.ts`) as the *only* canonical source - this
 * module never computes a holiday from a rule (equinox calculation, "N-th
 * Monday of month", etc.) and never extrapolates past the snapshot's
 * coverage end. A date past coverage is simply "not a known holiday"
 * (`isJapaneseHoliday` returns `false`), never conflated with "confirmed not
 * a holiday" - callers needing that distinction use
 * `isWithinJapaneseHolidayDataCoverage`.
 */

const HOLIDAY_NAME_BY_DATE: ReadonlyMap<string, string> = new Map(
  JAPANESE_HOLIDAY_DATA.map((row: JapaneseHolidayRow) => [row.date, row.name]),
);

export function japaneseHolidayName(
  tokyoDate: TokyoCalendarDate,
): string | null {
  return HOLIDAY_NAME_BY_DATE.get(tokyoDate) ?? null;
}

export function isJapaneseHoliday(tokyoDate: TokyoCalendarDate): boolean {
  return HOLIDAY_NAME_BY_DATE.has(tokyoDate);
}

/** True iff `tokyoDate` falls within the snapshot's actually-published
 * coverage range - i.e. an absent holiday for this date is a confirmed "not
 * a holiday", not merely "not yet published". */
export function isWithinJapaneseHolidayDataCoverage(
  tokyoDate: TokyoCalendarDate,
): boolean {
  return (
    tokyoDate >= JAPANESE_HOLIDAY_DATA_COVERAGE_START &&
    tokyoDate <= JAPANESE_HOLIDAY_DATA_COVERAGE_END
  );
}
