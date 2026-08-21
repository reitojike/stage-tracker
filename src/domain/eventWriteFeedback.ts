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

const FAILURE: EventWriteFeedback = {
  variant: 'error',
  title: '保存に失敗しました',
  description: '通信状況を確認し、もう一度お試しください。',
};

export function resolveWriteFeedback(
  operation: EventWriteOperation,
  kind: EventCatalogWriteErrorKind,
): EventWriteFeedback {
  switch (kind) {
    case 'permission-denied':
      return PERMISSION_DENIED[operation];
    case 'validation':
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
}

export const INITIAL_WRITE_FORM_STATE: EventWriteFormState = {
  attempt: 0,
  fieldErrors: {},
  feedback: null,
  values: {},
};

/** Builds the next state after a rejected submission, preserving the
 * submitted values and advancing the remount key. */
export function rejectedWriteFormState(
  previous: EventWriteFormState,
  values: RawFormValues,
  fieldErrors: FieldErrors,
  feedback: EventWriteFeedback | null,
): EventWriteFormState {
  return { attempt: previous.attempt + 1, fieldErrors, feedback, values };
}
