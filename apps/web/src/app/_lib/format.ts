import {
  instantToTokyoWallClock,
  type Instant,
  type TokyoCalendarDate,
} from "@stage-tracker/domain";
import { weekdayLabelJa } from "./calendar-grid";

/** `HH:MM` in Asia/Tokyo wall-clock time - never a raw `Instant`/`Date`
 * formatting shortcut, so every display site goes through the same fixed
 * +9h conversion as the rest of the app (`@stage-tracker/domain`'s
 * `instantToTokyoWallClock`). */
export function formatTokyoTime(instant: Instant): string {
  const wallClock = instantToTokyoWallClock(instant);
  return `${String(wallClock.hour).padStart(2, "0")}:${String(wallClock.minute).padStart(2, "0")}`;
}

/** `M月D日(曜)` display for a `TokyoCalendarDate`. */
export function formatTokyoCalendarDateJa(date: TokyoCalendarDate): string {
  const [, monthStr, dayStr] = date.split("-");
  return `${Number(monthStr)}月${Number(dayStr)}日(${weekdayLabelJa(date)})`;
}

/** `YYYY年M月` display for a month key ("YYYY-MM"). */
export function formatMonthJa(monthKey: string): string {
  const [yearStr, monthStr] = monthKey.split("-");
  return `${yearStr}年${Number(monthStr)}月`;
}
