/**
 * Server Action の共通 error kind 語彙。
 *
 * 現行実装は `EventCatalogWriteErrorKind`（event catalog write boundary
 * 専用。`permission-denied`/`validation`/`duplicate-occurrence`/
 * `delete-blocked`/`failure` の5種）と `PlanningErrorKind`
 * （participation/invitation/personal schedule/ticket opportunity 共通。
 * `unauthenticated`/`not-found`/`permission-denied`/`validation`/
 * `failure` の5種）という、由来の異なる2つの Result 型に分裂している
 * （`docs/v2/oracle-domain.md` §7、`docs/v2/decisions.md` A9）。
 *
 * v2 ではこれを1つの共通語彙へ統一する。base kind は `PlanningErrorKind`
 * の5種をそのまま採用する（`EventCatalogWriteErrorKind` の
 * `permission-denied`/`validation`/`failure` はこの base に既に含まれる）。
 * `EventCatalogWriteErrorKind` 固有だった `duplicate-occurrence` /
 * `delete-blocked` のような feature 固有 kind は、この base を拡張する
 * discriminated union として個々の action が表現する
 * （`ActionErrorShape<"duplicate-occurrence" | "delete-blocked">` 等）。
 */
export const BASE_ACTION_ERROR_KINDS = [
  /** セッションが無い、または期限切れ。サインインへの誘導対象。 */
  "unauthenticated",
  /** 対象リソースが存在しない、または RLS 上見えない。 */
  "not-found",
  /** 権限が無い。真の権限判定は DB（RLS/RPC）が行い、action はその結果を
   * この kind へ変換するだけで、自ら権限判定はしない
   * （`docs/v2/oracle-domain.md` §3 冒頭の設計判断を維持する）。 */
  "permission-denied",
  /** スキーマ形状では表現できない業務的な入力エラー
   * （next-safe-action 自身のスキーマ検証エラーとは別の経路）。 */
  "validation",
  /** 5xx・レート制限・ネットワーク断等、分類できない/一時的な失敗。
   * `unauthenticated` と明確に区別する（`docs/v2/oracle-domain.md` §2.13）。 */
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
