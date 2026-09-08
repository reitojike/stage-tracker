import type { PostgrestError } from "@supabase/supabase-js";
import { ActionError, type BaseActionErrorKind } from "@/lib/action-error";

/**
 * PostgREST/RPC 呼び出しの失敗を `ActionError` へ分類する、この write 層の
 * 唯一の判定場所。`docs/v2/decisions.md` A8「エラー分類を
 * `error.message.includes(...)` の文字列マッチングで行わない」を守り、
 * PostgREST の HTTP status と Postgres の SQLSTATE（`error.code`）という
 * 構造化された情報だけで判定する（read boundary の
 * `lib/data/supabase-select.ts` の `classifyPostgrestError` と対の write 版）。
 *
 * `error.message` 自体は分岐の材料にしないが、ユーザー向け表示には使う
 * （AGENTS.md「Human-facing output language」が `error / log /
 * provider-native output の引用` を翻訳不要な例外として明示しているため、
 * Postgres/PostgREST の生メッセージをそのまま引用してよい）。
 */
const PERMISSION_DENIED_POSTGRES_CODES: ReadonlySet<string> = new Set([
  "42501",
]);

/**
 * `PGRST116`（PostgREST が `.single()`/`.maybeSingle()` で 0 行または複数行を
 * 検出した場合のコード）は、この write 層では常に「`.eq('id', ...)` 指定の
 * UPDATE/DELETE が 0 行にしか一致しなかった」ケースにのみ現れる
 * （呼び出し側は必ず単一 id で絞り込むため「複数行」は起こらない）。
 * 0 行の理由は「そもそも存在しない」と「RLS が見せない（所有者不一致）」の
 * 両方があり得るが、区別できない/しないのは意図的: `/schedule/[entryId]`
 * の「存在しない entry と非公開 entry を同一の empty 扱いにする」設計
 * （product-rules.md 由来）を write 側でも一貫させ、`not-found` へ畳み込む。
 */
const SINGLE_ROW_NOT_MATCHED_CODE = "PGRST116";

/**
 * 通常のテーブル write（INSERT/UPDATE/DELETE、`personal_schedule_entries` /
 * `personal_schedule_shares` への直接操作）の失敗分類。
 */
export function classifyWritePostgrestError(
  error: PostgrestError,
  status: number,
): ActionError {
  let kind: BaseActionErrorKind;
  let message: string;
  if (status === 401) {
    kind = "unauthenticated";
    message = "サインインが必要です。";
  } else if (error.code === SINGLE_ROW_NOT_MATCHED_CODE) {
    kind = "not-found";
    message = "対象が見つかりませんでした。";
  } else if (
    status === 403 ||
    PERMISSION_DENIED_POSTGRES_CODES.has(error.code)
  ) {
    kind = "permission-denied";
    message = "権限がありません。";
  } else {
    kind = "failure";
    message = error.message;
  }
  // `<never>` を明示: `let` 変数への分岐代入は制御フロー解析で実際に
  // 代入された literal の union へ narrow されるため、`kind` の宣言型
  // （`BaseActionErrorKind`）だけでは `ActionError` のジェネリック推論を
  // 防げない。明示的な型引数でこの関数の宣言どおり常に
  // `ActionError`（= `ActionError<never>`）を返す。
  return new ActionError<never>(kind, message);
}

/**
 * RPC（`share_schedule_entry_by_email` / `list_schedule_share_recipient_emails`）
 * の失敗分類。
 *
 * これらの RPC は、業務ルール違反（未登録 email・自分自身への共有・
 * owner 以外からの呼び出し等）をすべて `raise exception` のデフォルト
 * SQLSTATE（`P0001`）で返す — 個別の custom SQLSTATE
 * （`docs/v2/decisions.md` A8 が invite/decline/share 系に求めている区分）
 * はこの migration
 * （`supabase/migrations/20260823020000_create_schedule_share_email_boundary.sql`）
 * にまだ導入されていない。したがって `P0001` だけからは「owner でない」と
 * 「email が不正/未登録」を構造的に区別できず、本 Task の変更対象外
 * （`supabase/migrations/` は scope 外）でもあるため、`businessRuleKind`
 * を呼び出し側が1つ選んで渡す（このタスクの報告に判断として記録する）。
 */
export function classifyRpcError(
  error: PostgrestError,
  status: number,
  businessRuleKind: "validation" | "permission-denied",
): ActionError {
  let kind: BaseActionErrorKind;
  let message: string;
  if (status === 401) {
    kind = "unauthenticated";
    message = "サインインが必要です。";
  } else if (error.code === "P0001") {
    kind = businessRuleKind;
    message = `処理を実行できませんでした（${error.message}）。`;
  } else if (
    status === 403 ||
    PERMISSION_DENIED_POSTGRES_CODES.has(error.code)
  ) {
    kind = "permission-denied";
    message = "権限がありません。";
  } else {
    kind = "failure";
    message = error.message;
  }
  return new ActionError<never>(kind, message);
}
