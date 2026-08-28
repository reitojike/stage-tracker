import type { EventCatalogEvent, EventOccurrence } from './eventCatalog.ts';
import { sortOccurrences, tokyoCalendarDateFromInstant } from './eventCatalog.ts';
import { isEventCanceled } from './eventCancellation.ts';
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
  /** The parent Event's own effective cancellation (Issue #172 root cause
   * B / Claude C1 + Codex X2): Event-level cancellation alone already
   * makes the whole Opportunity terminal regardless of targetScope - see
   * ticketOpportunityFormatting.ts's isTicketOpportunityRowEffectivelyCanceled,
   * the single place this and targetOccurrences' own canceledAt are
   * combined into the Opportunity-scope aggregation rule. */
  eventCanceled: boolean;
  opportunityDisplayName: string;
  sourceUrl: string | null;
  targetScope: TicketOpportunityTargetScope;
  /** Only non-empty for a `selected_occurrences` Opportunity - empty for
   * `event_wide` by construction (mirrors TicketOpportunityWithDetails's own
   * targetOccurrenceIds convention, see domain/ticketOpportunity.ts). Sorted
   * chronologically, same as every other occurrence list in this product.
   * Each occurrence's own canceledAt is preserved as-is (not collapsed) so
   * the Opportunity-scope aggregation rule can tell "all targets canceled"
   * from "some targets canceled" from "target set unresolved/empty".
   * May be SHORTER than targetOccurrenceIdCount below when one or more
   * target ids failed to resolve (dropped, not fabricated - see this
   * module's own header) - callers must not treat that as "all resolved
   * targets are canceled" without also checking completeness via
   * targetOccurrenceIdCount (Issue #172 root cause B closure finding:
   * partial target-resolution loss must never produce a false
   * whole-Opportunity terminal state). */
  targetOccurrences: EventOccurrence[];
  /** `detail.targetOccurrenceIds.length` - the full requested target count,
   * independent of how many of those ids actually resolved into
   * `targetOccurrences` above. Always 0 for `event_wide` (by construction).
   * Exists solely so isTicketOpportunityRowEffectivelyCanceled
   * (ticketOpportunityFormatting.ts) can require
   * `targetOccurrences.length === targetOccurrenceIdCount` (a complete
   * resolution) before applying the "every target canceled" rule - an
   * incomplete resolution must never be read as "all canceled". */
  targetOccurrenceIdCount: number;
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
        eventCanceled: isEventCanceled(event),
        opportunityDisplayName: detail.opportunity.displayName,
        sourceUrl: detail.opportunity.sourceUrl,
        targetScope: detail.opportunity.targetScope,
        targetOccurrences,
        targetOccurrenceIdCount: detail.targetOccurrenceIds.length,
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

/**
 * Precision-specific past/non-past determination for one row (Issue #175
 * Task Contract). Deliberately does NOT reuse
 * ticketOpportunityMilestoneSortInstant (domain/ticketOpportunity.ts) as a
 * past-判定 authority - that helper is explicitly ordering-only (see its own
 * header: a `date` milestone's synthetic start-of-day-UTC sort value would
 * make "past" flip at the wrong moment relative to Asia/Tokyo's own calendar
 * day boundary). Each temporalPrecision instead compares against the
 * semantically-correct reference:
 *
 * - `date`: Asia/Tokyo calendar date comparison against `todayTokyoDate` -
 *   the milestone's own day is still non-past (current), only the day AFTER
 *   it is past.
 * - `datetime`: exact instant comparison against `nowInstant` - past the
 *   moment `at` has elapsed.
 * - `window`: past only once `endsAt` has elapsed - `startsAt` alone never
 *   makes a window past (an active window stays non-past/current for its
 *   whole span, matching the Task Contract's "active windowがある間は後続
 *   milestoneへ早送りしない").
 *
 * `nowInstant` and a persisted `at`/`endsAt` can differ in offset notation/
 * fractional-second precision (a client-computed `.toISOString()` vs a raw
 * PostgREST timestamptz string) - see domain/ordering.ts's own caution on
 * this - so instant comparisons go through Date.parse rather than a raw
 * string compare, mirroring domain/homeUpcoming.ts's isAtOrAfter.
 */
export function isTicketOpportunityTimelineRowPast(
  row: Pick<TicketOpportunityTimelineRow, 'temporalPrecision' | 'dateValue' | 'at' | 'endsAt'>,
  nowInstant: string,
  todayTokyoDate: string,
): boolean {
  if (row.temporalPrecision === 'date') {
    if (row.dateValue === null) {
      throw new Error('a date-precision milestone must carry dateValue');
    }
    return row.dateValue < todayTokyoDate;
  }
  if (row.temporalPrecision === 'datetime') {
    if (row.at === null) {
      throw new Error('a datetime-precision milestone must carry at');
    }
    return Date.parse(row.at) < Date.parse(nowInstant);
  }
  if (row.endsAt === null) {
    throw new Error('a window-precision milestone must carry endsAt');
  }
  return Date.parse(row.endsAt) < Date.parse(nowInstant);
}

/**
 * The /tickets primary-view projection (Issue #175): from the full #144
 * chronological timeline (buildTicketOpportunityTimelineRows's output -
 * every Opportunity's every milestone), select at most one row per
 * Opportunity - its current-or-next (earliest non-past) milestone.
 *
 * `rows` MUST already be in the globally chronologically-sorted order
 * buildTicketOpportunityTimelineRows produces. Each Opportunity's own rows
 * form a monotonic (chronologically ascending) subsequence of that order
 * (see that function's own header), so a single left-to-right scan that
 * keeps the first non-past row encountered per opportunityId is exactly
 * that Opportunity's earliest non-past milestone - no separate per-
 * Opportunity re-sort needed. The output list's relative order is therefore
 * already chronological, ready to feed straight into
 * groupTicketOpportunityTimelineRowsByMonth (Task Contract: "選択済みrowだけを
 * global chronology/month groupingへ流す").
 *
 * An Opportunity with zero non-past milestones contributes no row at all -
 * it disappears from the primary view (Task Contract: "non-past milestoneが
 * 1件も残っていないOpportunityはprimary viewに表示しない"). This is a pure
 * past/non-past filter: it does not consult cancellation
 * (isTicketOpportunityRowEffectivelyCanceled, ticketOpportunityFormatting.ts)
 * - a canceled Opportunity's own non-past milestone still surfaces here, and
 * continues to render its terminal 中止 presentation exactly as before (see
 * that helper and TicketOpportunityRow.tsx), per #172's "canceledだから
 * personal stateやrow自体を消さない" boundary.
 *
 * The selected row's isFirstRowForOpportunity is forced true: by
 * construction at most one row survives per Opportunity here, so it is
 * always the (only, hence first) row the UI should attach the personal
 * `planned`/`applied` state control to (TicketOpportunityRow.tsx).
 */
export function selectTicketOpportunityPrimaryRows(
  rows: readonly TicketOpportunityTimelineRow[],
  nowInstant: string,
  todayTokyoDate: string,
): TicketOpportunityTimelineRow[] {
  const selected: TicketOpportunityTimelineRow[] = [];
  const selectedOpportunityIds = new Set<string>();
  for (const row of rows) {
    if (selectedOpportunityIds.has(row.opportunityId)) {
      continue;
    }
    if (isTicketOpportunityTimelineRowPast(row, nowInstant, todayTokyoDate)) {
      continue;
    }
    selectedOpportunityIds.add(row.opportunityId);
    selected.push({ ...row, isFirstRowForOpportunity: true });
  }
  return selected;
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
