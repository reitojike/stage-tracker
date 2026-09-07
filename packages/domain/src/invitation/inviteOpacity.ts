import type { ParticipationStatus } from '../participation/participation';
import { err, ok, type Result } from '../result';
import { canInviteToOccurrence } from './inviteEligibility';

/**
 * The invite-time opacity boundary (docs/v2/oracle-domain.md §1.7, AGENTS.md
 * "Invitation" opacity requirement, docs/v2/decisions.md "v2 実装で踏んでは
 * いけない地雷": "Invitation の opacity 境界は「動いているように見えても
 * 静かに破れる」領域"). Inviting dispatches on the invitee's *current*,
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
 *
 * `planInviteWrite` is the separate, trusted-write-boundary-only function
 * that computes what to actually write, from the invitee's private
 * participation state. It is never combined into the same value as
 * `InviteOutcome` - the trusted write boundary calls it directly, using the
 * same `inviteeParticipationStatus` it already read to build the
 * `InviteRequest`, strictly after confirming `evaluateInvite` succeeded (a
 * rejection must never write anything). Keeping these as two independently
 * returned values, rather than one object with both fields, is what removes
 * the "accidentally serialize the whole result" leak this module used to
 * have.
 */

/**
 * Whether a pending Invitation row should be created for this invite. This
 * is the only thing that differs across the three invitee-state branches
 * (docs/v2/oracle-domain.md §1.7):
 *
 * 1. no existing Participation row -> create (invitee's Participation is
 *    left untouched, no auto-`considering`)
 * 2. existing `considering` -> create (status untouched)
 * 3. existing `attending` -> do not create (invite is a no-op; the existing
 *    `attending` row is left exactly as-is)
 *
 * `createInvitation` is derived from the invitee's *private* participation
 * state, so it must stay on the trusted side of the opacity boundary and
 * never be forwarded to the inviter. Call this directly from the trusted
 * write boundary (after `evaluateInvite` has confirmed the invite is
 * eligible) - never route it through, or attach it to, `evaluateInvite`'s
 * return value. See the module-level comment above and `InviteOutcome`
 * below for the value that IS safe to report back to the inviter.
 */
export interface InviteWritePlan {
  readonly createInvitation: boolean;
}

export function planInviteWrite(
  inviteeParticipationStatus: ParticipationStatus | null,
): InviteWritePlan {
  return { createInvitation: inviteeParticipationStatus !== 'attending' };
}

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
 * (docs/v2/oracle-database.md §5 invariant 12: new invitations are rejected
 * on an effectively canceled Occurrence), and invite eligibility
 * (`canInviteToOccurrence`). Rejections are about the *inviter's own*
 * state/action (self-invite, their own eligibility) or the occurrence's
 * shared cancellation state - never about the invitee's private
 * participation state - so it is safe for `InviteRejectionReason` to be
 * inviter-visible and branch-specific.
 *
 * This function's success value is `INVITE_OUTCOME` and nothing else - it
 * never touches `inviteeParticipationStatus`. Callers that need the actual
 * write plan (the trusted write boundary only) call `planInviteWrite`
 * separately once this has confirmed the invite is eligible; see the
 * module-level comment above.
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
