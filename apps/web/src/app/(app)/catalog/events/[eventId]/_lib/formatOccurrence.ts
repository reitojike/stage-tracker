import {
  instantToTokyoCalendarDate,
  type Occurrence,
} from "@stage-tracker/domain";
import { addDays } from "@/app/_lib/calendar-grid";
import {
  formatTokyoCalendarDateJa,
  formatTokyoCalendarDateWithYearJa,
  formatTokyoTime,
} from "@/lib/tokyo-format";

/**
 * `Asia/Tokyo` 表示用の日時整形。Event time semantics follow Spec 005;
 * this route-local formatter owns exact presentation.
 * この route 専用の pure/clock-free ヘルパー。現在時刻は読まず、入力値
 * だけを整形するため、実装とテストがこの helper の契約を所有する。
 */

/** 例: "2026年3月10日(火) 18:00" */
export function formatOccurrenceDateTime(occurrence: Occurrence): string {
  return `${formatTokyoCalendarDateWithYearJa(
    instantToTokyoCalendarDate(occurrence.startsAt),
  )} ${formatTokyoTime(occurrence.startsAt)}`;
}

/** doorsAt が null の場合は null（未公表を正当な状態として扱う - Spec 005）。 */
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
