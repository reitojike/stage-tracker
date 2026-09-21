import type { ParticipationStatus } from './participation';

/**
 * Mirrors the DB-level cancellation gate on `occurrence_participations`
 * writes; see `specs/001-occurrence-participation/spec.md` FR-012–FR-015):
 * while an Occurrence is effectively canceled (see
 * `../event/cancellation.ts` `isEffectivelyCanceled`), creating a *new*
 * active Participation is rejected, but withdraw (row deletion) and
 * downgrading an existing `attending` back to `considering` remain allowed
 * regardless of cancellation.
 *
 * FR-013 rejects creation of either persistable status while the Occurrence is
 * effectively canceled. Withdraw is always allowed, `attending -> considering`
 * is always allowed, and `considering -> attending` is blocked while canceled.
 */
export type ParticipationWriteTransition =
  | { readonly kind: 'create'; readonly status: ParticipationStatus }
  | {
      readonly kind: 'update';
      readonly from: ParticipationStatus;
      readonly to: ParticipationStatus;
    }
  | { readonly kind: 'withdraw' };

export function isParticipationWriteBlockedByCancellation(
  transition: ParticipationWriteTransition,
  isEffectivelyCanceled: boolean,
): boolean {
  if (!isEffectivelyCanceled) {
    return false;
  }
  switch (transition.kind) {
    case 'withdraw':
      return false;
    case 'create':
      return true;
    case 'update':
      return transition.from === 'considering' && transition.to === 'attending';
  }
}
