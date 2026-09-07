import type { EventId, OccurrenceId } from '../ids';
import type { TicketOpportunityMilestoneId } from './ids';
import type { TicketOpportunityMilestoneType } from './ticketOpportunityMilestone';

/**
 * Cross-entity invariants for a TicketOpportunity aggregate
 * (docs/v2/oracle-domain.md §1.9/§2.7). These cannot live on
 * `ticketOpportunitySchema`/`ticketOpportunityMilestoneSchema` alone
 * because they need sibling records (the Opportunity's target Occurrences,
 * its full milestone set) as context - the same reason
 * ../event/eventOccurrenceInvariants.ts is a separate module from
 * ../event/occurrence.ts.
 */

export type TicketOpportunityInvariantViolation =
  | {
      readonly kind: 'target-occurrence-outside-event';
      readonly occurrenceId: OccurrenceId;
    }
  | {
      readonly kind: 'duplicate-milestone-type';
      readonly milestoneType: TicketOpportunityMilestoneType;
      /** All milestones sharing this type (length >= 2). */
      readonly milestoneIds: readonly TicketOpportunityMilestoneId[];
    };

/**
 * Validates a full Opportunity aggregate against both cross-entity
 * invariants:
 *
 * - every target Occurrence belongs to the same Event as the Opportunity
 *   itself (AGENTS.md "selected target の Occurrence は、必ずその
 *   Opportunity の Event に属していなければなりません");
 * - at most one milestone per `milestoneType` for this Opportunity
 *   (docs/v2/oracle-database.md §1.10 UK `(opportunity_id, milestone_type)`
 *   - "同一 Opportunity に同種 milestone は最大1件").
 *
 * Returns every violation found (not just the first), mirroring
 * `findEventOccurrenceInvariantViolations`'s own convention.
 */
export function findTicketOpportunityInvariantViolations(
  opportunityEventId: EventId,
  targetOccurrences: readonly { readonly id: OccurrenceId; readonly eventId: EventId }[],
  milestones: readonly {
    readonly id: TicketOpportunityMilestoneId;
    readonly milestoneType: TicketOpportunityMilestoneType;
  }[],
): TicketOpportunityInvariantViolation[] {
  const violations: TicketOpportunityInvariantViolation[] = [];

  for (const occurrence of targetOccurrences) {
    if (occurrence.eventId !== opportunityEventId) {
      violations.push({ kind: 'target-occurrence-outside-event', occurrenceId: occurrence.id });
    }
  }

  const groups: {
    milestoneType: TicketOpportunityMilestoneType;
    milestoneIds: TicketOpportunityMilestoneId[];
  }[] = [];
  for (const milestone of milestones) {
    const existingGroup = groups.find((group) => group.milestoneType === milestone.milestoneType);
    if (existingGroup === undefined) {
      groups.push({ milestoneType: milestone.milestoneType, milestoneIds: [milestone.id] });
    } else {
      existingGroup.milestoneIds.push(milestone.id);
    }
  }
  for (const group of groups) {
    if (group.milestoneIds.length > 1) {
      violations.push({
        kind: 'duplicate-milestone-type',
        milestoneType: group.milestoneType,
        milestoneIds: group.milestoneIds,
      });
    }
  }

  return violations;
}

/**
 * The single-occurrence-check counterpart of the first
 * `findTicketOpportunityInvariantViolations` rule, useful when a caller
 * only has one candidate target Occurrence at hand (e.g. validating a
 * single new target before adding it) rather than a full aggregate.
 */
export function isTicketOpportunityTargetOccurrenceValid(
  opportunityEventId: EventId,
  targetOccurrenceEventId: EventId,
): boolean {
  return targetOccurrenceEventId === opportunityEventId;
}
