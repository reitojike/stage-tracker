import { dateUtcRoundTripMs } from '../time/dateUtcRoundTrip';
import { compareInstants, isInstantBefore, type Instant } from '../time/instant';
import { compareTokyoCalendarDates, type TokyoCalendarDate } from '../time/tokyoCalendarDate';
import { instantToTokyoCalendarDate, tokyoCalendarDayRangeUtc } from '../time/tokyoConversion';
import type { TicketOpportunityId } from './ids';
import type { TicketOpportunityMilestone } from './ticketOpportunityMilestone';
import type { UserTicketOpportunityStatus } from './ticketOpportunity';
import type { EventId } from '../ids';

/**
 * TicketOpportunity timeline calculation (docs/v2/decisions.md A17: "ルール
 * 自体は忠実に再現しつつ、実装は最初から1つの設計として書き直す").
 *
 * This is a from-scratch design, not a port of the pre-v2 implementation
 * (`apps/legacy-web/src/domain/ticketOpportunityTimeline.ts`, kept only as
 * the oracle for behavior). The rules it reproduces
 * (docs/v2/oracle-domain.md §2.7, §2.9's month grouping) are:
 *
 * 1. Flatten every Opportunity's every milestone into one chronological
 *    "1 milestone = 1 row" list (never grouped by type - an
 *    application_open for one Opportunity can sit next to a
 *    result_announcement for another).
 * 2. From that full timeline, select at most one *primary* row per
 *    Opportunity: its chronologically-earliest non-past milestone, or - if
 *    every milestone is already past - its final milestone, but only while
 *    still within a bounded "post-final retention" window
 *    (`TICKET_POST_FINAL_RETENTION_DAYS`, 7 days after that milestone's own
 *    final day, inclusive).
 * 3. Group the selected primary rows into contiguous Asia/Tokyo month
 *    buckets.
 *
 * A structural difference from the pre-v2 implementation, enabled by this
 * package's discriminated-union `TicketOpportunityMilestone`
 * (./ticketOpportunityMilestone.ts): the pre-v2 code needed an explicit
 * `at` > `endsAt` > `startsAt` > `dateValue` *priority order* to find "the
 * date a milestone concerns", because all four fields lived as nullable
 * siblings on one flat row shape. Here, each `temporalPrecision` variant
 * carries exactly one relevant temporal field, so deriving that date is a
 * plain three-way switch with no priority chain to get wrong (see
 * `ticketOpportunityMilestoneTokyoCalendarDate` below) - one concrete
 * payoff of the schema redesign in ./ticketOpportunityMilestone.ts.
 *
 * This module never consults cancellation
 * (../ticketOpportunityCancellation.ts's isTicketOpportunityEffectivelyCanceled):
 * a canceled Opportunity's own surfaced row (current/next, or retained
 * post-final history) still needs to render - callers layer the terminal
 * "中止" presentation on top, they don't ask this module to suppress rows
 * over it (docs/v2/oracle-domain.md §2.7's own note that cancellation and
 * post-final retention are independent).
 */

/** Issue #192's bounded post-final retention window, in Asia/Tokyo calendar
 * days after an Opportunity's own final milestone's final day (inclusive of
 * that boundary day itself) - AGENTS.md/oracle-domain.md §2.7
 * "TICKET_POST_FINAL_RETENTION_DAYS = 7". */
export const TICKET_POST_FINAL_RETENTION_DAYS = 7;

/**
 * The instant a milestone sorts by - ordering-only, never a display value
 * (a `date`-precision milestone's synthetic day-start instant must never be
 * presented as if it were a known time of day). Uses the Asia/Tokyo
 * calendar day's own start-of-day UTC instant (via `tokyoCalendarDayRangeUtc`,
 * ../time/tokyoConversion.ts) for a `date`-precision milestone, rather than
 * a raw UTC midnight of the date string - so a date-only milestone sorts as
 * "the start of that day in Tokyo", not "9 hours into that day in Tokyo".
 */
export function ticketOpportunityMilestoneSortInstant(
  milestone: TicketOpportunityMilestone,
): Instant {
  switch (milestone.temporalPrecision) {
    case 'datetime':
      return milestone.at;
    case 'window':
      return milestone.startsAt;
    case 'date':
      return tokyoCalendarDayRangeUtc(milestone.dateValue).startInstant;
  }
}

/**
 * The Asia/Tokyo calendar date a milestone concerns (for past/retention
 * logic only - never rendered directly, same discipline as
 * `ticketOpportunityMilestoneSortInstant`). Because each `temporalPrecision`
 * variant carries exactly one relevant field, this is a direct per-variant
 * read, not a priority fallback chain: `date` -> its own `dateValue`;
 * `datetime` -> the Tokyo calendar date of `at`; `window` -> the Tokyo
 * calendar date of `endsAt` (a window's *end* is what "concerns" a deadline
 * - e.g. an application_close can legitimately be window-precision, and
 * `startsAt` alone would read the window's *open* as the deadline).
 */
export function ticketOpportunityMilestoneTokyoCalendarDate(
  milestone: TicketOpportunityMilestone,
): TokyoCalendarDate {
  switch (milestone.temporalPrecision) {
    case 'date':
      return milestone.dateValue;
    case 'datetime':
      return instantToTokyoCalendarDate(milestone.at);
    case 'window':
      return instantToTokyoCalendarDate(milestone.endsAt);
  }
}

/**
 * Precision-specific past/non-past determination (docs/v2/oracle-domain.md
 * §2.7): a `date` milestone stays non-past for the entirety of its own
 * Tokyo calendar day (only the day after it is past); a `datetime`
 * milestone is past once its exact instant has elapsed; a `window`
 * milestone is past only once its `endsAt` has elapsed - an active window
 * stays non-past for its whole span, never fast-forwarding to the next
 * milestone merely because `startsAt` has passed.
 */
export function isTicketOpportunityMilestonePast(
  milestone: TicketOpportunityMilestone,
  nowInstant: Instant,
  todayTokyoDate: TokyoCalendarDate,
): boolean {
  switch (milestone.temporalPrecision) {
    case 'date':
      return compareTokyoCalendarDates(milestone.dateValue, todayTokyoDate) < 0;
    case 'datetime':
      return isInstantBefore(milestone.at, nowInstant);
    case 'window':
      return isInstantBefore(milestone.endsAt, nowInstant);
  }
}

/** Whole Tokyo-calendar-day difference (`to` - `from`), by plain calendar
 * arithmetic - reuses the same `dateUtcRoundTripMs` UTC-field trick every
 * other calendar computation in this package uses (../time/tokyoConversion.ts),
 * since both dates are already-validated `TokyoCalendarDate`s. */
function tokyoCalendarDateDiffDays(from: TokyoCalendarDate, to: TokyoCalendarDate): number {
  const fromMs = tokyoCalendarDateToUtcFieldMs(from);
  const toMs = tokyoCalendarDateToUtcFieldMs(to);
  return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
}

const TOKYO_CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

function tokyoCalendarDateToUtcFieldMs(date: TokyoCalendarDate): number {
  const match = TOKYO_CALENDAR_DATE_PATTERN.exec(date);
  if (match === null) {
    throw new Error(
      'unreachable: TokyoCalendarDate is guaranteed valid by tokyoCalendarDateSchema',
    );
  }
  const [, yearStr, monthStr, dayStr] = match;
  if (yearStr === undefined || monthStr === undefined || dayStr === undefined) {
    throw new Error(
      'unreachable: TokyoCalendarDate is guaranteed valid by tokyoCalendarDateSchema',
    );
  }
  const ms = dateUtcRoundTripMs({
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  if (ms === null) {
    throw new Error(
      'unreachable: TokyoCalendarDate is guaranteed valid by tokyoCalendarDateSchema',
    );
  }
  return ms;
}

/**
 * Whether an Opportunity's own chronologically-final milestone - which the
 * caller has already confirmed is past (see `selectTicketOpportunityPrimaryRows`,
 * the only caller) - still falls within the bounded post-final retention
 * window: `TICKET_POST_FINAL_RETENTION_DAYS` Asia/Tokyo calendar days after
 * that milestone's own final day, inclusive of the boundary day itself (day
 * 7 still retained, day 8 dropped).
 */
export function isTicketOpportunityPostFinalRetained(
  finalMilestone: TicketOpportunityMilestone,
  todayTokyoDate: TokyoCalendarDate,
): boolean {
  const finalDay = ticketOpportunityMilestoneTokyoCalendarDate(finalMilestone);
  const daysSinceFinal = tokyoCalendarDateDiffDays(finalDay, todayTokyoDate);
  return daysSinceFinal <= TICKET_POST_FINAL_RETENTION_DAYS;
}

/** One Opportunity's full milestone set plus the caller's own personal
 * planning state for it - the minimal input `buildTicketOpportunityTimelineRows`
 * needs. A missing milestone (one the source never gave) is represented by
 * its absence from `milestones`, never a placeholder entry. */
export interface TicketOpportunityAggregate {
  readonly opportunityId: TicketOpportunityId;
  readonly eventId: EventId;
  readonly milestones: readonly TicketOpportunityMilestone[];
  readonly myState: UserTicketOpportunityStatus | null;
}

export interface TicketOpportunityTimelineRow {
  readonly opportunityId: TicketOpportunityId;
  readonly eventId: EventId;
  readonly milestone: TicketOpportunityMilestone;
  readonly sortInstant: Instant;
  /** The caller's own planning state for this row's Opportunity - identical
   * across every row of the same Opportunity, since it comes from the same
   * single per-Opportunity `myState`. */
  readonly myState: UserTicketOpportunityStatus | null;
  /** True for exactly the chronologically-earliest row of this Opportunity
   * among the rows returned by the same call - lets a caller place a
   * once-per-Opportunity control (e.g. the personal-state mutation UI) on
   * only one row. */
  readonly isFirstRowForOpportunity: boolean;
  /** True only for a row `selectTicketOpportunityPrimaryRows` synthesizes as
   * bounded post-final terminal history - always false on every row
   * `buildTicketOpportunityTimelineRows` itself produces (that function has
   * no notion of "today"). */
  readonly isPostFinalRetainedHistory: boolean;
}

function compareTimelineRowsChronologically(
  a: TicketOpportunityTimelineRow,
  b: TicketOpportunityTimelineRow,
): number {
  const instantComparison = compareInstants(a.sortInstant, b.sortInstant);
  if (instantComparison !== 0) {
    return instantComparison;
  }
  if (a.milestone.id === b.milestone.id) {
    return 0;
  }
  return a.milestone.id < b.milestone.id ? -1 : 1;
}

function sortTimelineRowsChronologically(
  rows: readonly TicketOpportunityTimelineRow[],
): TicketOpportunityTimelineRow[] {
  return [...rows].sort(compareTimelineRowsChronologically);
}

/**
 * Builds the flattened, globally chronologically-sorted timeline row list -
 * every Opportunity's every milestone, one row each, sorted ascending by
 * `sortInstant` with the milestone id as a stable tie-breaker.
 *
 * `isFirstRowForOpportunity` is derived by scanning the fully-sorted list
 * once and marking the first row encountered per `opportunityId`: because
 * `sorted` is globally sorted ascending, any subsequence of it restricted to
 * one `opportunityId` is itself sorted ascending (a property of filtering a
 * sorted sequence, independent of the original insertion order) - so "first
 * encountered while scanning `sorted`" is exactly that Opportunity's
 * chronologically-earliest row.
 */
export function buildTicketOpportunityTimelineRows(
  aggregates: readonly TicketOpportunityAggregate[],
): TicketOpportunityTimelineRow[] {
  const unsorted: TicketOpportunityTimelineRow[] = [];

  for (const aggregate of aggregates) {
    for (const milestone of aggregate.milestones) {
      unsorted.push({
        opportunityId: aggregate.opportunityId,
        eventId: aggregate.eventId,
        milestone,
        sortInstant: ticketOpportunityMilestoneSortInstant(milestone),
        myState: aggregate.myState,
        isFirstRowForOpportunity: false,
        isPostFinalRetainedHistory: false,
      });
    }
  }

  const sorted = sortTimelineRowsChronologically(unsorted);

  const seenOpportunityIds = new Set<TicketOpportunityId>();
  return sorted.map((row) => {
    if (seenOpportunityIds.has(row.opportunityId)) {
      return row;
    }
    seenOpportunityIds.add(row.opportunityId);
    return { ...row, isFirstRowForOpportunity: true };
  });
}

/**
 * From the full chronological timeline (`buildTicketOpportunityTimelineRows`'s
 * output), selects at most one row per Opportunity:
 *
 * - its chronologically-earliest non-past row, if it has one; otherwise
 * - its chronologically-final row (by `ticketOpportunityMilestoneTokyoCalendarDate`,
 *   NOT by `sortInstant` - see below), but only while
 *   `isTicketOpportunityPostFinalRetained` still holds for it.
 *
 * `rows` MUST already be in the chronologically-sorted order
 * `buildTicketOpportunityTimelineRows` produces. A single left-to-right scan
 * keeps the first non-past row per `opportunityId` (exactly that
 * Opportunity's earliest current/next milestone, by the same
 * sorted-subsequence argument as `buildTicketOpportunityTimelineRows`'s own
 * header) and, in the same pass, tracks each Opportunity's *final* row by
 * `ticketOpportunityMilestoneTokyoCalendarDate` rather than by `sortInstant`:
 * a `window`-precision milestone sorts by its own `startsAt`
 * (`ticketOpportunityMilestoneSortInstant`), so a window whose real end is
 * later than a later-*sorting* `datetime`/`date` milestone would be wrongly
 * passed over as "not the final one" by a naive "last-scanned row" scan.
 * Ties (same final day) keep the later-scanned row.
 *
 * A second pass then adds bounded post-final retained history for any
 * Opportunity that never got a current/next row: if every one of its
 * milestones is past (otherwise it would already be selected above), its
 * tracked final row is retained exactly while
 * `isTicketOpportunityPostFinalRetained` holds. This never consults
 * cancellation - see this module's own header.
 *
 * A current/next row and a retained-history row can never coexist for the
 * same Opportunity (the second pass only runs for Opportunities the first
 * pass did not already select), so the combined result is re-sorted
 * chronologically before returning, ready to feed straight into
 * `groupTicketOpportunityTimelineRowsByMonth`.
 */
export function selectTicketOpportunityPrimaryRows(
  rows: readonly TicketOpportunityTimelineRow[],
  nowInstant: Instant,
  todayTokyoDate: TokyoCalendarDate,
): TicketOpportunityTimelineRow[] {
  const selected: TicketOpportunityTimelineRow[] = [];
  const selectedOpportunityIds = new Set<TicketOpportunityId>();
  const finalRowByOpportunityId = new Map<TicketOpportunityId, TicketOpportunityTimelineRow>();

  for (const row of rows) {
    const existingFinalRow = finalRowByOpportunityId.get(row.opportunityId);
    if (
      existingFinalRow === undefined ||
      compareTokyoCalendarDates(
        ticketOpportunityMilestoneTokyoCalendarDate(row.milestone),
        ticketOpportunityMilestoneTokyoCalendarDate(existingFinalRow.milestone),
      ) >= 0
    ) {
      finalRowByOpportunityId.set(row.opportunityId, row);
    }

    if (selectedOpportunityIds.has(row.opportunityId)) {
      continue;
    }
    if (isTicketOpportunityMilestonePast(row.milestone, nowInstant, todayTokyoDate)) {
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
    // finalRow - drawn from that same all-past set - is itself confirmed
    // past here.
    if (isTicketOpportunityPostFinalRetained(finalRow.milestone, todayTokyoDate)) {
      selected.push({
        ...finalRow,
        isFirstRowForOpportunity: true,
        isPostFinalRetainedHistory: true,
      });
    }
  }

  return sortTimelineRowsChronologically(selected);
}

export interface TicketOpportunityTimelineMonthGroup {
  /** "YYYY-MM", Asia/Tokyo. */
  readonly monthKey: string;
  readonly rows: readonly TicketOpportunityTimelineRow[];
}

/**
 * Groups already chronologically-sorted rows into contiguous month buckets,
 * preserving row order within each. The month key is derived from each
 * row's `sortInstant` - an ordering-only value (see its own header), safe
 * to reuse here since only the *month* is read out of it, never a specific
 * day/time displayed to the user.
 */
export function groupTicketOpportunityTimelineRowsByMonth(
  rows: readonly TicketOpportunityTimelineRow[],
): TicketOpportunityTimelineMonthGroup[] {
  const groups: { monthKey: string; rows: TicketOpportunityTimelineRow[] }[] = [];
  for (const row of rows) {
    const monthKey = instantToTokyoCalendarDate(row.sortInstant).slice(0, 7);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup !== undefined && lastGroup.monthKey === monthKey) {
      lastGroup.rows.push(row);
    } else {
      groups.push({ monthKey, rows: [row] });
    }
  }
  return groups;
}
