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

/**
 * PR #381 review finding 2（「DB / PostgREST の生エラーメッセージを画面へ
 * 出している」）への対応。
 *
 * `@/lib/safe-action.ts` の `toActionErrorShape` は、書き込み側で「分類
 * されていない例外の詳細（DB/RLS の生メッセージ、スタック等）を client へ
 * 渡さない」ため、`ActionError` を経由しない例外を常に固定の generic
 * message へ変換する。read 側もこの思想を踏襲する: `readError()` は
 * `message` を呼び出し元から一切受け取らない（型としてそもそも受け取れ
 * ない - 「型で防ぐ」ための設計）。PostgREST/network/mapping の生詳細は
 * `console.error` で server 側ログにのみ残し（`./supabase-select.ts`
 * `./row-mapping.ts` 参照）、この `message` は kind ごとに固定された
 * safe な文字列にする。
 *
 * ただしこの `message` 自体も UI の表示文言として直接使うことは想定しない
 * （画面ごとの文言は screen 層が variant を見て自分で書く -
 * `@/app/_lib/read-state.ts` の `ReadState`/`BlockState` は意図的に
 * `message` を持たない）。ここでの固定文字列は、`ReadError` を直接扱う
 * 呼び出し元（`@/app/_lib/require-authenticated-user-id.ts` 等）向けの
 * 汎用フォールバックに過ぎない。
 */
const READ_ERROR_MESSAGES: Readonly<Record<ReadErrorKind, string>> = {
  unauthenticated: "サインインが必要です。",
  "permission-denied": "この情報を見る権限がありません。",
  failure: "情報の取得に失敗しました。",
};

export function readError(kind: ReadErrorKind): ReadError {
  return { kind, message: READ_ERROR_MESSAGES[kind] };
}
