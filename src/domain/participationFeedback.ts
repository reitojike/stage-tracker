import type { PlanningErrorKind } from './planningError.ts';

// What a failed participation/invitation write means to the person who
// attempted it (Issue #36). Mirrors domain/eventWriteFeedback.ts's role for
// the Event catalog write boundary: docs/ux-ui.md's "Common states"
// requires permission denial, validation failure, and data/infrastructure
// failure to be presented distinctly, never collapsed into one message and
// never shown as empty. This is pure logic so it stays unit-testable and
// separate from presentation (StatePanel owns rendering only).
//
// Uses PlanningErrorKind (5 kinds, from domain/planningError.ts) rather than
// EventCatalogWriteErrorKind (3 kinds) because the typed planning boundary
// (src/infrastructure/supabase/participation.ts, invitation.ts) reports
// `unauthenticated` and `not-found` as their own kinds, unlike the Event
// catalog write boundary.

export type ParticipationOperation =
  'set-participation' | 'withdraw-participation' | 'invite-to-occurrence' | 'decline-invitation';

export interface OperationFeedback {
  /** Maps onto StatePanel's variant. */
  variant: 'error';
  title: string;
  description: string;
}

const UNAUTHENTICATED: OperationFeedback = {
  variant: 'error',
  title: 'ログインが必要です',
  description: 'セッションの有効期限が切れている可能性があります。再度ログインしてください。',
};

const FAILURE: OperationFeedback = {
  variant: 'error',
  title: '操作に失敗しました',
  description: '通信状況を確認し、もう一度お試しください。',
};

// Every ParticipationOperation needs an entry (Record<...> below requires
// it), but not every kind is reachable for every operation today.
// setParticipation (src/infrastructure/supabase/participation.ts) never
// itself produces a 'not-found' PlanningResult - an invalid occurrenceId
// surfaces as a foreign_key_violation, which classifyPostgrestError maps to
// 'validation' - so 'set-participation' below is currently unreachable.
// Kept rather than removed: resolveOperationFeedback's exhaustive switch
// still needs a value for every (operation, kind) pair, and this is more
// accurate than reusing another operation's wording if setParticipation's
// error classification ever changes to report a real not-found case.
const NOT_FOUND: Record<ParticipationOperation, OperationFeedback> = {
  'set-participation': {
    variant: 'error',
    title: '参加予定を更新できませんでした',
    description: '対象の公演回が見つかりません。ページを再読み込みしてもう一度お試しください。',
  },
  'withdraw-participation': {
    variant: 'error',
    title: '参加予定を解除できませんでした',
    description: '対象の参加予定が見つかりません。ページを再読み込みしてもう一度お試しください。',
  },
  'invite-to-occurrence': {
    variant: 'error',
    title: '招待を送信できませんでした',
    description: '対象の公演回が見つかりません。ページを再読み込みしてもう一度お試しください。',
  },
  'decline-invitation': {
    variant: 'error',
    title: '招待を辞退できませんでした',
    description: '対象の招待が見つかりません。ページを再読み込みしてもう一度お試しください。',
  },
};

const PERMISSION_DENIED: Record<ParticipationOperation, OperationFeedback> = {
  'set-participation': {
    variant: 'error',
    title: '参加予定を更新できませんでした',
    description: '自分自身の参加予定のみ更新できます。',
  },
  'withdraw-participation': {
    variant: 'error',
    title: '参加予定を解除できませんでした',
    description: '自分自身の参加予定のみ解除できます。',
  },
  'invite-to-occurrence': {
    // Names the actual restriction: only an attending user may invite -
    // product-rules.md, "considering / event ownerだけではinvite不可".
    variant: 'error',
    title: 'この公演回への招待権限がありません',
    description: '招待できるのは、その公演回に「参加する」と設定しているユーザーだけです。',
  },
  'decline-invitation': {
    variant: 'error',
    title: '招待を辞退できませんでした',
    description: '自分宛の招待のみ辞退できます。',
  },
};

const VALIDATION: Record<ParticipationOperation, OperationFeedback> = {
  'set-participation': {
    variant: 'error',
    title: '参加予定を更新できませんでした',
    description: '入力内容に問題があります。もう一度お試しください。',
  },
  'withdraw-participation': {
    variant: 'error',
    title: '参加予定を解除できませんでした',
    description: '入力内容に問題があります。もう一度お試しください。',
  },
  'invite-to-occurrence': {
    variant: 'error',
    title: '招待を送信できませんでした',
    description: '入力されたメールアドレスを確認して、もう一度お試しください。',
  },
  'decline-invitation': {
    variant: 'error',
    title: '招待を辞退できませんでした',
    description: '入力内容に問題があります。もう一度お試しください。',
  },
};

export function resolveOperationFeedback(
  operation: ParticipationOperation,
  kind: PlanningErrorKind,
): OperationFeedback {
  switch (kind) {
    case 'unauthenticated':
      return UNAUTHENTICATED;
    case 'not-found':
      return NOT_FOUND[operation];
    case 'permission-denied':
      return PERMISSION_DENIED[operation];
    case 'validation':
      return VALIDATION[operation];
    case 'failure':
      return FAILURE;
  }
}

/**
 * What a *successful* write should tell the person who performed it.
 *
 * 'set-participation' takes the status actually persisted rather than
 * having its own fixed text, since "気になるに設定しました" and
 * "参加に設定しました" are different confirmations for the same operation.
 *
 * 'invite-to-occurrence' has exactly one notice regardless of what the RPC
 * actually did (product-rules.md opacity requirement: the outcome must not
 * reveal the invitee's participation state) - the same "sent" confirmation
 * covers "invitation created", "invitation created, invitee already
 * considering", "invitee already attending, nothing written", "no such
 * account", and "already invited, invitee previously declined" alike. See
 * src/infrastructure/supabase/invitation.ts's inviteToOccurrenceByEmail.
 */
export function resolveOperationNotice(
  operation: Exclude<ParticipationOperation, 'set-participation'>,
): string {
  switch (operation) {
    case 'withdraw-participation':
      return '参加予定を解除しました。';
    case 'invite-to-occurrence':
      return '招待を送信しました。';
    case 'decline-invitation':
      return '招待を辞退しました。';
  }
}

export function resolveParticipationSetNotice(status: 'considering' | 'attending'): string {
  return status === 'attending' ? '「参加する」に設定しました。' : '「気になる」に設定しました。';
}

/**
 * The state one of these operation forms carries between submissions.
 * `attempt` increments on every returned state and is used as a remount
 * key by the component - see domain/eventWriteFeedback.ts's
 * EventWriteFormState for why (an already-mounted uncontrolled input
 * ignores a changed defaultValue/message).
 *
 * `fieldError` and `values.email` are only ever populated by
 * invite-to-occurrence (the email input's own format validation, see
 * domain/invitationWrite.ts) - every other operation here has no free-text
 * field to validate or echo back. `values` exists so a rejected submission
 * can remount the field (advancing `attempt`, as every rejection does)
 * without losing what the caller typed - mirrors EventWriteFormState's
 * `values` for the same reason.
 */
export interface OperationState {
  attempt: number;
  feedback: OperationFeedback | null;
  fieldError: string | null;
  values: Partial<Record<string, string>>;
  /** Confirmation text for a write that succeeded, or null. */
  notice: string | null;
}

export const INITIAL_OPERATION_STATE: OperationState = {
  attempt: 0,
  feedback: null,
  fieldError: null,
  values: {},
  notice: null,
};

export function rejectedOperationState(
  previous: OperationState,
  feedback: OperationFeedback | null,
  fieldError: string | null = null,
  values: Partial<Record<string, string>> = previous.values,
): OperationState {
  return { attempt: previous.attempt + 1, feedback, fieldError, values, notice: null };
}

export function acceptedOperationState(previous: OperationState, notice: string): OperationState {
  return { attempt: previous.attempt + 1, feedback: null, fieldError: null, values: {}, notice };
}
