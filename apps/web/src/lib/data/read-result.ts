import type { Result } from "@stage-tracker/domain";
import type { ReadError } from "./read-error";

/**
 * すべての read boundary 関数の戻り値の形。例外で boundary を突き破らせず、
 * 呼び出し元に必ず成功/失敗を明示的に判定させる（このタスクの絶対要件）。
 */
export type ReadResult<T> = Result<T, ReadError>;

/**
 * `docs/v2/decisions.md`「M6 が負う責任」節が定義する StatePanel 向けの
 * 3状態 + `populated`（実データがあり、そもそも empty/error/unavailable
 * パネルを描画しない状態）。
 *
 * ```
 * fetch 成功 + 0 行   -> empty
 * fetch 失敗           -> error
 * 権限が無い / 見えない -> unavailable
 * ```
 *
 * この分類の判定はここ（read boundary）だけが行う。画面層は
 * `variant` を見て StatePanel を描画するかデータを描画するかを選ぶだけで、
 * 「0行がRLSによる不可視のせいかもしれない」という判断を画面側で
 * 再度行わせない。
 */
export type ReadStateVariant = "unavailable" | "error" | "empty" | "populated";

export type ReadState<T> =
  | { readonly variant: "unavailable"; readonly message: string }
  | { readonly variant: "error"; readonly message: string }
  | { readonly variant: "empty" }
  | { readonly variant: "populated"; readonly data: T };

/**
 * `ReadErrorKind` を StatePanel の variant へ写像する唯一の場所。
 * `unauthenticated`/`permission-denied` はどちらも「権限が無い/見えない」
 * という同じ product 概念（`unavailable`）に属する
 * （`./read-error.ts` のコメント参照）。
 */
function toUnavailableOrError(
  kind: ReadError["kind"],
): "unavailable" | "error" {
  return kind === "failure" ? "error" : "unavailable";
}

/**
 * 配列を返す read（一覧系）の結果を、StatePanel が要求する3+1状態へ分類
 * する。この関数こそが「RLS の unavailable が empty へ化けることを防ぐ」
 * という M6 の中心的責務を体現する: `result.ok === false` の場合は
 * 行数に関わらず `empty` にはならず、必ず `unavailable`/`error` になる。
 * `empty` は `result.ok === true && result.value.length === 0` の場合の
 * みに限定される。
 */
export function classifyListReadResult<T>(
  result: ReadResult<readonly T[]>,
): ReadState<readonly T[]> {
  if (!result.ok) {
    return {
      variant: toUnavailableOrError(result.error.kind),
      message: result.error.message,
    };
  }
  if (result.value.length === 0) {
    return { variant: "empty" };
  }
  return { variant: "populated", data: result.value };
}
