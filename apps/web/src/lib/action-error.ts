import { UNKNOWN_RETRY_HINT_JA } from "@/lib/user-facing-copy";

/**
 * Server Action の共通 error kind 語彙。
 *
 * 現行実装は `EventCatalogWriteErrorKind`（event catalog write boundary
 * 専用。`permission-denied`/`validation`/`duplicate-occurrence`/
 * `delete-blocked`/`failure` の5種）と `PlanningErrorKind`
 * （participation/invitation/personal schedule/ticket opportunity 共通。
 * `unauthenticated`/`not-found`/`permission-denied`/`validation`/
 * `failure` の5種）という、由来の異なる2つの Result 型に分裂している
 * （`this module and its tests`、`docs/v2/decisions.md` A9）。
 *
 * v2 ではこれを1つの共通語彙へ統一する。base kind は `PlanningErrorKind`
 * の5種をそのまま採用する（`EventCatalogWriteErrorKind` の
 * `permission-denied`/`validation`/`failure` はこの base に既に含まれる）。
 * `EventCatalogWriteErrorKind` 固有だった `duplicate-occurrence` /
 * `delete-blocked` のような feature 固有 kind は、この base を拡張する
 * discriminated union として個々の action が表現する
 * （`ActionErrorShape<"duplicate-occurrence" | "delete-blocked">` 等）。
 *
 * `occurrence-canceled`（Issue #500）は base kind へ昇格済み: SQLSTATE
 * `90002`（実質的に中止済みの occurrence への新規 active action 拒否）は
 * migration 上、actor/入力ではなく対象の現在状態を理由とする拒否として
 * 定義されており（`supabase/migrations/20260830000000_simplify_invitation_pending_only.sql`
 * 等）、participation/invitation/event write のいずれの write path でも
 * 同一の DB 事実を表す。以前は participation/invitation だけが feature 固有
 * `ExtraKind` として個別に宣言しており、event/common write boundary
 * （`postgrest-error.ts`）はこの成分を `validation` へ折り畳んでいたため、
 * 同一事実が経路により異なる kind へ分裂していた。base kind 化により、
 * 全 write path が同一の `occurrence-canceled` を参照する。
 */
export const BASE_ACTION_ERROR_KINDS = [
  /** セッションが無い、または期限切れ。サインインへの誘導対象。 */
  "unauthenticated",
  /** 対象リソースが存在しない、または RLS 上見えない。 */
  "not-found",
  /** 権限が無い。真の権限判定は DB（RLS/RPC）が行い、action はその結果を
   * この kind へ変換するだけで、自ら権限判定はしない
   * （`this module and its tests` 冒頭の設計判断を維持する）。 */
  "permission-denied",
  /** スキーマ形状では表現できない業務的な入力エラー
   * （next-safe-action 自身のスキーマ検証エラーとは別の経路）。 */
  "validation",
  /** 対象（occurrence）が実質的に中止済みであることを理由とした拒否
   * （SQLSTATE `90002`）。actor/入力自体は不正ではなく、対象の現在状態が
   * 理由という点で `validation` とは区別する（Issue #500）。 */
  "occurrence-canceled",
  /** 5xx・レート制限・ネットワーク断等、分類できない/一時的な失敗。
   * `unauthenticated` と明確に区別する（`this module and its tests`）。 */
  "failure",
] as const;

export type BaseActionErrorKind = (typeof BASE_ACTION_ERROR_KINDS)[number];

/**
 * Server Action の標準 error shape。feature 固有 kind が必要な場合は
 * 型引数で拡張する（例: `ActionErrorShape<"duplicate-occurrence">`）。
 */
export type ActionErrorShape<ExtraKind extends string = never> = {
  kind: BaseActionErrorKind | ExtraKind;
  message: string;
};

/**
 * Server Action 内から意図的に投げる、分類済みエラー。
 * `next-safe-action` の `handleServerError`（`src/lib/safe-action.ts`）が
 * これを `ActionErrorShape` へ変換して client へ返す。
 *
 * 分類されていない例外（バグ・想定外の infra 障害等）はこのクラスを経由
 * させず、`handleServerError` 側で一律 `failure` として扱う。DB/RLS の
 * 生エラーメッセージをそのまま client に見せないため。
 */
export class ActionError<ExtraKind extends string = never> extends Error {
  readonly kind: BaseActionErrorKind | ExtraKind;

  constructor(kind: BaseActionErrorKind | ExtraKind, message: string) {
    super(message);
    this.name = "ActionError";
    this.kind = kind;
  }
}

export function isActionError(error: unknown): error is ActionError<string> {
  if (!(error instanceof ActionError)) {
    return false;
  }
  return typeof error.kind === "string" && typeof error.message === "string";
}

export function isBaseActionError(
  error: unknown,
): error is ActionError<BaseActionErrorKind> {
  if (!isActionError(error)) {
    return false;
  }
  return BASE_ACTION_ERROR_KINDS.some((kind) => kind === error.kind);
}

/**
 * `failure`/`validation` kind の既定文言。write boundary ごとの
 * classifier（`lib/actions/postgrest-error.ts`、
 * `lib/actions/schedule/postgrest-error.ts`）が、DB/PostgREST の生
 * メッセージを client へ転記しないための固定 fallback として共有する
 * （Issue #500: 同一文言が classifier ごとに独立した literal として重複
 * していたための集約）。
 */
export const GENERIC_FAILURE_MESSAGE_JA = `処理に失敗しました。${UNKNOWN_RETRY_HINT_JA}`;
export const GENERIC_VALIDATION_MESSAGE_JA =
  "入力内容をご確認のうえ、再度お試しください。";
