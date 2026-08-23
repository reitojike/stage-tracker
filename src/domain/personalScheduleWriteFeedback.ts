import type { PlanningError, PlanningErrorKind } from './planningError.ts';
import type { FieldErrors, RawFormValues } from './personalScheduleWrite.ts';

// What a failed personal schedule write means to the person who attempted
// it (Issue #37). docs/ux-ui.md's "Common states" requires permission
// denial, validation failure and data/infrastructure failure to be
// presented distinctly - never collapsed into one message, and never shown
// as an empty result. Mirrors domain/eventWriteFeedback.ts, but classifies
// PlanningErrorKind (5 kinds: this typed boundary also distinguishes
// `unauthenticated` and `not-found`, which EventCatalogWriteErrorKind does
// not) rather than EventCatalogWriteErrorKind's 3.

export type ScheduleWriteOperation = 'create-schedule-entry' | 'update-schedule-entry';
export type ScheduleShareWriteOperation = 'remove-schedule-share';

export interface ScheduleWriteFeedback {
  /** Maps onto StatePanel's variant. */
  variant: 'error';
  title: string;
  description: string;
}

const PERMISSION_DENIED: Record<ScheduleWriteOperation, ScheduleWriteFeedback> = {
  'create-schedule-entry': {
    variant: 'error',
    title: '予定を作成する権限がありません',
    description: 'サインイン状態を確認し、もう一度お試しください。',
  },
  'update-schedule-entry': {
    variant: 'error',
    title: 'この予定を編集する権限がありません',
    description: '予定を編集できるのは、その予定を作成した本人だけです。',
  },
};

const REMOVE_SHARE_PERMISSION_DENIED: ScheduleWriteFeedback = {
  variant: 'error',
  title: '共有から外れる操作を行えません',
  description: '既にこの予定の共有から外れている可能性があります。ページを更新してご確認ください。',
};

const REMOVE_SHARE_NOT_FOUND: ScheduleWriteFeedback = {
  variant: 'error',
  title: '対象の共有が見つかりませんでした',
  description: '既にこの予定の共有から外れている可能性があります。ページを更新してご確認ください。',
};

const OWNER_REMOVE_SHARE_PERMISSION_DENIED: ScheduleWriteFeedback = {
  variant: 'error',
  title: 'この共有を削除する権限がありません',
  description: 'recipientの削除は、その予定を作成した本人だけが行えます。',
};

const OWNER_REMOVE_SHARE_NOT_FOUND: ScheduleWriteFeedback = {
  variant: 'error',
  title: '対象の共有が見つかりませんでした',
  description: '既に削除されている可能性があります。ページを更新してご確認ください。',
};

const SHARE_ADD_PERMISSION_DENIED: ScheduleWriteFeedback = {
  variant: 'error',
  title: 'recipientを追加する権限がありません',
  description: 'recipientの追加は、その予定を作成した本人だけが行えます。',
};

const UNAUTHENTICATED: ScheduleWriteFeedback = {
  variant: 'error',
  title: 'サインイン状態を確認できませんでした',
  description: 'お手数ですが、もう一度サインインしてからお試しください。',
};

const NOT_FOUND: ScheduleWriteFeedback = {
  variant: 'error',
  title: '対象の予定が見つかりませんでした',
  description: '既に削除されているか、閲覧できない予定の可能性があります。',
};

const VALIDATION: ScheduleWriteFeedback = {
  variant: 'error',
  title: '入力内容を保存できませんでした',
  description: '入力内容に問題があります。各項目の内容を確認して、もう一度お試しください。',
};

const FAILURE: ScheduleWriteFeedback = {
  variant: 'error',
  title: '保存に失敗しました',
  description: '通信状況を確認し、もう一度お試しください。',
};

const SUCCESS_NOTICES: Record<ScheduleWriteOperation, string> = {
  'create-schedule-entry': '予定を作成しました。',
  'update-schedule-entry': '予定を保存しました。',
};

export function resolveWriteNotice(operation: ScheduleWriteOperation): string {
  return SUCCESS_NOTICES[operation];
}

export function resolveWriteFeedback(
  operation: ScheduleWriteOperation,
  kind: PlanningErrorKind,
): ScheduleWriteFeedback {
  switch (kind) {
    case 'permission-denied':
      return PERMISSION_DENIED[operation];
    case 'unauthenticated':
      return UNAUTHENTICATED;
    case 'not-found':
      return NOT_FOUND;
    case 'validation':
      return VALIDATION;
    case 'failure':
      return FAILURE;
  }
}

/**
 * Feedback for the self-remove-share action (Issue #37): the only write
 * this feature offers with no field-level validation at all, so it has no
 * `validation` case distinct from `failure` - a tampered/missing share id
 * is reported the same way a data-layer failure would be.
 */
export function resolveRemoveShareFeedback(kind: PlanningErrorKind): ScheduleWriteFeedback {
  switch (kind) {
    case 'permission-denied':
      return REMOVE_SHARE_PERMISSION_DENIED;
    case 'unauthenticated':
      return UNAUTHENTICATED;
    case 'not-found':
      return REMOVE_SHARE_NOT_FOUND;
    case 'validation':
    case 'failure':
      return FAILURE;
  }
}

/**
 * The state a schedule write form carries between submissions. Mirrors
 * domain/eventWriteFeedback.ts's EventWriteFormState - see there for why
 * `values` is echoed and `attempt` exists as a remount key.
 */
export interface ScheduleWriteFormState {
  attempt: number;
  fieldErrors: FieldErrors;
  feedback: ScheduleWriteFeedback | null;
  values: RawFormValues;
  notice: string | null;
}

export const INITIAL_SCHEDULE_WRITE_FORM_STATE: ScheduleWriteFormState = {
  attempt: 0,
  fieldErrors: {},
  feedback: null,
  values: {},
  notice: null,
};

export function rejectedWriteFormState(
  previous: ScheduleWriteFormState,
  values: RawFormValues,
  fieldErrors: FieldErrors,
  feedback: ScheduleWriteFeedback | null,
): ScheduleWriteFormState {
  return { attempt: previous.attempt + 1, fieldErrors, feedback, values, notice: null };
}

export function acceptedWriteFormState(
  previous: ScheduleWriteFormState,
  values: RawFormValues,
  notice: string,
): ScheduleWriteFormState {
  return { attempt: previous.attempt + 1, fieldErrors: {}, feedback: null, values, notice };
}

/** State for the self-remove-share action - no field errors, no persisted
 * `values` to echo, since it submits nothing but an id. */
export interface ScheduleShareRemoveFormState {
  attempt: number;
  feedback: ScheduleWriteFeedback | null;
}

export const INITIAL_SHARE_REMOVE_FORM_STATE: ScheduleShareRemoveFormState = {
  attempt: 0,
  feedback: null,
};

export function rejectedShareRemoveFormState(
  previous: ScheduleShareRemoveFormState,
  feedback: ScheduleWriteFeedback,
): ScheduleShareRemoveFormState {
  return { attempt: previous.attempt + 1, feedback };
}

/**
 * Feedback for the owner-initiated recipient-remove action (Issue #37,
 * over #55's shareScheduleEntryByEmail/listScheduleShareRecipientEmails
 * boundary). Uses the same removeScheduleShare write as self-remove
 * (resolveRemoveShareFeedback above) - the DELETE policy is identical for
 * both actors - but the wording is owner-facing ("you" removed someone)
 * rather than self-facing ("you" left), so this is a distinct resolver
 * rather than a shared one with a generic "共有" message.
 */
export function resolveOwnerRemoveShareFeedback(kind: PlanningErrorKind): ScheduleWriteFeedback {
  switch (kind) {
    case 'permission-denied':
      return OWNER_REMOVE_SHARE_PERMISSION_DENIED;
    case 'unauthenticated':
      return UNAUTHENTICATED;
    case 'not-found':
      return OWNER_REMOVE_SHARE_NOT_FOUND;
    case 'validation':
    case 'failure':
      return FAILURE;
  }
}

/**
 * What a failed share_schedule_entry_by_email RPC call (Issue #55) means
 * to the owner adding a recipient - split into a field-level message (for
 * the email input) versus a systemic one (StatePanel), matching how every
 * other write form in this feature separates the two.
 *
 * classifyRpcError only ever classifies this RPC's four distinct
 * `raise exception` reasons (missing input, malformed email, self-share,
 * unregistered account - see SHARE_BY_EMAIL_ERROR_RULES in
 * infrastructure/supabase/personalSchedule.ts) as the single `validation`
 * PlanningErrorKind, because all four are "the submitted email is wrong"
 * in the typed boundary's coarser vocabulary. This module's job is
 * distinguishing them again by their own message text - the same
 * message-text-matching convention classifyRpcError itself uses - because
 * docs/ux-ui.md requires the specific case PO explicitly called out
 * (unlike invitation targeting, this recipient-add path may disclose "no
 * such registered account" directly) to read as its own field error, not
 * a generic "something about this input is wrong".
 */
function shareByEmailValidationFieldError(message: string): string {
  if (message.includes('not a registered account')) {
    return 'このメールアドレスで登録されているユーザーが見つかりません。正しいメールアドレスを確認してください。';
  }
  if (message.includes('cannot share with yourself')) {
    return '自分自身とは共有できません。';
  }
  if (message.includes('not a valid email address')) {
    return 'メールアドレスの形式が正しくありません。';
  }
  return 'メールアドレスを入力してください。';
}

export function resolveShareByEmailOutcome(error: PlanningError): {
  fieldError: string | null;
  feedback: ScheduleWriteFeedback | null;
} {
  // An exhaustive switch over PlanningErrorKind - not an if/else chain -
  // so that if this RPC's error rules (SHARE_BY_EMAIL_ERROR_RULES in
  // infrastructure/supabase/personalSchedule.ts) are ever extended to
  // produce a `not-found`, this stops compiling instead of silently
  // falling through to the generic FAILURE panel below.
  switch (error.kind) {
    case 'validation':
      return { fieldError: shareByEmailValidationFieldError(error.message), feedback: null };
    case 'permission-denied':
      return { fieldError: null, feedback: SHARE_ADD_PERMISSION_DENIED };
    case 'unauthenticated':
      return { fieldError: null, feedback: UNAUTHENTICATED };
    case 'not-found':
    case 'failure':
      return { fieldError: null, feedback: FAILURE };
  }
}

const SHARE_ADD_NOTICE = 'recipientを追加しました。';

/** State the recipient-add form carries between submissions. No `values`
 * echo beyond the single email field - see ScheduleWriteFormState for the
 * multi-field convention this intentionally does not need here. */
export interface ScheduleShareAddFormState {
  attempt: number;
  email: string;
  fieldError: string | null;
  feedback: ScheduleWriteFeedback | null;
  notice: string | null;
}

export const INITIAL_SHARE_ADD_FORM_STATE: ScheduleShareAddFormState = {
  attempt: 0,
  email: '',
  fieldError: null,
  feedback: null,
  notice: null,
};

export function rejectedShareAddFormState(
  previous: ScheduleShareAddFormState,
  email: string,
  fieldError: string | null,
  feedback: ScheduleWriteFeedback | null,
): ScheduleShareAddFormState {
  return { attempt: previous.attempt + 1, email, fieldError, feedback, notice: null };
}

/** The email field is cleared on success, unlike an edit form's `values` -
 * an "add another recipient" form should start empty, not keep showing the
 * email that was just added (mirrors eventWrite.ts's addOccurrenceAction
 * clearing its form for the identical reason). */
export function acceptedShareAddFormState(
  previous: ScheduleShareAddFormState,
): ScheduleShareAddFormState {
  return {
    attempt: previous.attempt + 1,
    email: '',
    fieldError: null,
    feedback: null,
    notice: SHARE_ADD_NOTICE,
  };
}
