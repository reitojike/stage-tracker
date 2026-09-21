import type { ParticipationStatus } from '../participation/participation';
import { err, ok, type Result } from '../result';
import { canInviteToOccurrence } from './inviteEligibility';

/**
 * The invite-time opacity boundary is defined by Spec 006. Inviting dispatches
 * on the invitee's *current*,
 * private Participation state into one of three branches, but the inviter
 * must never be able to tell which branch ran.
 *
 * `evaluateInvite` is the ONLY function whose return value is meant to be
 * forwarded to the inviter. Its success type is `InviteOutcome`, a literal
 * type with exactly one possible value - not an object that some field could
 * later be added to. This is a type-level guarantee, not a comment-level
 * promise: a caller that serializes `evaluateInvite`'s return value (e.g. a
 * Server Action returning `result.value` to the client) cannot leak anything
 * invitee-state-dependent, because there is nothing else in the value to
 * leak. Widening `InviteOutcome` into an object with a second field would be
 * a visible, reviewable type change, not a silent regression.
 */

/**
 * The value reported back to the inviter on a successful invite. This type
 * has exactly one possible value by construction, not merely "the same
 * value happens to be returned today" - no field derived from the invitee's
 * state can be attached to it without widening the type itself, which is
 * the type-level guarantee that the three invitee-state branches are
 * indistinguishable from the inviter's side. `evaluateInvite`'s success
 * value below IS this type directly (not an object wrapping it), so there
 * is no container for a branch-dependent field to be added to by accident.
 */
export type InviteOutcome = 'invite-sent';
export const INVITE_OUTCOME: InviteOutcome = 'invite-sent';

export type InviteRejectionReason =
  'self-invite' | 'occurrence-effectively-canceled' | 'inviter-not-attending';

export interface InviteRequest {
  readonly isSelfInvite: boolean;
  readonly isOccurrenceEffectivelyCanceled: boolean;
  readonly inviterParticipationStatus: ParticipationStatus | null;
  readonly inviteeParticipationStatus: ParticipationStatus | null;
}

/**
 * Invite eligibility evaluation: self-invite guard, the cancellation gate
 * (`specs/005-event-occurrence-lifecycle/spec.md`: new invitations are rejected
 * on an effectively canceled Occurrence), and invite eligibility
 * (`canInviteToOccurrence`). Rejections are about the *inviter's own*
 * state/action (self-invite, their own eligibility) or the occurrence's
 * shared cancellation state - never about the invitee's private
 * participation state - so it is safe for `InviteRejectionReason` to be
 * inviter-visible and branch-specific.
 *
 * This function's success value is `INVITE_OUTCOME` and nothing else - it
 * never touches `inviteeParticipationStatus`. The actual invitee-dependent
 * write remains exclusively inside the trusted RPC boundary.
 */
export function evaluateInvite(
  request: InviteRequest,
): Result<InviteOutcome, InviteRejectionReason> {
  if (request.isSelfInvite) {
    return err('self-invite');
  }
  if (request.isOccurrenceEffectivelyCanceled) {
    return err('occurrence-effectively-canceled');
  }
  if (!canInviteToOccurrence(request.inviterParticipationStatus)) {
    return err('inviter-not-attending');
  }
  return ok(INVITE_OUTCOME);
}
