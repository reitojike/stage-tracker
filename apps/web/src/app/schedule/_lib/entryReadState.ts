import type { PersonalScheduleEntry } from "@stage-tracker/domain";
import {
  classifyReadResult,
  type ReadResult,
  type ReadState,
} from "@/lib/data";

/**
 * `/schedule/[entryId]` と `/schedule/[entryId]/edit` が `StatePanel` の
 * どの variant を描画するかを決める、この画面専用の1件版分類。
 *
 * PR #381 review finding 3（「同じ deterministic semantics を複数箇所に
 * 散らさない」）を受け、`@/lib/data` の `classifyReadResult`/
 * `toReadErrorVariant` - この codebase 全体で唯一の unavailable/error/empty
 * 判定 primitive - の上に載る薄い adapter として書き直した。以前の実装は
 * `ReadError.kind` → unavailable/error の写像を独自にここで再実装しており
 * （`toUnavailableOrError`）、`ReadState`/`ReadError` 型が持たない `message`
 * フィールドをこの型だけ独自に持たせていた（PR #381 review finding 2:
 * `unavailable`/`error` は生の PostgREST メッセージを画面へ運ぶ手段を型で
 * 塞ぐ - `@/lib/data/read-result.ts` 参照）。この adapter は
 * `ScheduleEntryReadState`/`ReadState<PersonalScheduleEntry>` を分離した
 * 型として保たず、そのままの alias にして二重管理をやめる。
 *
 * ここに残る schedule 固有のロジックは1点だけ: `PersonalScheduleEntry |
 * null` の `null`（`_lib/entryLookup.ts` の doc comment のとおり「そもそも
 * 存在しない entry」と「存在するが自分に見えない（非公開）entry」を RLS が
 * 区別できないため意図的に一体化した empty）を `classifyReadResult` の
 * `isEmpty` へそのまま渡すことだけで、kind → variant の写像そのものは
 * 一切複製しない。
 */
export type ScheduleEntryReadState = ReadState<PersonalScheduleEntry>;

export function classifyScheduleEntryReadResult(
  result: ReadResult<PersonalScheduleEntry | null>,
): ScheduleEntryReadState {
  const state = classifyReadResult(
    result,
    (value) => value,
    (value) => value === null,
  );
  // `isEmpty` 上記のとおり `value === null` を `empty` へ倒すため、
  // `variant === "populated"` の場合の `data` は実行時には常に非 null。
  // `classifyReadResult` は `isEmpty` の中身を型レベルで追跡できない
  // ジェネリック関数のため、ここで明示的に narrow する。
  return state.variant === "populated"
    ? { variant: "populated", data: state.data as PersonalScheduleEntry }
    : state;
}
