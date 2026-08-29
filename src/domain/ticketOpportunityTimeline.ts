import type { EventCatalogEvent, EventOccurrence } from './eventCatalog.ts';
import { sortOccurrences, tokyoCalendarDateFromInstant } from './eventCatalog.ts';
import { isEventCanceled } from './eventCancellation.ts';
import { compareByFieldThenId, sortByFieldThenId } from './ordering.ts';
import { ticketOpportunityMilestoneTokyoCalendarDate } from './ticketOpportunityFormatting.ts';
import type {
  TicketOpportunityMilestoneTemporalPrecision,
  TicketOpportunityMilestoneType,
  TicketOpportunityTargetScope,
  TicketOpportunityWithDetails,
  UserTicketOpportunityStatus,
} from './ticketOpportunity.ts';
import { ticketOpportunityMilestoneSortInstant } from './ticketOpportunity.ts';
import { isOnOrBeforeDaysAhead, TICKET_POST_FINAL_RETENTION_DAYS } from './visibleWindow.ts';

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
  /** The parent Event's own id (Issue #197: the row's whole-row link target,
   * `/catalog/events/[eventId]`) - the Event Catalog's own identifier, not
   * this Opportunity's id. */
  eventId: string;
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
  /** True only for a row selectTicketOpportunityPrimaryRows synthesizes as
   * bounded post-final terminal history (Issue #192) - this Opportunity's
   * last milestone is itself past, and today is still within
   * TICKET_POST_FINAL_RETENTION_DAYS of that milestone's own final day.
   * Always false on every row buildTicketOpportunityTimelineRows itself
   * produces (that function has no notion of "today"); the /tickets
   * presentation layer (TicketOpportunityRow.tsx) uses this to show the
   * TURN 12 terminal `受付終了` vocabulary, deferring to the existing
   * whole-Opportunity `中止` vocabulary when isTicketOpportunityRowEffectivelyCanceled
   * is also true (Task Contract: "Retained rowはcurrent cancellation
   * terminal `中止`を上書きしない"). */
  isPostFinalRetainedHistory: boolean;
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
        eventId: event.id,
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
        isPostFinalRetainedHistory: false,
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
 * Whether an Opportunity's own chronologically-last row - already
 * confirmed past by the caller (see selectTicketOpportunityPrimaryRows) -
 * still falls within the Issue #192 bounded post-final retention window:
 * TICKET_POST_FINAL_RETENTION_DAYS Asia/Tokyo calendar days after that
 * milestone's own final day, inclusive of the boundary day itself (day 7
 * still retained, day 8 dropped - Task Contract: "最後のマイルストーンも
 * 過ぎたものは、その日から7日だけ残す").
 *
 * Reuses ticketOpportunityFormatting.ts's own
 * ticketOpportunityMilestoneTokyoCalendarDate for "the final day" so this
 * matches the exact same date/datetime/window precision priority Home's
 * deadline projection already relies on (at > window end > start > bare
 * date) - not a second, possibly-diverging date derivation.
 */
export function isTicketOpportunityPostFinalRetained(
  finalRow: Pick<TicketOpportunityTimelineRow, 'dateValue' | 'at' | 'startsAt' | 'endsAt'>,
  todayTokyoDate: string,
): boolean {
  const finalDay = ticketOpportunityMilestoneTokyoCalendarDate(finalRow);
  return isOnOrBeforeDaysAhead(todayTokyoDate, finalDay, TICKET_POST_FINAL_RETENTION_DAYS);
}

/**
 * The /tickets primary-view projection (Issue #175, bounded post-final
 * retention supersede by Issue #192): from the full #144
 * chronological timeline (buildTicketOpportunityTimelineRows's output -
 * every Opportunity's every milestone), select at most one row per
 * Opportunity.
 *
 * `rows` MUST already be in the globally chronologically-sorted order
 * buildTicketOpportunityTimelineRows produces. Each Opportunity's own rows
 * form a monotonic (chronologically ascending) subsequence of that order
 * (see that function's own header), so a single left-to-right scan that
 * keeps the first non-past row encountered per opportunityId is exactly
 * that Opportunity's earliest non-past (current-or-next) milestone - no
 * separate per-Opportunity re-sort needed for that part. The same scan also
 * records each Opportunity's chronologically-*last* row (last-write-wins
 * over the same monotonic subsequence), which is what a second pass uses to
 * decide bounded post-final retention for any Opportunity that never got a
 * current/next row.
 *
 * An Opportunity with zero non-past milestones no longer disappears
 * immediately (Issue #175's original rule): if today is still within
 * TICKET_POST_FINAL_RETENTION_DAYS of that Opportunity's own final
 * milestone's final day (see isTicketOpportunityPostFinalRetained), that
 * final row is kept as bounded terminal history
 * (isPostFinalRetainedHistory: true); past the retention window, it drops
 * entirely, exactly as #175 did (Task Contract: "7日を過ぎたら一覧から
 * 落とす"). Neither path consults cancellation
 * (isTicketOpportunityRowEffectivelyCanceled, ticketOpportunityFormatting.ts)
 * - a canceled Opportunity's own surfaced row (current/next or retained)
 * still renders its terminal 中止 presentation, which the presentation layer
 * (TicketOpportunityRow.tsx) prefers over 受付終了 when both are true (Task
 * Contract: "Retained rowはcurrent cancellation terminal `中止`を上書き
 * しない"), per #172's "canceledだから personal stateやrow自体を消さない"
 * boundary.
 *
 * Because a current/next row and a retained-history row can never coexist
 * for the same Opportunity (the second pass only runs for Opportunities the
 * first pass didn't already select), and both scans preserve each
 * Opportunity's own row content otherwise unchanged, the combined result is
 * re-sorted chronologically (same comparator buildTicketOpportunityTimelineRows
 * itself uses) before returning - retained-history rows sort by their own
 * (past) sortInstant, ahead of any current/future row, ready to feed
 * straight into groupTicketOpportunityTimelineRowsByMonth (Task Contract:
 * "選択済みrowだけをglobal chronology/month groupingへ流す").
 *
 * The selected row's isFirstRowForOpportunity is forced true in both paths:
 * by construction at most one row survives per Opportunity here, so it is
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
  const finalRowByOpportunityId = new Map<string, TicketOpportunityTimelineRow>();

  for (const row of rows) {
    // Tracks the row with the LATEST final day (ticketOpportunityMilestoneTokyoCalendarDate)
    // seen so far for this Opportunity - deliberately not "the last row this
    // scan happens to visit". `rows` is sorted by sortInstant, and
    // ticketOpportunityMilestoneSortInstant orders a window-precision
    // milestone by its *start*, never its endsAt (see that function's own
    // header) - so a window milestone whose real end is later than a
    // later-sorting datetime/date milestone would otherwise be wrongly
    // passed over as "not the final one" if this just kept the
    // last-scanned row. Ties (same final day) keep the later-scanned row
    // via `>=`, which is the closer-to-true-last choice within a single
    // day, though the exact tie-break has no product-visible effect.
    const existingFinalRow = finalRowByOpportunityId.get(row.opportunityId);
    if (
      existingFinalRow === undefined ||
      ticketOpportunityMilestoneTokyoCalendarDate(row) >=
        ticketOpportunityMilestoneTokyoCalendarDate(existingFinalRow)
    ) {
      finalRowByOpportunityId.set(row.opportunityId, row);
    }

    if (selectedOpportunityIds.has(row.opportunityId)) {
      continue;
    }
    if (isTicketOpportunityTimelineRowPast(row, nowInstant, todayTokyoDate)) {
      continue;
    }
    selectedOpportunityIds.add(row.opportunityId);
    selected.push({ ...row, isFirstRowForOpportunity: true, isPostFinalRetainedHistory: false });
  }

  for (const [opportunityId, finalRow] of finalRowByOpportunityId) {
    if (selectedOpportunityIds.has(opportunityId)) {
      continue;
    }
    // Every row of this Opportunity failed the non-past check above
    // (otherwise selectedOpportunityIds would already contain it), so
    // finalRow - drawn from that same all-past row set - is itself
    // confirmed past here, regardless of which one has the latest final
    // day among them.
    if (isTicketOpportunityPostFinalRetained(finalRow, todayTokyoDate)) {
      selected.push({
        ...finalRow,
        isFirstRowForOpportunity: true,
        isPostFinalRetainedHistory: true,
      });
    }
  }

  return sortByFieldThenId(selected, (row) => row.sortInstant);
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
