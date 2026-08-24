import type {
  EventCatalogWriteErrorKind,
  FieldErrors,
  RawFormValues,
} from './eventCatalogWrite.ts';

// What a failed Event catalog write means to the person who attempted it
// (Issue #29). docs/ux-ui.md's "Common states" requires permission denial,
// validation failure and data/infrastructure failure to be presented
// distinctly - never collapsed into one message, and never shown as an
// empty result. That distinction is a feature/domain judgment, so it is
// resolved here as pure logic and pinned by tests, rather than being
// implied by whatever markup a component happens to render.
//
// The shared UI layer still owns only presentation: these values are
// handed to StatePanel as variant + message.

export type EventWriteOperation =
  'create-event' | 'update-event' | 'add-occurrence' | 'update-occurrence';

export interface EventWriteFeedback {
  /** Maps onto StatePanel's variant. */
  variant: 'error';
  title: string;
  description: string;
}

const PERMISSION_DENIED: Record<EventWriteOperation, EventWriteFeedback> = {
  // Names the actual restriction rather than a generic refusal: an
  // authenticated user who is not a designated catalog creator has not
  // done anything wrong, and retrying will not help them.
  'create-event': {
    variant: 'error',
    title: 'イベントを作成する権限がありません',
    description:
      'イベントの新規作成は、カタログ登録を担当するユーザーのみが行えます。登録が必要な場合は管理者に連絡してください。',
  },
  'update-event': {
    variant: 'error',
    title: 'このイベントを編集する権限がありません',
    description: 'イベント情報を編集できるのは、そのイベントを登録したユーザーだけです。',
  },
  'add-occurrence': {
    variant: 'error',
    title: 'この公演回を追加する権限がありません',
    description: '公演回を追加できるのは、そのイベントを登録したユーザーだけです。',
  },
  'update-occurrence': {
    variant: 'error',
    title: 'この公演回を編集する権限がありません',
    description: '公演回を編集できるのは、そのイベントを登録したユーザーだけです。',
  },
};

const VALIDATION: EventWriteFeedback = {
  variant: 'error',
  title: '入力内容を保存できませんでした',
  description: '入力内容に問題があります。各項目の内容を確認して、もう一度お試しください。',
};

/**
 * Issue #79's (event_id, starts_at) uniqueness violation, named at the
 * startsAt field rather than folded into the generic VALIDATION banner
 * above: unlike a malformed value, there is nothing wrong with the input's
 * shape, and the fix is specific (pick a different start time), so the
 * message says exactly that instead of a generic "check your input".
 */
const DUPLICATE_OCCURRENCE_FIELD_ERRORS: FieldErrors = {
  startsAt: 'この開始日時の公演回は、このイベントに既に登録されています。',
};

export function resolveDuplicateOccurrenceFieldErrors(): FieldErrors {
  return DUPLICATE_OCCURRENCE_FIELD_ERRORS;
}

const FAILURE: EventWriteFeedback = {
  variant: 'error',
  title: '保存に失敗しました',
  description: '通信状況を確認し、もう一度お試しください。',
};

/**
 * What a *successful* write should tell the person who performed it.
 *
 * Kept here beside the failure messages because it is the same kind of
 * feature-level judgment, and because the alternative - signalling success
 * through a redirect query parameter - made the receiving page look the
 * message up by an untrusted string. Success now travels in the action's
 * own return value, so there is no key to forge and no URL state to keep
 * in sync.
 *
 * 'create-event' has no entry: a successful create navigates to the new
 * event instead of staying on the form, so it has nothing to announce in
 * place.
 */
const SUCCESS_NOTICES: Record<Exclude<EventWriteOperation, 'create-event'>, string> = {
  'update-event': 'イベント情報を保存しました。',
  'add-occurrence': '公演回を追加しました。',
  'update-occurrence': '公演回を保存しました。',
};

export function resolveWriteNotice(
  operation: Exclude<EventWriteOperation, 'create-event'>,
): string {
  return SUCCESS_NOTICES[operation];
}

export function resolveWriteFeedback(
  operation: EventWriteOperation,
  kind: EventCatalogWriteErrorKind,
): EventWriteFeedback {
  switch (kind) {
    case 'permission-denied':
      return PERMISSION_DENIED[operation];
    case 'validation':
      return VALIDATION;
    // add-occurrence/update-occurrence intercept 'duplicate-occurrence'
    // before calling this function, to report it at the startsAt field
    // instead (resolveDuplicateOccurrenceFieldErrors). create-event and
    // update-event cannot produce this kind at all: the create RPC always
    // targets a brand-new event id, and an event-details update never
    // touches event_occurrences. This case exists so the switch stays
    // total for every EventCatalogWriteErrorKind regardless of operation.
    case 'duplicate-occurrence':
      return VALIDATION;
    case 'failure':
      return FAILURE;
  }
}

/**
 * The state a write form carries between submissions.
 *
 * `values` echoes what was submitted so a failed attempt can re-render the
 * form with the user's own input intact instead of silently clearing it.
 * `attempt` increments on every returned state; the form uses it as a
 * remount key, because an already-mounted uncontrolled input ignores a
 * changed `defaultValue`.
 */
export interface EventWriteFormState {
  attempt: number;
  fieldErrors: FieldErrors;
  feedback: EventWriteFeedback | null;
  values: RawFormValues;
  /** Confirmation text for a write that succeeded, or null. */
  notice: string | null;
}

export const INITIAL_WRITE_FORM_STATE: EventWriteFormState = {
  attempt: 0,
  fieldErrors: {},
  feedback: null,
  values: {},
  notice: null,
};

/** Builds the next state after a rejected submission, preserving the
 * submitted values and advancing the remount key. */
export function rejectedWriteFormState(
  previous: EventWriteFormState,
  values: RawFormValues,
  fieldErrors: FieldErrors,
  feedback: EventWriteFeedback | null,
): EventWriteFormState {
  return { attempt: previous.attempt + 1, fieldErrors, feedback, values, notice: null };
}

/**
 * Builds the next state after a write that succeeded.
 *
 * `attempt` advances here as well as on rejection, and that is load-bearing
 * rather than incidental: it is the forms' remount key, so a successful
 * submission re-mounts the fields and the inputs take their new
 * `defaultValue`. Without it an "add another" form would keep the values
 * that were just persisted sitting in the DOM under a message saying they
 * were saved - an easy way to add the same 公演回 twice.
 *
 * `values` is passed in rather than cleared unconditionally: an edit form
 * should keep showing what it just saved, while an add form should start
 * empty again.
 */
export function acceptedWriteFormState(
  previous: EventWriteFormState,
  values: RawFormValues,
  notice: string,
): EventWriteFormState {
  return { attempt: previous.attempt + 1, fieldErrors: {}, feedback: null, values, notice };
}
