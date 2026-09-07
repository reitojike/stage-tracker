import type { BaseActionErrorKind } from "@/lib/action-error";

/**
 * Read boundary の失敗分類。
 *
 * `docs/v2/decisions.md` の M6 責務（「fetch 成功+0行 -> empty / fetch 失敗
 * -> error / 権限が無い・見えない -> unavailable」）を、書き込み系の
 * `ActionError`（`@/lib/action-error.ts`）が既に持つ共通 kind 語彙
 * （`BaseActionErrorKind`）を再利用して表現する。read 専用の別語彙は
 * 新設しない（このタスクの指示どおり）。
 *
 * read で実際に起こり得るのはこの3種だけ:
 *
 * - `unauthenticated`: セッションが無い/期限切れ。PostgREST/GoTrue が
 *   HTTP 401 を返す場合（`docs/v2/oracle-database.md` §0 の SQLSTATE
 *   慣習には現れないが、`@supabase/supabase-js` は未認証呼び出しを
 *   401 として返す）。
 * - `permission-denied`: RLS の table-level grant が無い、または
 *   Postgres が `42501`（insufficient_privilege）を投げる、明確な拒否。
 *   HTTP 403 もここに含める。
 * - `failure`: 上記以外の失敗（ネットワーク断、5xx、タイムアウト、
 *   想定外の応答形状、行の domain mapping 失敗 - 後者は
 *   `./row-mapping.ts` の A10 決定を参照）。
 *
 * `not-found` と `validation` は base 語彙に存在するが、この read boundary
 * では使わない: `not-found`（単一リソースを ID 指定で読む場合の「存在
 * しない」）はこの Task が対象とする4画面（一覧・範囲取得のみ）には
 * 現れず、`validation`（read の入力自体が不正）はパラメータ検証であり
 * 呼び出し元（画面層）の責務。
 *
 * `unauthenticated` と `permission-denied` はどちらも StatePanel の
 * `unavailable` variant へ写像する（`./read-result.ts` 参照）。両者を
 * 分けて保持するのは、「ログインへ誘導する」文言と「一般的な権限エラー」
 * 文言を screen 側が区別したくなった場合の裁量を残すため。
 */
export type ReadErrorKind = Extract<
  BaseActionErrorKind,
  "unauthenticated" | "permission-denied" | "failure"
>;

export interface ReadError {
  readonly kind: ReadErrorKind;
  readonly message: string;
}

export function readError(kind: ReadErrorKind, message: string): ReadError {
  return { kind, message };
}
