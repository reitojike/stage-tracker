// Passkey (WebAuthn) domain types and error classification (Issue #106).
//
// Mirrors src/domain/eventCatalogWrite.ts's shape (Result<T, {kind, message}>
// plus a classify* function) so this write boundary reads the same way as
// every other one in the app, even though its underlying transport is
// Supabase Auth's passkey API rather than PostgREST/RPC.
//
// This module is pure domain logic: no Supabase import (see the
// architecture import boundary in eslint.config.mjs, and
// src/domain/planningError.ts's own header for the same convention).
// Management (list/delete) error classification therefore lives in
// src/infrastructure/supabase/passkey.ts instead of here - it needs the
// real AuthError subclasses (isAuthSessionMissingError/isAuthApiError,
// same as src/infrastructure/supabase/planningAuth.ts's
// classifyGetUserError) to classify correctly. Ceremony (register/sign-in)
// classification stays here because it also has to recognise WebAuthnError,
// which @supabase/supabase-js does not export a type guard for - see
// PasskeyOperationErrorLike below.

import { tokyoDateLabel, tokyoTimeLabel } from './catalogFormatting.ts';

export interface PasskeyListItem {
  id: string;
  friendlyName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface RawPasskeyListItem {
  id: string;
  friendly_name?: string;
  created_at: string;
  last_used_at?: string;
}

export function mapPasskeyListItem(raw: RawPasskeyListItem): PasskeyListItem {
  return {
    id: raw.id,
    friendlyName: raw.friendly_name ?? null,
    createdAt: raw.created_at,
    lastUsedAt: raw.last_used_at ?? null,
  };
}

/**
 * The label a passkey would show on its own, ignoring whether anything
 * else in the list happens to render the same way. Never called directly
 * outside this module - see passkeyDisplayLabels below for why a single
 * passkey's label can't be decided in isolation.
 */
function baseDisplayLabel(passkey: PasskeyListItem): string {
  if (passkey.friendlyName !== null) {
    return passkey.friendlyName;
  }
  return `登録済みPasskey（${tokyoDateLabel(passkey.createdAt)} ${tokyoTimeLabel(passkey.createdAt)} 登録）`;
}

/**
 * What to show for each registered passkey in a management list (Issue
 * #106, Codex findings on PR #129: P2 "two unnamed credentials render
 * identically", P2 follow-up "two unnamed credentials in the same minute
 * still collide", P3 "a truncated id suffix can itself collide", P2
 * "two credentials sharing a non-null friendly_name collide too" -
 * friendly_name is caller-supplied free text with no uniqueness
 * constraint, so this can happen for named credentials exactly as for
 * unnamed ones). Every one of those findings was the same underlying
 * problem restated: a per-passkey label function can never guarantee
 * distinctness, because distinctness is a property of the *list*, not of
 * any one item. This function is list-aware for exactly that reason -
 * it is the last round this disambiguation needs, because it closes the
 * entire class of "two passkeys can render the same way" rather than one
 * scenario in that class at a time.
 *
 * Appends `id` (unique by construction - two distinct listPasskeys()
 * entries never share one) only to the labels that actually collide in
 * this list, so the common case (every passkey named or timed distinctly)
 * stays free of id noise.
 *
 * Doesn't ask for a name at registration time instead: that would need
 * new UI on the WebAuthn ceremony path (RegisterPasskeyButton/
 * registerPasskey()) for a dogfood-scale credential count, which the
 * "不要なaccount settings suiteへ拡張しない" bound this Issue set for
 * credential management rules out as disproportionate - and would not by
 * itself prevent two credentials being given the same name anyway.
 *
 * The invariant this function guarantees is that no two *final* labels are
 * ever equal - not merely that no two *base* labels are equal. A single
 * pass over base labels is not enough for that: `friendly_name` is
 * unrestricted free text, so nothing stops it from literally reading like
 * another passkey's disambiguated form. E.g. A/B both named "iPhone" get
 * suffixed to "iPhone（ID: A）"/"iPhone（ID: B）", but if C's own
 * friendly_name happens to already equal the literal string
 * "iPhone（ID: A）", checking base labels against each other once would
 * still let A's suffixed output collide with C's untouched base. This
 * escalates any passkey whose *current* label collides with another
 * passkey's current label by appending its own id, and repeats until no
 * collisions remain among the current labels. A passkey already carrying
 * its own id suffix is never escalated again, so at most `passkeys.length`
 * passkeys can ever be escalated - the loop is bounded by that count.
 */
export function passkeyDisplayLabels(passkeys: PasskeyListItem[]): Map<string, string> {
  let labels = new Map(passkeys.map((passkey) => [passkey.id, baseDisplayLabel(passkey)]));

  for (let round = 0; round < passkeys.length; round += 1) {
    const counts = new Map<string, number>();
    for (const label of labels.values()) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    let escalatedAny = false;
    const next = new Map(labels);
    for (const passkey of passkeys) {
      const current = labels.get(passkey.id) ?? '';
      const ownSuffix = `（ID: ${passkey.id}）`;
      if ((counts.get(current) ?? 0) > 1 && !current.endsWith(ownSuffix)) {
        next.set(passkey.id, `${current}${ownSuffix}`);
        escalatedAny = true;
      }
    }
    labels = next;
    if (!escalatedAny) {
      break;
    }
  }

  return labels;
}

// --- Management (list / delete): server-side, session-scoped, no ceremony ---
// Classification lives in src/infrastructure/supabase/passkey.ts (see this
// file's header) - only the vocabulary is here.

export type PasskeyManagementErrorKind = 'not-authenticated' | 'failure';

export interface PasskeyManagementError {
  kind: PasskeyManagementErrorKind;
  message: string;
}

export type PasskeyManagementResult<T> =
  { ok: true; data: T } | { ok: false; error: PasskeyManagementError };

export interface PasskeyManagementFeedback {
  variant: 'error';
  title: string;
  description: string;
}

export type PasskeyManagementOperation = 'list' | 'delete';

const MANAGEMENT_NOT_AUTHENTICATED: PasskeyManagementFeedback = {
  variant: 'error',
  title: 'サインイン状態を確認できませんでした',
  description: 'もう一度サインインしてからお試しください。',
};

const MANAGEMENT_FAILURE: Record<PasskeyManagementOperation, PasskeyManagementFeedback> = {
  list: {
    variant: 'error',
    title: 'Passkeyの一覧を取得できませんでした',
    description: '時間をおいてもう一度お試しください。',
  },
  delete: {
    variant: 'error',
    title: 'Passkeyを削除できませんでした',
    description: '通信状況を確認し、もう一度お試しください。',
  },
};

export function resolveManagementFeedback(
  operation: PasskeyManagementOperation,
  kind: PasskeyManagementErrorKind,
): PasskeyManagementFeedback {
  switch (kind) {
    case 'not-authenticated':
      return MANAGEMENT_NOT_AUTHENTICATED;
    case 'failure':
      return MANAGEMENT_FAILURE[operation];
  }
}

/** Mirrors EventDeleteFormState (src/domain/eventWriteFeedback.ts): no input
 * fields to echo, so the only state a delete form carries between
 * submissions is the remount key and the last feedback. */
export interface PasskeyDeleteFormState {
  attempt: number;
  feedback: PasskeyManagementFeedback | null;
}

export const INITIAL_PASSKEY_DELETE_FORM_STATE: PasskeyDeleteFormState = {
  attempt: 0,
  feedback: null,
};

export function rejectedPasskeyDeleteFormState(
  previous: PasskeyDeleteFormState,
  feedback: PasskeyManagementFeedback,
): PasskeyDeleteFormState {
  return { attempt: previous.attempt + 1, feedback };
}

// --- Ceremony (register / sign-in): browser-only, classified client-side ---

/** The subset of an SDK-thrown error this module classifies on. Both
 * AuthError and WebAuthnError satisfy this structurally - unlike
 * management classification above, this can't use a real class type guard
 * for WebAuthnError, since @supabase/supabase-js does not export one. */
export interface PasskeyOperationErrorLike {
  message: string;
  code?: string;
  status?: number;
}

export type PasskeyCeremonyErrorKind =
  'cancelled' | 'unsupported' | 'duplicate' | 'too-many' | 'failure';

/** WebAuthnErrorCode values (see @supabase/auth-js's lib/webauthn.errors)
 * that mean the person chose not to complete the ceremony or ran out of
 * time, not that anything is actually broken. */
const CEREMONY_CANCELLED_CODES = new Set(['ERROR_CEREMONY_ABORTED']);

/** WebAuthnErrorCode values meaning this device/browser cannot do what the
 * ceremony asked of it, as opposed to a one-off failure worth retrying. */
const CEREMONY_UNSUPPORTED_CODES = new Set([
  'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT',
  'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT',
  'ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG',
  'ERROR_MALFORMED_PUBKEYCREDPARAMS',
  'ERROR_INVALID_DOMAIN',
  'ERROR_INVALID_RP_ID',
]);

/** Supabase Auth server error codes for passkey registration (see
 * https://supabase.com/docs/guides/auth/passkeys). */
const CEREMONY_DUPLICATE_CODES = new Set([
  'webauthn_credential_exists',
  'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED',
]);
const CEREMONY_TOO_MANY_CODES = new Set(['too_many_passkeys']);

export function classifyCeremonyError(error: PasskeyOperationErrorLike): PasskeyCeremonyErrorKind {
  const code = error.code;
  if (code !== undefined && CEREMONY_CANCELLED_CODES.has(code)) {
    return 'cancelled';
  }
  if (code !== undefined && CEREMONY_UNSUPPORTED_CODES.has(code)) {
    return 'unsupported';
  }
  if (code !== undefined && CEREMONY_DUPLICATE_CODES.has(code)) {
    return 'duplicate';
  }
  if (code !== undefined && CEREMONY_TOO_MANY_CODES.has(code)) {
    return 'too-many';
  }
  return 'failure';
}

export type PasskeyCeremonyOperation = 'register' | 'sign-in';

export interface PasskeyCeremonyFeedback {
  variant: 'error';
  title: string;
  description: string;
}

const REGISTER_FEEDBACK: Record<PasskeyCeremonyErrorKind, PasskeyCeremonyFeedback> = {
  cancelled: {
    variant: 'error',
    title: 'Passkeyの登録をキャンセルしました',
    description: 'もう一度お試しください。',
  },
  unsupported: {
    variant: 'error',
    title: 'この端末・ブラウザではPasskeyを登録できません',
    description: '生体認証や画面ロックが設定された端末・対応ブラウザでお試しください。',
  },
  duplicate: {
    variant: 'error',
    title: 'このPasskeyは既に登録されています',
    description: '同じ端末のPasskeyを重複して登録することはできません。',
  },
  'too-many': {
    variant: 'error',
    title: '登録できるPasskeyの上限に達しています',
    description: '使用していないPasskeyを削除してから、もう一度お試しください。',
  },
  failure: {
    variant: 'error',
    title: 'Passkeyを登録できませんでした',
    description: '通信状況を確認し、もう一度お試しください。',
  },
};

const SIGN_IN_FEEDBACK: Record<PasskeyCeremonyErrorKind, PasskeyCeremonyFeedback> = {
  cancelled: {
    variant: 'error',
    title: 'Passkeyサインインをキャンセルしました',
    description: 'もう一度お試しいただくか、下のメールアドレスからサインインしてください。',
  },
  unsupported: {
    variant: 'error',
    title: 'この端末・ブラウザではPasskeyサインインを利用できません',
    description: '下のメールアドレスからサインインしてください。',
  },
  duplicate: {
    variant: 'error',
    title: 'Passkeyサインインに失敗しました',
    description: '下のメールアドレスからサインインしてください。',
  },
  'too-many': {
    variant: 'error',
    title: 'Passkeyサインインに失敗しました',
    description: '下のメールアドレスからサインインしてください。',
  },
  failure: {
    variant: 'error',
    title: 'Passkeyサインインに失敗しました',
    description:
      '通信状況を確認してもう一度お試しいただくか、下のメールアドレスからサインインしてください。',
  },
};

export function resolveCeremonyFeedback(
  operation: PasskeyCeremonyOperation,
  kind: PasskeyCeremonyErrorKind,
): PasskeyCeremonyFeedback {
  return operation === 'register' ? REGISTER_FEEDBACK[kind] : SIGN_IN_FEEDBACK[kind];
}
