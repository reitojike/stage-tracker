import type { PlanningErrorKind } from './planningError.ts';
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
