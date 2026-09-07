import type { Invitation } from './invitation';

/**
 * P3 decline/undo semantics (docs/v2/decisions.md "P3 — decline の確定と
 * undo", 2026-09-07 PO decision, superseding the old client-side
 * 8-second-timer model described in oracle-routes-ui §5): decline is an
 * immediate, confirmed hard delete - not a delayed/optimistic one. "Undo" is
 * not a reversal of a pending delete (there is nothing left server-side to
 * reverse); it recreates a brand-new pending Invitation from a snapshot the
 * caller already held *before* the delete:
 *
 * ```
 * 「参加しない」を押す
 *   -> 即座に invitation を hard delete（サーバ確定）
 *   -> 画面に「取り消す」を N 秒表示
 *   -> 押されたら、同じ inviter からの pending invitation を作り直す
 * ```
 *
 * This matches product rules' "decline を永久 opt-out として扱わない、
 * 再 invite できる" - undo is just an ordinary re-invite by the same
 * inviter, using parties the client already has in hand, so there is no
 * need for the server to persist any intermediate "declined but undoable"
 * state (decisions.md: "サーバ側に中間状態を持つ必要がない").
 */
export interface DeclinedInvitationSnapshot {
  readonly occurrenceId: Invitation['occurrenceId'];
  readonly inviterId: Invitation['inviterId'];
  readonly inviteeId: Invitation['inviteeId'];
}

export function captureDeclinedInvitation(
  invitation: Pick<Invitation, 'occurrenceId' | 'inviterId' | 'inviteeId'>,
): DeclinedInvitationSnapshot {
  return {
    occurrenceId: invitation.occurrenceId,
    inviterId: invitation.inviterId,
    inviteeId: invitation.inviteeId,
  };
}

/**
 * A draft for the fresh Invitation that "undo" creates. This is
 * deliberately the exact same shape as `DeclinedInvitationSnapshot`: undo IS
 * a re-invite with the same parties, not a distinct operation. Its result is
 * meant to be re-evaluated through the normal `evaluateInvite` (see
 * ./inviteOpacity.ts) rather than bypassing eligibility - see this task's
 * report for the one point this leaves open (whether re-validating on undo
 * is required or merely this implementation's conservative default).
 */
export type NewInvitationDraft = DeclinedInvitationSnapshot;

export function undoDecline(snapshot: DeclinedInvitationSnapshot): NewInvitationDraft {
  return snapshot;
}
