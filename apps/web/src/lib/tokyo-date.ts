import {
  epochMsToInstant,
  instantToTokyoCalendarDate,
  type TokyoCalendarDate,
} from "@stage-tracker/domain";

/**
 * Server で読んだ「今」（epoch ms）を Asia/Tokyo calendar date へ変換する
 * 薄い adapter。`@stage-tracker/domain` は clock-free（「今」を引数として
 * 受け取り、自らは `Date.now()` を読まない）ため、実際の clock 読み取りは
 * application 側であるここが担う（AGENTS.md 設計方針 / packages/domain の
 * eslint guardrail 参照）。
 */
export function resolveServerTokyoDate(nowEpochMs: number): TokyoCalendarDate {
  return instantToTokyoCalendarDate(epochMsToInstant(nowEpochMs));
}
