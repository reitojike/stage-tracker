import {
  instantToTokyoCalendarDate,
  instantToTokyoWallClock,
  type Instant,
  type TokyoCalendarDate,
} from "@stage-tracker/domain";

/**
 * Pure Tokyo date/time display primitives shared by actions and presentation.
 * This module intentionally has no dependency on `app/**` route ownership.
 */

function utcFromYmd(year: number, month: number, day: number): Date {
  const asUtc = new Date(0);
  asUtc.setUTCFullYear(year, month - 1, day);
  return asUtc;
}

/** 0 = Sunday, matching `Date.prototype.getUTCDay()`. */
export function dayOfWeek(date: TokyoCalendarDate): number {
  const [yearStr, monthStr, dayStr] = date.split("-");
  return utcFromYmd(
    Number(yearStr),
    Number(monthStr),
    Number(dayStr),
  ).getUTCDay();
}

const WEEKDAY_LABELS_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function weekdayLabelJa(date: TokyoCalendarDate): string {
  return WEEKDAY_LABELS_JA[dayOfWeek(date)] ?? "";
}

/** `HH:MM` in Asia/Tokyo wall-clock time. */
export function formatTokyoTime(instant: Instant): string {
  const wallClock = instantToTokyoWallClock(instant);
  return `${String(wallClock.hour).padStart(2, "0")}:${String(wallClock.minute).padStart(2, "0")}`;
}

/** `M月D日(曜)` display for a `TokyoCalendarDate`. */
export function formatTokyoCalendarDateJa(date: TokyoCalendarDate): string {
  const [, monthStr, dayStr] = date.split("-");
  return `${Number(monthStr)}月${Number(dayStr)}日(${weekdayLabelJa(date)})`;
}

/** `YYYY年M月D日(曜)` display when the year is part of the detail context. */
export function formatTokyoCalendarDateWithYearJa(
  date: TokyoCalendarDate,
): string {
  const [yearStr] = date.split("-");
  return `${Number(yearStr)}年${formatTokyoCalendarDateJa(date)}`;
}

/** Date-only range display for Tokyo calendar dates, preserving date precision. */
export function formatTokyoCalendarDateRangeJa(
  startsOn: TokyoCalendarDate,
  endsOn: TokyoCalendarDate,
): string {
  const start = formatTokyoCalendarDateJa(startsOn);
  return startsOn === endsOn
    ? start
    : `${start} 〜 ${formatTokyoCalendarDateJa(endsOn)}`;
}

/** Date and time display for an instant using Tokyo calendar semantics. */
export function formatTokyoDateTimeJa(instant: Instant): string {
  return `${formatTokyoCalendarDateJa(instantToTokyoCalendarDate(instant))} ${formatTokyoTime(instant)}`;
}
