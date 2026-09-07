import { isCanceled, type Cancelable } from '../event/cancellation';
import type { TicketOpportunityTargetScope } from './ticketOpportunity';

/**
 * Opportunity-scope effective-cancellation aggregation
 * (docs/v2/oracle-domain.md §2.7 "Opportunity-scope の実質的中止判定"):
 *
 * 1. The parent Event is canceled -> the whole Opportunity is terminal,
 *    regardless of targetScope.
 * 2. `event_wide` with the Event not canceled -> never terminal from
 *    Occurrence state alone. `event_wide` is a semantic fact about the
 *    whole Event, not a snapshot of whichever Occurrences currently exist
 *    (AGENTS.md "Target scope"), so one current Occurrence being canceled
 *    must not cancel the Opportunity.
 * 3. `selected_occurrences` with the Event not canceled -> terminal only
 *    when the target set is *completely* resolved
 *    (`resolvedTargetOccurrences.length === targetOccurrenceIdCount`), that
 *    resolved set is non-empty, AND every resolved target is canceled.
 *    Neither an empty resolved set nor a *partially* resolved one (e.g. a
 *    defensive missing-read drop for only some ids) may read as "all
 *    canceled" - both are inferring global cancellation from an
 *    incomplete/unresolved target set, which this rule explicitly forbids
 *    (docs/v2/oracle-domain.md §2.7: "取りこぼしを「全部中止」と誤読しない").
 *
 * `resolvedTargetOccurrences` deliberately takes only the minimal
 * `Cancelable` shape (../event/cancellation.ts) rather than a full
 * `Occurrence`, keeping this module decoupled from anything about an
 * Occurrence beyond its cancellation state.
 */
export interface TicketOpportunityCancellationScope {
  readonly eventCanceled: boolean;
  readonly targetScope: TicketOpportunityTargetScope;
  /** Cancellation state of whichever target Occurrences the caller
   * successfully resolved - may be shorter than `targetOccurrenceIdCount`
   * when one or more target ids failed to resolve (dropped, never
   * fabricated). Always empty for `event_wide` by construction. */
  readonly resolvedTargetOccurrences: readonly Cancelable[];
  /** The full requested target count, independent of how many of those ids
   * actually resolved into `resolvedTargetOccurrences`. Always 0 for
   * `event_wide`. */
  readonly targetOccurrenceIdCount: number;
}

export function isTicketOpportunityEffectivelyCanceled(
  scope: TicketOpportunityCancellationScope,
): boolean {
  if (scope.eventCanceled) {
    return true;
  }
  if (scope.targetScope === 'event_wide') {
    return false;
  }
  if (scope.resolvedTargetOccurrences.length === 0) {
    return false;
  }
  if (scope.resolvedTargetOccurrences.length !== scope.targetOccurrenceIdCount) {
    return false;
  }
  return scope.resolvedTargetOccurrences.every((occurrence) => isCanceled(occurrence));
}
