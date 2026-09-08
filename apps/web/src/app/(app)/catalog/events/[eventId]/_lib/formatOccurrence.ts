import {
  instantToEpochMs,
  instantToTokyoWallClock,
  TOKYO_OFFSET_MS,
  type Instant,
  type Occurrence,
} from "@stage-tracker/domain";

/**
 * `Asia/Tokyo` 表示用の日時整形（AGENTS.md「時刻・タイムゾーン」）。
 * この route 専用の pure/clock-free ヘルパー
 * （`docs/v2/decisions.md` A6: 「今」を読まない限り各 route が個別に
 * 持ってよい）。
 */

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * `instantToTokyoWallClock` は曜日を返さないため、同じ「固定 +9h オフセット」
 * の変換式 (`packages/domain/src/time/tokyoConversion.ts`
 * `instantToTokyoWallClock` 参照) をここでも使って曜日 index を導出する。
 */
function tokyoWeekdayIndex(instant: Instant): number {
  const tokyoMs = instantToEpochMs(instant) + TOKYO_OFFSET_MS;
  return new Date(tokyoMs).getUTCDay();
}

function formatTime(instant: Instant): string {
  const wallClock = instantToTokyoWallClock(instant);
  return `${pad2(wallClock.hour)}:${pad2(wallClock.minute)}`;
}

/** 例: "2026年3月10日(火) 18:00" */
export function formatOccurrenceDateTime(occurrence: Occurrence): string {
  const wallClock = instantToTokyoWallClock(occurrence.startsAt);
  const weekday = WEEKDAY_LABELS[tokyoWeekdayIndex(occurrence.startsAt)] ?? "";
  return `${wallClock.year}年${wallClock.month}月${wallClock.day}日(${weekday}) ${formatTime(occurrence.startsAt)}`;
}

/** doorsAt が null の場合は null（未公表を正当な状態として扱う - AGENTS.md「開場 / 開演 / 終演」）。 */
export function formatOccurrenceDoors(occurrence: Occurrence): string | null {
  if (occurrence.doorsAt === null) {
    return null;
  }
  return `開場 ${formatTime(occurrence.doorsAt)}`;
}

/** endsAt が null の場合は null（終演時刻不明を正当な状態として扱う）。 */
export function formatOccurrenceEnds(occurrence: Occurrence): string | null {
  if (occurrence.endsAt === null) {
    return null;
  }
  return `終演 ${formatTime(occurrence.endsAt)}`;
}
