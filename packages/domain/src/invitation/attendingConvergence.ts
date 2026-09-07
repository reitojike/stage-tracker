import type { OccurrenceId, UserId } from '../ids';
import type { Invitation, InvitationId } from './invitation';

/**
 * "Generic attending convergence" (docs/v2/oracle-domain.md §1.7 "Generic
 * attending convergence", §5 invariant 10; AGENTS.md "Invitation"): the
 * instant an invitee's Participation reaches `attending` - through any path,
 * not only by resolving one specific Invitation - every pending Invitation
 * for that (occurrence, invitee) pair resolves, regardless of which inviter
 * sent it. This mirrors the DB trigger
 * `resolve_pending_invitations_on_attending`, which deletes by
 * `(occurrence_id, invitee_id)` alone (inviter is not part of its filter).
 */
export function invitationsResolvedByAttending(
  pendingInvitations: readonly Pick<Invitation, 'id' | 'occurrenceId' | 'inviteeId'>[],
  occurrenceId: OccurrenceId,
  inviteeId: UserId,
): readonly InvitationId[] {
  return pendingInvitations
    .filter(
      (invitation) =>
        invitation.occurrenceId === occurrenceId && invitation.inviteeId === inviteeId,
    )
    .map((invitation) => invitation.id);
}
