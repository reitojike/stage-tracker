import type { PersonalScheduleEntry } from "@stage-tracker/domain";
import type { ReadError, ReadResult } from "@/lib/data";

/**
 * `/schedule/[entryId]` と `/schedule/[entryId]/edit` が `StatePanel` の
 * どの variant を描画するかを決める、この画面専用の1件版
 * 分類関数。`lib/data/read-result.ts` の `classifyListReadResult`
 * （一覧版）と同じ考え方を単一 nullable 値へ適用したもの - `lib/data/` は
 * 変更禁止のため複製するが、ロジック自体は `ReadError.kind` →
 * unavailable/error の写像という同じ1行に揃えている
 * （decisions.md「M6 が負う責任」節）。
 */
export type ScheduleEntryReadState =
  | { readonly variant: "unavailable"; readonly message: string }
  | { readonly variant: "error"; readonly message: string }
  | { readonly variant: "empty" }
  | { readonly variant: "populated"; readonly data: PersonalScheduleEntry };

function toUnavailableOrError(
  kind: ReadError["kind"],
): "unavailable" | "error" {
  return kind === "failure" ? "error" : "unavailable";
}

export function classifyScheduleEntryReadResult(
  result: ReadResult<PersonalScheduleEntry | null>,
): ScheduleEntryReadState {
  if (!result.ok) {
    return {
      variant: toUnavailableOrError(result.error.kind),
      message: result.error.message,
    };
  }
  // `result.value === null` は「そもそも存在しない」と「存在するが自分に
  // 見えない（非公開）」の両方を表す - `_lib/entryLookup.ts` の doc
  // comment のとおり意図的に一体化された `empty` である。
  if (result.value === null) {
    return { variant: "empty" };
  }
  return { variant: "populated", data: result.value };
}
