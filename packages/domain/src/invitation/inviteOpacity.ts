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
 * This module keeps the branch-dependent decision (`InviteWritePlan`, for
 * the trusted write boundary only) and the inviter-facing result
 * (`InviteOutcome`, uniform by construction) as two separate types so that a
 * caller cannot accidentally return branch-dependent data to the inviter -
 * doing so would require inventing a new field on `InviteOutcome`, which
 * would be a visible, reviewable type change rather than a silent leak.
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
 * never be forwarded to the inviter as-is. See `InviteOutcome` for the value
 * that IS safe to report back to the inviter.
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
 * indistinguishable from the inviter's side.
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

export interface InviteDecision {
  /** Safe to report back to the inviter. Always `INVITE_OUTCOME`. */
  readonly outcome: InviteOutcome;
  /** For the trusted write boundary only - never surface this to the inviter. */
  readonly writePlan: InviteWritePlan;
}

/**
 * Full invite evaluation: self-invite guard, the cancellation gate
 * (docs/v2/oracle-database.md §5 invariant 12: new invitations are rejected
 * on an effectively canceled Occurrence), invite eligibility
 * (`canInviteToOccurrence`), and finally the opaque write plan. Rejections
 * are about the *inviter's own* state/action (self-invite, their own
 * eligibility) or the occurrence's shared cancellation state - never about
 * the invitee's private participation state - so it is safe for
 * `InviteRejectionReason` to be inviter-visible and branch-specific; only
 * the invitee-state dispatch inside `InviteDecision.writePlan` needs to stay
 * opaque.
 */
export function evaluateInvite(
  request: InviteRequest,
): Result<InviteDecision, InviteRejectionReason> {
  if (request.isSelfInvite) {
    return err('self-invite');
  }
  if (request.isOccurrenceEffectivelyCanceled) {
    return err('occurrence-effectively-canceled');
  }
  if (!canInviteToOccurrence(request.inviterParticipationStatus)) {
    return err('inviter-not-attending');
  }
  return ok({
    outcome: INVITE_OUTCOME,
    writePlan: planInviteWrite(request.inviteeParticipationStatus),
  });
}
