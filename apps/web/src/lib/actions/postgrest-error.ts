import { ActionError } from "@/lib/action-error";

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
 * 一切行わない**（AGENTS.md 制約「エラー分類は message 文字列マッチで
 * 行わない（A8）」）。
 *
 * `apps/legacy-web/src/domain/eventCatalogWrite.ts` の
 * `classifyWriteError` と同じ SQLSTATE 集合を採用するが、共通の
 * `ActionErrorShape` 語彙（`@/lib/action-error.ts` の
 * `BaseActionErrorKind`）を基底にして拡張する（A9: 語彙の統一）。
 */
export type EventWriteExtraKind = "duplicate-occurrence" | "delete-blocked";

const INSUFFICIENT_PRIVILEGE = "42501";

/** NOT NULL / FK / CHECK / 不正な日時・数値表現、加えて
 * `create_event`/`import_event_with_occurrences` 系が使う `22004`
 * （invalid_parameter_value 相当のカスタム用途）。 */
const VALIDATION_CODES = new Set([
  "23502",
  "23503",
  "23514",
  "22007",
  "22008",
  "22P02",
  "22004",
]);

/** unique_violation。この write boundary 内で authenticated が到達し得る
 * 唯一の unique 制約は `event_occurrences_event_id_starts_at_key`
 * （Issue #79）。 */
const UNIQUE_VIOLATION = "23505";

/** delete-blocked（Issue #124）: 参加/招待データが存在するための削除拒否。 */
const DELETE_BLOCKED = "90001";

/** 実質的に中止済みの occurrence への新規 active action 拒否（Issue #125）。
 * 送信内容自体は不正ではなく対象の現在状態が理由なので `validation` に
 * 分類する（legacy `planningError.ts` の分類方針を踏襲）。 */
const EFFECTIVELY_CANCELED = "90002";

export interface RawPostgrestLikeError {
  readonly code: string;
  readonly message: string;
}

export function classifyPostgrestLikeError(
  error: RawPostgrestLikeError,
): ActionError<EventWriteExtraKind> {
  if (error.code === INSUFFICIENT_PRIVILEGE) {
    return new ActionError<EventWriteExtraKind>(
      "permission-denied",
      error.message,
    );
  }
  if (error.code === UNIQUE_VIOLATION) {
    return new ActionError<EventWriteExtraKind>(
      "duplicate-occurrence",
      error.message,
    );
  }
  if (error.code === DELETE_BLOCKED) {
    return new ActionError<EventWriteExtraKind>(
      "delete-blocked",
      error.message,
    );
  }
  if (error.code === EFFECTIVELY_CANCELED) {
    return new ActionError<EventWriteExtraKind>(
      "validation",
      "この公演は中止されているため操作できません。",
    );
  }
  if (VALIDATION_CODES.has(error.code)) {
    return new ActionError<EventWriteExtraKind>("validation", error.message);
  }
  return new ActionError<EventWriteExtraKind>("failure", error.message);
}
