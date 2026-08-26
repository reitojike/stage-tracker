// Passkey (WebAuthn) domain types and error classification (Issue #106).
//
// Mirrors src/domain/eventCatalogWrite.ts's shape (Result<T, {kind, message}>
// plus a classify* function) so this write boundary reads the same way as
// every other one in the app, even though its underlying transport is
// Supabase Auth's passkey API rather than PostgREST/RPC.
//
// Deliberately narrow on the wire shape rather than importing AuthError/
// WebAuthnError from @supabase/auth-js: both error kinds the SDK can throw
// here carry a `code` string, and classifying on that structural shape
// avoids depending on which of the two classes a given failure actually is
// (see src/infrastructure/supabase/passkey.ts for where this is called).

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

/** The subset of an SDK-thrown error this module classifies on. Both
 * AuthError and WebAuthnError satisfy this structurally. */
export interface PasskeyOperationErrorLike {
  message: string;
  code?: string;
  status?: number;
}

// --- Management (list / delete): server-side, session-scoped, no ceremony ---

export type PasskeyManagementErrorKind = 'not-authenticated' | 'failure';

export interface PasskeyManagementError {
  kind: PasskeyManagementErrorKind;
  message: string;
}

export type PasskeyManagementResult<T> =
  { ok: true; data: T } | { ok: false; error: PasskeyManagementError };

/** No session for list()/delete() to act on - the caller reached this
 * boundary without going through the page's own authenticated-only gate,
 * or the session expired mid-request. Both auth-js's thrown
 * AuthSessionMissingError and a 401 AuthError from the server land here. */
const SESSION_MISSING_CODES = new Set(['session_not_found', 'session_expired']);

export function classifyManagementError(error: PasskeyOperationErrorLike): PasskeyManagementError {
  if (error.status === 401 || (error.code !== undefined && SESSION_MISSING_CODES.has(error.code))) {
    return { kind: 'not-authenticated', message: error.message };
  }
  return { kind: 'failure', message: error.message };
}

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
