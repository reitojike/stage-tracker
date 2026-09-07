/**
 * Cancellation (AGENTS.md "Cancellation", docs/v2/oracle-domain.md §1.3/§2.3).
 *
 * Event-level and Occurrence-level cancellation are independent nullable
 * timestamps; "effective cancellation" is their OR. Only whether `canceledAt`
 * is `null` matters - the exact timestamp value carries no product meaning,
 * which is why this module works against the minimal `Cancelable` shape
 * instead of requiring a full `Event`/`Occurrence`.
 *
 * Uncancel-independence ("Event の uncancel は個別に canceled 状態の
 * Occurrence の cancellation を解除しない") is a write-side rule about two
 * separate columns, not a computation - there is nothing to derive here, so
 * it is not modeled as a function. It is enforced by never having
 * `isEffectivelyCanceled` (or anything else in this package) write back to
 * either `canceledAt` field.
 */
import type { Instant } from '../time/instant';

export interface Cancelable {
  readonly canceledAt: Instant | null;
}

export function isCanceled(entity: Cancelable): boolean {
  return entity.canceledAt !== null;
}

export function isEffectivelyCanceled(event: Cancelable, occurrence: Cancelable): boolean {
  return isCanceled(event) || isCanceled(occurrence);
}
