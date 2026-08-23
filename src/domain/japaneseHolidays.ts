// Japanese national holiday lookup (Issue #34), over the generated
// snapshot in japaneseHolidaysData.ts.
//
// Holiday authority (docs/ux-ui.md "Calendar weekday / Japanese holiday
// presentation"): the Cabinet Office (内閣府)「国民の祝日について」CSV is
// the *only* canonical source. This module never computes a holiday from a
// rule (equinox calculation, "N-th Monday of month", etc.) and never
// extrapolates past whatever date the generated snapshot's coverage ends
// at - see JAPANESE_HOLIDAY_DATA_COVERAGE_END. A date past the snapshot's
// coverage is simply "not a known holiday" (isJapaneseHoliday returns
// false), never "assumed not a holiday because none was published yet" vs.
// "confirmed not a holiday" - callers that need to distinguish those two
// should consult isWithinJapaneseHolidayDataCoverage.
//
// This module is pure domain logic: no Supabase/DB import, no fetch (see
// the architecture import boundary in eslint.config.mjs) - the actual
// network fetch lives in scripts/update-japanese-holidays.mjs, a one-shot
// regeneration tool, not something this runtime module ever calls.

import {
  JAPANESE_HOLIDAY_DATA,
  JAPANESE_HOLIDAY_DATA_COVERAGE_END,
  JAPANESE_HOLIDAY_DATA_COVERAGE_START,
  type JapaneseHolidayRow,
} from './japaneseHolidaysData.ts';

const HOLIDAY_NAME_BY_DATE: ReadonlyMap<string, string> = new Map(
  JAPANESE_HOLIDAY_DATA.map((row: JapaneseHolidayRow) => [row.date, row.name]),
);

/** The official Japanese holiday name for an Asia/Tokyo calendar date
 * ("YYYY-MM-DD"), or `null` when that date is not a known holiday
 * (including a date outside the snapshot's coverage - see this module's
 * header). */
export function japaneseHolidayName(tokyoDate: string): string | null {
  return HOLIDAY_NAME_BY_DATE.get(tokyoDate) ?? null;
}

export function isJapaneseHoliday(tokyoDate: string): boolean {
  return HOLIDAY_NAME_BY_DATE.has(tokyoDate);
}

/** True iff `tokyoDate` falls within the snapshot's actually-published
 * coverage range - i.e. an absent holiday for this date is a confirmed
 * "not a holiday", not merely "not yet published". A date past the
 * coverage end is not itself wrong to query (isJapaneseHoliday still
 * answers `false`), but a caller rendering "unpublished" messaging for a
 * far-future month can use this to distinguish the two. */
export function isWithinJapaneseHolidayDataCoverage(tokyoDate: string): boolean {
  return (
    tokyoDate >= JAPANESE_HOLIDAY_DATA_COVERAGE_START &&
    tokyoDate <= JAPANESE_HOLIDAY_DATA_COVERAGE_END
  );
}

export {
  JAPANESE_HOLIDAY_DATA_COVERAGE_END,
  JAPANESE_HOLIDAY_DATA_COVERAGE_START,
  JAPANESE_HOLIDAY_DATA_FETCHED_AT,
  JAPANESE_HOLIDAY_DATA_SOURCE_URL,
} from './japaneseHolidaysData.ts';
