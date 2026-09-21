import type { ParticipationStatus } from '../participation/participation';

/**
 * Invite eligibility (see `specs/006-invitation-coordination-opacity/spec.md`): only a
 * user who is currently `attending` the target Occurrence may invite someone to it.
 * Being the Event owner grants no
 * eligibility on its own - this function does not even accept an "is owner"
 * parameter, so that fact cannot leak into the decision by accident.
 */
export function canInviteToOccurrence(
  inviterParticipationStatus: ParticipationStatus | null,
): boolean {
  return inviterParticipationStatus === 'attending';
}
