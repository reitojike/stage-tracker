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

/**
 * `unavailable`/`error` は意図的に `message` を持たない（PR #381 review
 * finding 2 - 詳細は下記 `classifyReadResult` のコメント参照）。表示文言は
 * 常に screen 層が `variant` を見て自分で決める。
 */
export type ReadState<T> =
  | { readonly variant: "unavailable" }
  | { readonly variant: "error" }
  | { readonly variant: "empty" }
  | { readonly variant: "populated"; readonly data: T };

/**
 * `ReadErrorKind` を StatePanel の variant へ写像する唯一の場所
 * （PR #381 review finding 3: この mapping を複数箇所で再実装しない -
 * `@/app/_lib/read-state.ts` の `classifyBlock1`/`classifyBlock2Optional`/
 * `classifyMergedListBlock2` もこの関数を import して使う、この codebase
 * 全体で唯一の primitive）。`unauthenticated`/`permission-denied` はどちらも
 * 「権限が無い/見えない」という同じ product 概念（`unavailable`）に属する
 * （`./read-error.ts` のコメント参照）。
 */
export function toReadErrorVariant(
  kind: ReadError["kind"],
): "unavailable" | "error" {
  return kind === "failure" ? "error" : "unavailable";
}

/**
 * 単一の `ReadResult` を、StatePanel が要求する3+1状態へ分類する、この
 * read boundary で唯一の分類 primitive（PR #381 review finding 3）。
 * この関数こそが「RLS の unavailable が empty へ化けることを防ぐ」という
 * M6 の中心的責務を体現する: `result.ok === false` の場合は `build`/
 * `isEmpty` を一切呼ばず（=中身に関わらず）`empty` にはならず、必ず
 * `unavailable`/`error` になる。`empty` は `result.ok === true` かつ
 * `isEmpty(build(result.value))` の場合のみに限定される。
 *
 * 配列以外（`build` で変換した任意の表示形）も表現できるよう `build`/
 * `isEmpty` を引数に取る - `classifyListReadResult` はこれを配列の
 * identity/長さ判定で特殊化した薄いラッパーに過ぎない。
 *
 * この `ReadState`/`BlockState` の `unavailable`/`error` variant は
 * 意図的に `message` を持たない（PR #381 review finding 2）: 生の
 * PostgREST/network メッセージを screen まで運ばない設計は `./read-error.ts`
 * の `readError()` 自体がすでに強制しているが、仮に将来 `ReadError.message`
 * が復活しても、この型に `message` フィールドが無い限り `StatePanel` の
 * `description` へ誤って渡せない（「型で防ぐ」）。画面ごとの description
 * 文言は screen 層（各 route の `_components` 配下の View）が `variant`
 * を見て自分で書く。
 */
export function classifyReadResult<A, T>(
  result: ReadResult<A>,
  build: (value: A) => T,
  isEmpty: (data: T) => boolean,
): ReadState<T> {
  if (!result.ok) {
    return { variant: toReadErrorVariant(result.error.kind) };
  }
  const data = build(result.value);
  return isEmpty(data) ? { variant: "empty" } : { variant: "populated", data };
}

/**
 * 配列を返す read（一覧系）の結果を分類する、`classifyReadResult` の薄い
 * 特殊化（`build` は identity、`isEmpty` は長さ判定）。
 */
export function classifyListReadResult<T>(
  result: ReadResult<readonly T[]>,
): ReadState<readonly T[]> {
  return classifyReadResult(
    result,
    (value) => value,
    (data) => data.length === 0,
  );
}
