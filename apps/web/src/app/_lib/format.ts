import {
  instantToTokyoCalendarDate,
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

const UNKNOWN_END_TIME_LABEL = "終了時刻未定";
const NEXT_DAY_SUFFIX = "（翌日）";

/**
 * Ported from `apps/legacy-web/src/domain/catalogFormatting.ts`'s
 * `occurrenceTimeRangeLabel` (codex review 指摘: `/catalog` の選択日一覧が
 * 開始時刻しか表示せず、終了時刻の有無・翌日終了を区別できなかった修正）。
 *
 * 終演時刻は不明な場合があり、未設定を正当な状態として扱う
 * （AGENTS.md「公演日程」）ので、既知の終了時刻が無いことを「終了時刻
 * 未定」という明示ラベルで示し、単に開始時刻だけを見せて「終了時刻を
 * 入力し忘れた」ように誤読させない。既知の終了時刻が開始日の翌 Tokyo
 * calendar date に及ぶ場合（23:00 開演 → 日付をまたいで終演等）、終了
 * 時刻だけを見ると開始時刻より小さい数字になり逆転して見えるため、
 * 「（翌日）」を付けて区別する。
 */
export function occurrenceTimeRangeLabel(
  startsAt: Instant,
  endsAt: Instant | null,
): string {
  const start = formatTokyoTime(startsAt);
  if (endsAt === null) {
    return `${start}〜（${UNKNOWN_END_TIME_LABEL}）`;
  }
  const end = formatTokyoTime(endsAt);
  const spansToNextDay =
    instantToTokyoCalendarDate(endsAt) !== instantToTokyoCalendarDate(startsAt);
  return spansToNextDay
    ? `${start}〜${end}${NEXT_DAY_SUFFIX}`
    : `${start}〜${end}`;
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
