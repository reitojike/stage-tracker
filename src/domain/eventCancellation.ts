// Event / Occurrence cancellation lifecycle (Issue #125, PO decision #123).
//
// Product semantics (see .ai-dev-foundation/product-rules.md "Cancellation"):
// - Event-level and Occurrence-level cancellation are independent booleans.
// - "Effective cancellation" (the state that actually gates new active
//   actions and drives "中止" display) is `Event canceled OR Occurrence
//   canceled` - never derived any other way, and never cascaded: canceling
//   or un-canceling the Event never touches the Occurrence's own flag.
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs). The database enforces
// the same composition at the write boundary (supabase/migrations/
// 20260826000200_create_event_occurrence_cancellation.sql's
// event_occurrence_is_effectively_canceled), so this is the same judgment
// mirrored for presentation/UI-affordance decisions, not a substitute for
// that enforcement.

export interface CancelableEvent {
  canceledAt: string | null;
}

export interface CancelableOccurrence {
  canceledAt: string | null;
}

export function isEventCanceled(event: CancelableEvent): boolean {
  return event.canceledAt !== null;
}

export function isOccurrenceCanceled(occurrence: CancelableOccurrence): boolean {
  return occurrence.canceledAt !== null;
}

/**
 * Effective cancellation for one occurrence: canceled if its parent Event
 * is canceled, or if the occurrence itself is - product-rules.md's OR
 * composition, never Occurrence-only or Event-only.
 */
export function isEffectivelyCanceled(
  event: CancelableEvent,
  occurrence: CancelableOccurrence,
): boolean {
  return isEventCanceled(event) || isOccurrenceCanceled(occurrence);
}
