import type { TokyoCalendarDate } from "@stage-tracker/domain";
import { formatMonthParam, type TokyoYearMonth } from "./calendar-grid";
import { isWithinJapaneseHolidayDataCoverage } from "./calendar-day-role";

/** Shared month-level notice projection for both calendar consumers. */
export function hasUnconfirmedHolidayCoverage(
  month: TokyoYearMonth,
  gridDays: readonly TokyoCalendarDate[],
): boolean {
  const monthKey = formatMonthParam(month);
  return gridDays.some(
    (date) =>
      date.slice(0, 7) === monthKey &&
      !isWithinJapaneseHolidayDataCoverage(date),
  );
}
