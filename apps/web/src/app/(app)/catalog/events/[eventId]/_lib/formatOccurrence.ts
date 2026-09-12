import {
  instantToTokyoCalendarDate,
  type Occurrence,
} from "@stage-tracker/domain";
import { addDays } from "@/app/_lib/calendar-grid";
import {
  formatTokyoCalendarDateJa,
  formatTokyoCalendarDateWithYearJa,
  formatTokyoTime,
} from "@/app/_lib/format";

/**
 * `Asia/Tokyo` 表示用の日時整形（AGENTS.md「時刻・タイムゾーン」）。
 * この route 専用の pure/clock-free ヘルパー
 * （`docs/v2/decisions.md` A6: 「今」を読まない限り各 route が個別に
 * 持ってよい）。
 */

/** 例: "2026年3月10日(火) 18:00" */
export function formatOccurrenceDateTime(occurrence: Occurrence): string {
  return `${formatTokyoCalendarDateWithYearJa(
    instantToTokyoCalendarDate(occurrence.startsAt),
  )} ${formatTokyoTime(occurrence.startsAt)}`;
}

/** doorsAt が null の場合は null（未公表を正当な状態として扱う - AGENTS.md「開場 / 開演 / 終演」）。 */
export function formatOccurrenceDoors(occurrence: Occurrence): string | null {
  if (occurrence.doorsAt === null) {
    return null;
  }
  const startDate = instantToTokyoCalendarDate(occurrence.startsAt);
  const doorsDate = instantToTokyoCalendarDate(occurrence.doorsAt);
  const time = formatTokyoTime(occurrence.doorsAt);
  if (doorsDate === startDate) {
    return `開場 ${time}`;
  }
  if (doorsDate === addDays(startDate, -1)) {
    return `開場 ${time}（前日）`;
  }
  return `開場 ${formatTokyoCalendarDateJa(doorsDate)} ${time}`;
}

/** endsAt が null の場合は null（終演時刻不明を正当な状態として扱う）。 */
export function formatOccurrenceEnds(occurrence: Occurrence): string | null {
  if (occurrence.endsAt === null) {
    return null;
  }
  const startDate = instantToTokyoCalendarDate(occurrence.startsAt);
  const endDate = instantToTokyoCalendarDate(occurrence.endsAt);
  const time = formatTokyoTime(occurrence.endsAt);
  if (endDate === startDate) {
    return `終演 ${time}`;
  }
  if (endDate === addDays(startDate, 1)) {
    return `終演 ${time}（翌日）`;
  }
  return `終演 ${formatTokyoCalendarDateJa(endDate)} ${time}`;
}
