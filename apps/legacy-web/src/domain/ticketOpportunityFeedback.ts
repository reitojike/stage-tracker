import type { PlanningError, PlanningErrorKind } from './planningError.ts';
import type { UserTicketOpportunityStatus } from './ticketOpportunity.ts';

// What a failed personal Ticket Opportunity planning-state write means to
// the person who attempted it (Issue #144). Mirrors
// domain/participationFeedback.ts's role/shape for the participation write
// boundary: docs/ux-ui.md's "Common states" requires permission denial,
// validation failure, and data/infrastructure failure to be presented
// distinctly, never collapsed into one message and never shown as empty.
// Pure logic, so it stays unit-testable and separate from presentation
// (StatePanel owns rendering only).

export type TicketOpportunityOperation =
  'set-ticket-opportunity-state' | 'remove-ticket-opportunity-state';

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

const NOT_FOUND: Record<TicketOpportunityOperation, OperationFeedback> = {
  'set-ticket-opportunity-state': {
    variant: 'error',
    title: '登録状況を更新できませんでした',
    description:
      '対象の抽選・販売情報が見つかりません。ページを再読み込みしてもう一度お試しください。',
  },
  'remove-ticket-opportunity-state': {
    variant: 'error',
    title: '登録を解除できませんでした',
    description: '対象の登録が見つかりません。ページを再読み込みしてもう一度お試しください。',
  },
};

const PERMISSION_DENIED: Record<TicketOpportunityOperation, OperationFeedback> = {
  'set-ticket-opportunity-state': {
    variant: 'error',
    title: '登録状況を更新できませんでした',
    description: '自分自身の登録状況のみ更新できます。',
  },
  'remove-ticket-opportunity-state': {
    variant: 'error',
    title: '登録を解除できませんでした',
    description: '自分自身の登録のみ解除できます。',
  },
};

const VALIDATION: Record<TicketOpportunityOperation, OperationFeedback> = {
  'set-ticket-opportunity-state': {
    variant: 'error',
    title: '登録状況を更新できませんでした',
    description: '入力内容に問題があります。もう一度お試しください。',
  },
  'remove-ticket-opportunity-state': {
    variant: 'error',
    title: '登録を解除できませんでした',
    description: '入力内容に問題があります。もう一度お試しください。',
  },
};

export function resolveTicketOpportunityOperationFeedback(
  operation: TicketOpportunityOperation,
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

export function resolveTicketOpportunityOperationFeedbackForError(
  operation: TicketOpportunityOperation,
  error: PlanningError,
): OperationFeedback {
  return resolveTicketOpportunityOperationFeedback(operation, error.kind);
}

/** What a successful write should tell the person who performed it. Takes
 * the status actually persisted rather than a fixed string, since
 * "申し込む予定に設定しました" and "申し込み済みに設定しました" are
 * different confirmations for the same operation (mirrors
 * domain/participationFeedback.ts's resolveParticipationSetNotice). */
export function resolveTicketOpportunityStateSetNotice(
  status: UserTicketOpportunityStatus,
): string {
  return status === 'applied'
    ? '「申し込み済み」に設定しました。'
    : '「申し込む予定」に設定しました。';
}

export function ticketOpportunityRemoveNotice(): string {
  return '登録を解除しました。';
}

/**
 * The state one of these operation forms carries between submissions.
 * `attempt` increments on every returned state and is used as a remount key
 * by the component (see domain/participationFeedback.ts's OperationState for
 * why - an already-mounted uncontrolled live region ignores a changed
 * message otherwise).
 */
export interface TicketOpportunityOperationState {
  attempt: number;
  feedback: OperationFeedback | null;
  /** Confirmation text for a write that succeeded, or null. */
  notice: string | null;
}

export const INITIAL_TICKET_OPPORTUNITY_OPERATION_STATE: TicketOpportunityOperationState = {
  attempt: 0,
  feedback: null,
  notice: null,
};

export function rejectedTicketOpportunityOperationState(
  previous: TicketOpportunityOperationState,
  feedback: OperationFeedback | null,
): TicketOpportunityOperationState {
  return { attempt: previous.attempt + 1, feedback, notice: null };
}

export function acceptedTicketOpportunityOperationState(
  previous: TicketOpportunityOperationState,
  notice: string,
): TicketOpportunityOperationState {
  return { attempt: previous.attempt + 1, feedback: null, notice };
}
