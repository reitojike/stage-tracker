import { z } from "zod";
import { tokyoWallClockToInstant, type Instant } from "@stage-tracker/domain";

/**
 * `<input type="datetime-local">` の wall-clock 値（"YYYY-MM-DDTHH:mm"、秒
 * 無し）を Asia/Tokyo の instant へ変換する、この write boundary 共通の
 * parsing helper。
 *
 * `@stage-tracker/domain` は clock-free だが「今」を読まない設計であり、
 * オフセット演算自体（Asia/Tokyo が固定 +9h であること）は
 * `tokyoWallClockToInstant` が既に安全に実装している
 * （`packages/domain/src/time/tokyoConversion.ts` の
 * `dateUtcRoundTripMs` が範囲外日時・2桁年の罠を回避する）。ここでは
 * M8 oracle の `tokyoDateTimeLocalToInstant` のように独自の
 * `TOKYO_OFFSET_MS`
 * 演算を再実装しない — 同じ計算を二重に持たないための技術判断（この
 * タスクの報告に記録する）。
 */
const DATETIME_LOCAL_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u;

export function parseTokyoDateTimeLocal(raw: string): Instant | null {
  const match = DATETIME_LOCAL_PATTERN.exec(raw.trim());
  if (match === null) {
    return null;
  }
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  if (
    yearStr === undefined ||
    monthStr === undefined ||
    dayStr === undefined ||
    hourStr === undefined ||
    minuteStr === undefined
  ) {
    return null;
  }

  const result = tokyoWallClockToInstant({
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
    hour: Number(hourStr),
    minute: Number(minuteStr),
    second: secondStr === undefined ? 0 : Number(secondStr),
  });
  return result.ok ? result.value : null;
}

/** 必須の datetime-local フィールド用 Zod schema。値は `Instant`（domain
 * のブランド型）まで変換する。next-safe-action の `inputSchema` に渡すと、
 * 形式不正はそのまま field-level `validationErrors` として client へ返る
 * （A12: 手書き `FieldErrors` reader を作らない）。 */
export function requiredTokyoInstantSchema(invalidMessage: string) {
  return z.string().transform((value, ctx) => {
    const instant = parseTokyoDateTimeLocal(value);
    if (instant === null) {
      ctx.addIssue({ code: "custom", message: invalidMessage });
      return z.NEVER;
    }
    return instant;
  });
}

/** 空文字を「未設定（null）」として受理する datetime-local 用 Zod schema
 * （開場/終演等、未公表を正当な状態として扱うフィールド向け）。 */
export function optionalTokyoInstantSchema(invalidMessage: string) {
  return z.string().transform((value, ctx) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const instant = parseTokyoDateTimeLocal(trimmed);
    if (instant === null) {
      ctx.addIssue({ code: "custom", message: invalidMessage });
      return z.NEVER;
    }
    return instant;
  });
}
