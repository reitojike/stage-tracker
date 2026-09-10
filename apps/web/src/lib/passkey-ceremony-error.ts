/**
 * `docs/v2/oracle-routes-ui.md:245`（`/mypage` Passkey 登録）「失敗時は
 * エラー種別分類→パネル表示」、および `docs/v2/oracle-routes-ui.md:49`
 * （`/sign-in`）「サインイン（Passkey優先＋Magic Linkフォールバック）」。
 * M8 journey 比較（`docs/v2/m8-journey-comparison.md`）で確定した分類2の
 * 不具合の修正（register 側は PR #407 で修正済み、sign-in 側は Issue
 * #406） - v2 はこれまで WebAuthn ceremony の失敗理由を分類せず、常に
 * 単一の汎用メッセージを表示していた。
 *
 * `apps/legacy-web/src/domain/passkey.ts` の `classifyCeremonyError`/
 * `REGISTER_FEEDBACK`/`SIGN_IN_FEEDBACK` と同じ SQLSTATE 集合・同じ文言を、
 * v2 側で（legacy import 禁止のため）再実装したもの
 * （`apps/web/src/app/(app)/mypage/_data/passkeyDisplay.ts` と同じ理由）。
 *
 * `AuthError`/`WebAuthnError` は構造的にこの interface を満たすため、
 * 実クラスの import は不要（legacy と同じ設計判断 - `@supabase/
 * supabase-js` は `WebAuthnError` を export していない）。
 */
export interface PasskeyOperationErrorLike {
  readonly message: string;
  readonly code?: string | undefined;
  readonly status?: number | undefined;
}

export type PasskeyCeremonyErrorKind =
  "cancelled" | "unsupported" | "duplicate" | "too-many" | "failure";

/** WebAuthnErrorCode のうち、本人が ceremony を完了しなかった/時間切れに
 * なっただけで、何かが壊れているわけではないもの。 */
const CEREMONY_CANCELLED_CODES = new Set(["ERROR_CEREMONY_ABORTED"]);

/** この端末/ブラウザが ceremony の要求を満たせないもの
 * （一過性の失敗ではなく、再試行しても解決しない）。 */
const CEREMONY_UNSUPPORTED_CODES = new Set([
  "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT",
  "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT",
  "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG",
  "ERROR_MALFORMED_PUBKEYCREDPARAMS",
  "ERROR_INVALID_DOMAIN",
  "ERROR_INVALID_RP_ID",
]);

/** Supabase Auth server error codes for passkey registration
 * (https://supabase.com/docs/guides/auth/passkeys)。 */
const CEREMONY_DUPLICATE_CODES = new Set([
  "webauthn_credential_exists",
  "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
]);
const CEREMONY_TOO_MANY_CODES = new Set(["too_many_passkeys"]);

export function classifyPasskeyCeremonyError(
  error: PasskeyOperationErrorLike,
): PasskeyCeremonyErrorKind {
  const code = error.code;
  if (code !== undefined && CEREMONY_CANCELLED_CODES.has(code)) {
    return "cancelled";
  }
  if (code !== undefined && CEREMONY_UNSUPPORTED_CODES.has(code)) {
    return "unsupported";
  }
  if (code !== undefined && CEREMONY_DUPLICATE_CODES.has(code)) {
    return "duplicate";
  }
  if (code !== undefined && CEREMONY_TOO_MANY_CODES.has(code)) {
    return "too-many";
  }
  return "failure";
}

export interface PasskeyCeremonyFeedback {
  readonly title: string;
  readonly description: string;
}

const REGISTER_FEEDBACK: Record<
  PasskeyCeremonyErrorKind,
  PasskeyCeremonyFeedback
> = {
  cancelled: {
    title: "Passkeyの登録をキャンセルしました",
    description: "もう一度お試しください。",
  },
  unsupported: {
    title: "この端末・ブラウザではPasskeyを登録できません",
    description:
      "生体認証や画面ロックが設定された端末・対応ブラウザでお試しください。",
  },
  duplicate: {
    title: "このPasskeyは既に登録されています",
    description: "同じ端末のPasskeyを重複して登録することはできません。",
  },
  "too-many": {
    title: "登録できるPasskeyの上限に達しています",
    description:
      "使用していないPasskeyを削除してから、もう一度お試しください。",
  },
  failure: {
    title: "Passkeyを登録できませんでした",
    description: "通信状況を確認し、もう一度お試しください。",
  },
};

export function resolveRegisterPasskeyFeedback(
  kind: PasskeyCeremonyErrorKind,
): PasskeyCeremonyFeedback {
  return REGISTER_FEEDBACK[kind];
}

/**
 * Issue #406（`docs/v2/oracle-routes-ui.md:49`「サインイン（Passkey優先＋
 * Magic Linkフォールバック）」）。sign-in 失敗時は、legacy の
 * `SIGN_IN_FEEDBACK` と同じく常に Magic Link フォームへの案内を添える
 * （register 失敗時とは異なり、その場に代替手段が無いため）。
 */
const SIGN_IN_FEEDBACK: Record<
  PasskeyCeremonyErrorKind,
  PasskeyCeremonyFeedback
> = {
  cancelled: {
    title: "Passkeyサインインをキャンセルしました",
    description:
      "もう一度お試しいただくか、下のメールアドレスからサインインしてください。",
  },
  unsupported: {
    title: "この端末・ブラウザではPasskeyサインインを利用できません",
    description: "下のメールアドレスからサインインしてください。",
  },
  duplicate: {
    title: "Passkeyサインインに失敗しました",
    description: "下のメールアドレスからサインインしてください。",
  },
  "too-many": {
    title: "Passkeyサインインに失敗しました",
    description: "下のメールアドレスからサインインしてください。",
  },
  failure: {
    title: "Passkeyサインインに失敗しました",
    description:
      "通信状況を確認してもう一度お試しいただくか、下のメールアドレスからサインインしてください。",
  },
};

export function resolveSignInPasskeyFeedback(
  kind: PasskeyCeremonyErrorKind,
): PasskeyCeremonyFeedback {
  return SIGN_IN_FEEDBACK[kind];
}
