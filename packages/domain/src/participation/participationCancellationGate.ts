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
 * Historical ambiguity (reported, not guessed away - see this task's report):
 * the current implementation rejects *any* new row while canceled (not only a new
 * row whose status is `attending`), which is the reading this function
 * implements (the `create` case below returns `true` unconditionally). The
 * Spec 001's
 * prose ("新規 attending 遷移（行の新規作成、または considering ->
 * attending）") could also be read as scoping the new-row case to `attending`
 * only. Both readings agree on every other branch: withdraw is always
 * allowed, `attending -> considering` is always allowed, and `considering ->
 * attending` is always blocked while canceled.
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
