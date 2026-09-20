import type { PostgrestError } from "@supabase/supabase-js";
import {
  ActionError,
  GENERIC_FAILURE_MESSAGE_JA,
  GENERIC_VALIDATION_MESSAGE_JA,
  type BaseActionErrorKind,
} from "@/lib/action-error";

/**
 * PostgREST/RPC 呼び出しの失敗を `ActionError` へ分類する、この write 層の
 * 唯一の判定場所。`docs/v2/decisions.md` A8「エラー分類を
 * `error.message.includes(...)` の文字列マッチングで行わない」を守り、
 * PostgREST の HTTP status と Postgres の SQLSTATE（`error.code`）という
 * 構造化された情報だけで判定する（read boundary の
 * `lib/data/supabase-select.ts` の `classifyPostgrestError` と対の write 版）。
 *
 * `error.message`（PostgREST/Postgres の生メッセージ）は `ActionError.message`
 * （client にそのまま渡る - `action-error.ts` の doc comment、
 * `safe-action.ts` の `toActionErrorShape` 参照）へ絶対に転記しない。M6a の
 * PR #381 review finding 2 が read boundary の `ReadState` から生メッセージを
 * 型で締め出したのと同じ理由で、write boundary の `ActionError.message` も
 * 常に固定の安全な文言にする - `console.error` がサーバーログへ生詳細を
 * 残す唯一の経路である（`./supabase-select.ts`/`classifyPostgrestError` と
 * 同じパターン）。
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

const PERMISSION_DENIED_MESSAGE_JA = "権限がありません。";

/**
 * `resolveBusinessRuleMessage` が一致しない場合の generic fallback。
 * `businessRuleKind` ごとに文言を分けるのは、
 * 呼び出し元（`addScheduleShareByEmail` 等）が
 * `businessRuleKind: "permission-denied"` を選んだ場合にまで
 * validation 向けの文言（「入力内容をご確認のうえ…」）を返すと、kind と
 * 文言が食い違うため。
 */
function genericBusinessRuleMessage(
  businessRuleKind: "validation" | "permission-denied",
): string {
  return businessRuleKind === "permission-denied"
    ? PERMISSION_DENIED_MESSAGE_JA
    : GENERIC_VALIDATION_MESSAGE_JA;
}

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
    message = PERMISSION_DENIED_MESSAGE_JA;
  } else {
    kind = "failure";
    // 生の PostgREST メッセージはここでのみ console.error へ残し、
    // ActionError.message には転記しない（このファイル冒頭の doc comment
    // 参照）。
    console.error("[schedule write] unclassified PostgREST error", {
      status,
      code: error.code,
      message: error.message,
    });
    message = GENERIC_FAILURE_MESSAGE_JA;
  }
  // `<never>` を明示: `let` 変数への分岐代入は制御フロー解析で実際に
  // 代入された literal の union へ narrow されるため、`kind` の宣言型
  // （`BaseActionErrorKind`）だけでは `ActionError` のジェネリック推論を
  // 防げない。明示的な型引数でこの関数の宣言どおり常に
  // `ActionError`（= `ActionError<never>`）を返す。
  return new ActionError<never>(kind, message);
}

/**
 * `share_schedule_entry_by_email` の業務ルール違反を表す custom SQLSTATE
 * （`supabase/migrations/20260908010000_add_share_by_email_sqlstates.sql`、
 * PR #389 で追加する）。
 *
 * **`90010` を Invitation 側で再利用してはいけない。** share by email は
 * 「対象 email が未登録であることを owner へ知らせてよい」operation だが
 * （product-rules.md「Authenticated-user targeting」節）、Invitation は
 * invitee の状態を inviter へ開示してはいけない。opacity boundary が違うため、
 * 同じ code を使うと handler を共有した瞬間に Invitation 側の opacity が壊れる。
 *
 * **この module が、この write 層で使う SQLSTATE 語彙の唯一の正本。**
 * 呼び出し元は literal を再定義せず、ここから import する。片方だけ変更すると
 * 「gate は通るのに resolver が一致せず汎用文言へ退行する」あるいは
 * 「resolver の分岐が到達不能になる」という、test では気付きにくい壊れ方を
 * するため（PR #392 review finding）。
 */
export const SHARE_UNREGISTERED_RECIPIENT_CODE = "90010";
export const SHARE_SELF_SHARE_CODE = "90011";

/**
 * この write 層が業務ルール違反（business rule rejection）として扱う SQLSTATE。
 */
const BUSINESS_RULE_POSTGRES_CODES: ReadonlySet<string> = new Set([
  SHARE_UNREGISTERED_RECIPIENT_CODE,
  SHARE_SELF_SHARE_CODE,
]);

/**
 * RPC（`share_schedule_entry_by_email` / `list_schedule_share_recipient_emails`）
 * の失敗分類。
 *
 * `BUSINESS_RULE_POSTGRES_CODES` のいずれかであれば業務ルール違反として扱う。
 * `resolveBusinessRuleMessage` は、呼び出し元が特定のエラーだけを既知の
 * 分類済み安全文言へ差し替えたい場合のための、任意の狭い exit hatch。
 * 汎用の message 文字列マッチング判定（A8 が禁止する
 * `error.message.includes(...)` によるエラー種別自体の判定）ではなく、
 * `kind`（`businessRuleKind`）が既に確定した *後*、表示文言だけを
 * 呼び出し元の裁量で上書きするための狭いフックである。
 * `undefined` を返す（= 呼び出し元が resolver を渡さない、または渡しても
 * 一致しない）場合は常に `businessRuleKind` に応じた generic な安全文言
 * （`genericBusinessRuleMessage`）にフォールバックする - fail-closed に、
 * 生メッセージが漏れることはない。
 *
 * resolver には構造化された `code` だけを渡し、生の DB message を
 * compatibility 判定へ持ち込まない。
 */
export function classifyRpcError(
  error: PostgrestError,
  status: number,
  businessRuleKind: "validation" | "permission-denied",
  resolveBusinessRuleMessage?: (code: string) => string | undefined,
): ActionError {
  let kind: BaseActionErrorKind;
  let message: string;
  if (status === 401) {
    kind = "unauthenticated";
    message = "サインインが必要です。";
  } else if (BUSINESS_RULE_POSTGRES_CODES.has(error.code)) {
    kind = businessRuleKind;
    const resolved = resolveBusinessRuleMessage?.(error.code);
    if (resolved === undefined) {
      console.error(
        "[schedule write] unresolved business rule rejection message",
        {
          code: error.code,
          message: error.message,
        },
      );
    }
    message = resolved ?? genericBusinessRuleMessage(businessRuleKind);
  } else if (
    status === 403 ||
    PERMISSION_DENIED_POSTGRES_CODES.has(error.code)
  ) {
    kind = "permission-denied";
    message = PERMISSION_DENIED_MESSAGE_JA;
  } else {
    kind = "failure";
    console.error("[schedule write] unclassified PostgREST error (RPC)", {
      status,
      code: error.code,
      message: error.message,
    });
    message = GENERIC_FAILURE_MESSAGE_JA;
  }
  return new ActionError<never>(kind, message);
}
