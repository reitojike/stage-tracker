import { UNKNOWN_RETRY_HINT_JA } from "@/lib/user-facing-copy";

/**
 * The current account-access contract is in Spec 009; this module implements
 * the `/mypage` registration and `/sign-in` passkey error classification and
 * feedback mapping. The M8 journey comparison
 * (`docs/v2/m8-journey-comparison.md`) records the historical reason for the
 * distinction (register: PR #407; sign-in: Issue #406).
 *
 * historical M8 comparison の `classifyCeremonyError` / `REGISTER_FEEDBACK` /
 * `SIGN_IN_FEEDBACK` と同じ SQLSTATE 集合・同じ文言を再実装したもの
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
    description: UNKNOWN_RETRY_HINT_JA,
  },
};

export function resolveRegisterPasskeyFeedback(
  kind: PasskeyCeremonyErrorKind,
): PasskeyCeremonyFeedback {
  return REGISTER_FEEDBACK[kind];
}

/**
 * Issue #406 is historical provenance. Spec 009 owns sign-in account-access
 * semantics; exact failure feedback mapping and fallback presentation are
 * runtime-owned. sign-in 失敗時は、legacy の
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
    description: `${UNKNOWN_RETRY_HINT_JA}下のメールアドレスからサインインしてください。`,
  },
};

export function resolveSignInPasskeyFeedback(
  kind: PasskeyCeremonyErrorKind,
): PasskeyCeremonyFeedback {
  return SIGN_IN_FEEDBACK[kind];
}
