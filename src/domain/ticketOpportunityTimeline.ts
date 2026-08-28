import type { EventCatalogEvent, EventOccurrence } from './eventCatalog.ts';
import { sortOccurrences, tokyoCalendarDateFromInstant } from './eventCatalog.ts';
import { compareByFieldThenId } from './ordering.ts';
import type {
  TicketOpportunityMilestoneTemporalPrecision,
  TicketOpportunityMilestoneType,
  TicketOpportunityTargetScope,
  TicketOpportunityWithDetails,
  UserTicketOpportunityStatus,
} from './ticketOpportunity.ts';
import { ticketOpportunityMilestoneSortInstant } from './ticketOpportunity.ts';

// Flattens the #162 typed read boundary's per-Opportunity shape
// (TicketOpportunityWithDetails: Opportunity + its milestones + caller's own
// state) into the single chronological "1 milestone = 1 schedule row"
// timeline the /tickets Task Contract (Issue #144) requires - milestones are
// never grouped by type/section, only by month, so an application_open for
// one Opportunity can sit next to a result_announcement for another.
//
// This module composes with the Event Catalog's own typed read boundary
// (domain/eventCatalog.ts) purely by id lookup - it does not re-derive Event
// Catalog semantics, and it never fabricates a row for an id this caller's
// read didn't actually return (a missing Event/Occurrence lookup drops that
// row/detail rather than rendering a fabricated placeholder).
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs).

export interface TicketOpportunityTimelineRow {
  /** The milestone's own id - stable React key and sort tie-breaker. */
  id: string;
  opportunityId: string;
  /** The chronological instant this row sorts by (see
   * ticketOpportunityMilestoneSortInstant) - ordering-only, never displayed
   * directly (see ticketOpportunityFormatting.ts). */
  sortInstant: string;
  eventTitle: string;
  eventVenue: string | null;
  opportunityDisplayName: string;
  sourceUrl: string | null;
  targetScope: TicketOpportunityTargetScope;
  /** Only non-empty for a `selected_occurrences` Opportunity - empty for
   * `event_wide` by construction (mirrors TicketOpportunityWithDetails's own
   * targetOccurrenceIds convention, see domain/ticketOpportunity.ts). Sorted
   * chronologically, same as every other occurrence list in this product. */
  targetOccurrences: EventOccurrence[];
  milestoneType: TicketOpportunityMilestoneType;
  temporalPrecision: TicketOpportunityMilestoneTemporalPrecision;
  dateValue: string | null;
  at: string | null;
  startsAt: string | null;
  endsAt: string | null;
  /** The caller's own planning state for this row's Opportunity - identical
   * across every row of the same Opportunity, since it comes from the same
   * single per-Opportunity myState (Issue #144 Task Contract: "同一
   * Opportunityの複数milestone表示でpersonal stateが一貫する"). */
  myState: UserTicketOpportunityStatus | null;
  /** True for exactly the chronologically-earliest row of this Opportunity.
   * The UI uses this to place the (single) personal-state mutation control
   * on only one row per Opportunity, rather than repeating it on every
   * milestone row and cluttering the timeline (Task Contract: "全milestone
   * rowに同じ大量controlを置いて timelineを著しく読みにくくしない"). */
  isFirstRowForOpportunity: boolean;
}

/**
 * Builds the flattened, globally chronologically-sorted timeline row list.
 * `eventsById`/`occurrencesById` must be looked up by the caller from the
 * Event Catalog's own typed read boundary (getEventsByIds/getOccurrencesByIds
 * in src/infrastructure/supabase/eventCatalogRead.ts) - this function does
 * not read Supabase itself.
 *
 * An Opportunity whose Event cannot be found (should not happen under normal
 * operation, since the caller derives eventIds from these same Opportunities)
 * is dropped entirely rather than rendered with fabricated Event data, same
 * defensive-skip precedent as domain/eventCatalog.ts's groupOccurrencesByEvent.
 * A `selected_occurrences` target id that isn't found is dropped from that
 * row's targetOccurrences list, not fabricated.
 */
export function buildTicketOpportunityTimelineRows(
  details: readonly TicketOpportunityWithDetails[],
  eventsById: ReadonlyMap<string, EventCatalogEvent>,
  occurrencesById: ReadonlyMap<string, EventOccurrence>,
): TicketOpportunityTimelineRow[] {
  const unsorted: TicketOpportunityTimelineRow[] = [];

  for (const detail of details) {
    const event = eventsById.get(detail.opportunity.eventId);
    if (event === undefined) {
      continue;
    }
    const targetOccurrences = sortOccurrences(
      detail.targetOccurrenceIds
        .map((occurrenceId) => occurrencesById.get(occurrenceId))
        .filter((occurrence): occurrence is EventOccurrence => occurrence !== undefined),
    );
    const myState = detail.myState?.status ?? null;

    for (const milestone of detail.milestones) {
      unsorted.push({
        id: milestone.id,
        opportunityId: detail.opportunity.id,
        sortInstant: ticketOpportunityMilestoneSortInstant(milestone),
        eventTitle: event.title,
        eventVenue: event.venue,
        opportunityDisplayName: detail.opportunity.displayName,
        sourceUrl: detail.opportunity.sourceUrl,
        targetScope: detail.opportunity.targetScope,
        targetOccurrences,
        milestoneType: milestone.milestoneType,
        temporalPrecision: milestone.temporalPrecision,
        dateValue: milestone.dateValue,
        at: milestone.at,
        startsAt: milestone.startsAt,
        endsAt: milestone.endsAt,
        myState,
        isFirstRowForOpportunity: false,
      });
    }
  }

  const sorted = [...unsorted].sort((a, b) => compareByFieldThenId(a, b, (row) => row.sortInstant));

  // Each Opportunity's own rows form a monotonic subsequence of `sorted` (its
  // milestones were themselves inserted in chronological order above, and a
  // stable global chronological sort preserves that relative order) - so the
  // first time an opportunityId is encountered while scanning `sorted` is
  // exactly its chronologically-earliest row.
  const seenOpportunityIds = new Set<string>();
  return sorted.map((row) => {
    if (seenOpportunityIds.has(row.opportunityId)) {
      return row;
    }
    seenOpportunityIds.add(row.opportunityId);
    return { ...row, isFirstRowForOpportunity: true };
  });
}

export interface TicketOpportunityTimelineMonthGroup {
  /** "YYYY-MM", Asia/Tokyo. */
  monthKey: string;
  rows: TicketOpportunityTimelineRow[];
}

/**
 * Groups already chronologically-sorted rows into contiguous month buckets,
 * preserving row order within each. The month key is derived from each row's
 * sortInstant - an ordering-only value (see its own header), safe to reuse
 * here since only the *month* is read out of it, never a specific day/time
 * displayed to the user.
 */
export function groupTicketOpportunityTimelineRowsByMonth(
  rows: readonly TicketOpportunityTimelineRow[],
): TicketOpportunityTimelineMonthGroup[] {
  const groups: TicketOpportunityTimelineMonthGroup[] = [];
  for (const row of rows) {
    const monthKey = tokyoCalendarDateFromInstant(row.sortInstant).slice(0, 7);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup !== undefined && lastGroup.monthKey === monthKey) {
      lastGroup.rows.push(row);
    } else {
      groups.push({ monthKey, rows: [row] });
    }
  }
  return groups;
}
