import {
  ActionError,
  GENERIC_FAILURE_MESSAGE_JA,
  GENERIC_VALIDATION_MESSAGE_JA,
} from "@/lib/action-error";

/**
 * この write boundary（Event/Occurrence/Invitation/Participation）全体で
 * 共有する Postgrest/RPC error 分類。
 *
 * `docs/v2/decisions.md` A8 の決定「invite / decline / share 系も custom
 * SQLSTATE へ寄せ、message matching を撤去する」は
 * `supabase/migrations/20260826000100_create_event_delete_rpcs.sql` /
 * `20260830000000_simplify_invitation_pending_only.sql` 等で実装済み
 * （`42501`/`90001`/`90002` を全て `using errcode = ...` で明示）。
 * したがってこの分類は SQLSTATE のみを見る。**message 文字列マッチは
 * 一切行わない**（.ai-dev-foundation/product-rules.md 制約「エラー分類は message 文字列マッチで
 * 行わない（A8）」）。
 *
 * M8 oracle の `classifyWriteError` と同じ SQLSTATE 集合を採用するが、共通の
 * `ActionErrorShape` 語彙（`@/lib/action-error.ts` の
 * `BaseActionErrorKind`）を基底にして拡張する（A9: 語彙の統一）。
 *
 * **`error.message`（PostgREST/Postgres の生メッセージ）は
 * `ActionError.message`（client にそのまま渡る - `action-error.ts` の
 * doc comment、`safe-action.ts` の `toActionErrorShape` 参照）へ絶対に
 * 転記しない。** kind ごとに固定の日本語文言を返し、生メッセージは
 * `console.error` で server 側ログにのみ残す（`./schedule/postgrest-error.ts`
 * の `classifyWritePostgrestError`/`classifyRpcError` と同じ方針。M6d の
 * review finding 1: NewEventForm/AddOccurrenceForm/OccurrenceItem/
 * EditEventForm が `result.serverError.message` をそのまま表示するため、
 * ここで生メッセージを渡すと client へ露出してしまう）。
 */
export type EventWriteExtraKind = "duplicate-occurrence" | "delete-blocked";

/** `./event-write-feedback.ts` が operation 別の文言解決に再利用する
 * ため export する（SQLSTATE 集合自体は write boundary 全体で共有）。 */
export const INSUFFICIENT_PRIVILEGE = "42501";

/** NOT NULL / FK / CHECK / 不正な日時・数値表現、加えて
 * `create_event`/`import_event_with_occurrences` 系が使う `22004`
 * （invalid_parameter_value 相当のカスタム用途）。 */
export const VALIDATION_CODES = new Set([
  "23502",
  "23503",
  "23514",
  "22007",
  "22008",
  "22P02",
  "22004",
]);

/** unique_violation（Postgres 標準 SQLSTATE）。この write boundary 内で
 * authenticated が到達し得る唯一の unique 制約は
 * `event_occurrences_event_id_starts_at_key`（Issue #79）が、標準コード
 * 自体は boundary 固有ではないため、同じ write 層内の他の write core
 * （`participation.ts`/`ticketOpportunityState.ts` の並行 INSERT race
 * 検出）もこの定数を re-export せず直接 import して共有する（Issue #500:
 * `"23505"` literal の重複解消）。 */
export const UNIQUE_VIOLATION = "23505";

/** delete-blocked（Issue #124）: 参加/招待データが存在するための削除拒否。 */
export const DELETE_BLOCKED = "90001";

/**
 * 実質的に中止済みの occurrence への新規 active action 拒否（Issue #125）。
 *
 * migration 上（`supabase/migrations/20260830000000_simplify_invitation_pending_only.sql`
 * 等、`using errcode = '90002'`）、この拒否は actor/入力ではなく**対象
 * （occurrence）の現在状態**を理由に定義されている。base kind
 * `occurrence-canceled`（`@/lib/action-error.ts`）へ分類する
 * （Issue #500: 以前はこの共通 classifier だけが `validation` へ折り畳んで
 * おり、`participation.ts`/`invitation.ts` の `occurrence-canceled` 分類と
 * 経路によって異なる kind に分裂していた）。この write boundary の唯一の
 * SQLSTATE 正本として、`participation.ts`/`invitation.ts` もこの定数を
 * re-export せず直接 import する。
 */
export const EFFECTIVELY_CANCELED = "90002";

const PERMISSION_DENIED_MESSAGE_JA =
  "対象が見つからないか、操作する権限がありません。";
/** Issue #79 の `(event_id, starts_at)` 一意制約違反。`event-write-feedback.ts`
 * の operation 別文言でも同じ基底文言を使うため export する
 * （Issue #500: 同一文言の重複 literal 解消）。 */
export const DUPLICATE_OCCURRENCE_MESSAGE_JA =
  "同じ開始日時の公演回が既に登録されています。";
const DELETE_BLOCKED_MESSAGE_JA =
  "参加・招待データが存在するため削除できませんでした。";
const EFFECTIVELY_CANCELED_MESSAGE_JA =
  "この公演回は中止されているため操作できません。";

/** `code` を `string | null | undefined` まで許容するのは、この write
 * boundary 内の他の write core（`participation.ts`/`invitation.ts`/
 * `ticketOpportunityState.ts`）が受け取る Supabase レスポンスの `error`
 * 型と揃え、同じ型をそのまま共有できるようにするため
 * （Issue #500: 4箇所に分散していた、ほぼ同一の PostgREST-like error 型
 * 定義の重複解消）。 */
export interface RawPostgrestLikeError {
  readonly code?: string | null;
  readonly message: string;
}

export function classifyPostgrestLikeError(
  error: RawPostgrestLikeError,
): ActionError<EventWriteExtraKind> {
  if (error.code === INSUFFICIENT_PRIVILEGE) {
    console.error("[event write] permission denied", {
      code: error.code,
      message: error.message,
    });
    return new ActionError<EventWriteExtraKind>(
      "permission-denied",
      PERMISSION_DENIED_MESSAGE_JA,
    );
  }
  if (error.code === UNIQUE_VIOLATION) {
    console.error("[event write] duplicate occurrence", {
      code: error.code,
      message: error.message,
    });
    return new ActionError<EventWriteExtraKind>(
      "duplicate-occurrence",
      DUPLICATE_OCCURRENCE_MESSAGE_JA,
    );
  }
  if (error.code === DELETE_BLOCKED) {
    console.error("[event write] delete blocked", {
      code: error.code,
      message: error.message,
    });
    return new ActionError<EventWriteExtraKind>(
      "delete-blocked",
      DELETE_BLOCKED_MESSAGE_JA,
    );
  }
  if (error.code === EFFECTIVELY_CANCELED) {
    // 業務上ありふれた状態遷移であり異常ではないため、他の分岐と異なり
    // console.error は出さない（従来どおり）。
    return new ActionError<EventWriteExtraKind>(
      "occurrence-canceled",
      EFFECTIVELY_CANCELED_MESSAGE_JA,
    );
  }
  if (
    error.code !== null &&
    error.code !== undefined &&
    VALIDATION_CODES.has(error.code)
  ) {
    console.error("[event write] validation rejected", {
      code: error.code,
      message: error.message,
    });
    return new ActionError<EventWriteExtraKind>(
      "validation",
      GENERIC_VALIDATION_MESSAGE_JA,
    );
  }
  console.error("[event write] unclassified PostgREST error", {
    code: error.code,
    message: error.message,
  });
  return new ActionError<EventWriteExtraKind>(
    "failure",
    GENERIC_FAILURE_MESSAGE_JA,
  );
}
