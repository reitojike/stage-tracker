import { parseTokyoCalendarDate, tokyoCalendarDateFromInstant } from './eventCatalog.ts';
import { tokyoTimeLabel } from './catalogFormatting.ts';
import { isOccurrenceCanceled } from './eventCancellation.ts';
import {
  calendarDateAccessibleWeekdayLabel,
  calendarDateWeekdayLabel,
  calendarDayRole,
  type CalendarDayRole,
} from './calendarDayRole.ts';
import type {
  TicketOpportunityMilestoneType,
  UserTicketOpportunityStatus,
} from './ticketOpportunity.ts';
import type { TicketOpportunityTimelineRow } from './ticketOpportunityTimeline.ts';

// Pure Asia/Tokyo display formatting for the Ticket planning timeline
// (/tickets, Issue #144). Mirrors catalogFormatting.ts's own "never fabricate
// a value the source didn't provide" discipline: a milestone's
// temporalPrecision ('date' / 'datetime' / 'window') is preserved into the
// exact label shown, never flattened into a fake time (product-rules.md
// "Ticket Opportunity（Ticket planning MVP）" / Issue #144 canonical Task
// Contract).

/** Canonical milestone vocabulary (#162 / #144 Task Contract). */
export function ticketOpportunityMilestoneTypeLabel(type: TicketOpportunityMilestoneType): string {
  switch (type) {
    case 'application_open':
      return '申込開始';
    case 'application_close':
      return '申込締切';
    case 'result_announcement':
      return '結果発表';
    case 'sale_start':
      return '販売開始';
    case 'payment_window':
      return '入金期間';
  }
}

export function ticketOpportunityStateLabel(status: UserTicketOpportunityStatus): string {
  return status === 'applied' ? '申し込み済み' : '申し込む予定';
}

/** Issue #197 (supersedes #138's undifferentiated mapping now that Issue
 * #186 gives Badge its own `done` variant): `applied` is a user-completed
 * action ("申し込み済み"), so it maps to `done`; `planned` is still only an
 * intention ("申し込む予定にする"), so it stays `subtle`. */
export function ticketOpportunityStateBadgeVariant(
  status: UserTicketOpportunityStatus,
): 'subtle' | 'done' {
  switch (status) {
    case 'planned':
      return 'subtle';
    case 'applied':
      return 'done';
  }
}

/** "2026年9月" month-separator heading, from a "YYYY-MM" grouping key (see
 * ticketOpportunityTimeline.ts's groupTicketOpportunityTimelineRowsByMonth). */
export function ticketOpportunityTimelineMonthHeadingLabel(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) {
    throw new Error(`expected a "YYYY-MM" month key, got: ${monthKey}`);
  }
  const [, yearStr, monthStr] = match;
  if (yearStr === undefined || monthStr === undefined) {
    throw new Error(`expected a "YYYY-MM" month key, got: ${monthKey}`);
  }
  return `${yearStr}年${String(Number(monthStr))}月`;
}

export interface TicketOpportunityMilestoneDisplay {
  /** e.g. "9月10日（火）", or "9月10日（木） 〜 9月13日（日）" for a window
   * spanning more than one Tokyo calendar day - full-width parentheses, the
   * same shared "M月D日（曜）" label every list-date surface uses (Issue
   * #189, calendarDayRole.ts's calendarDateWeekdayLabel). */
  dateLabel: string;
  /** e.g. "17:00", or "18:00〜23:59" for a same-day window; null for a
   * date-only milestone, since the source gave no time to show. */
  timeLabel: string | null;
  /** The shared calendar day-role (Issue #189) for this milestone's primary
   * displayed date - the window's *start* date for a window-precision
   * milestone, since dateLabel itself is a single row's color. Callers pair
   * this with `@/ui/DayRoleText`, the same shared color authority Home/
   * Catalog/My Calendar use - this module never re-derives its own
   * weekday/holiday judgment or color mapping. */
  role: CalendarDayRole;
  /** The primary displayed date's calendarDateAccessibleWeekdayLabel -
   * identical to dateLabel except for a holiday, when it additionally
   * carries the official holiday name (accessibility baseline: color is
   * never the sole carrier of a holiday's meaning - see calendarDayRole.ts's
   * header). */
  accessibleDateLabel: string;
}

/**
 * Formats one milestone's date/time exactly to its own temporalPrecision -
 * never synthesizing a time a 'date'-precision milestone doesn't have (Issue
 * #144 Task Contract: "絶対にしない: date-only → 00:00表示"). Does not use
 * ticketOpportunityMilestoneSortInstant (domain/ticketOpportunity.ts) - that
 * helper's synthetic midnight is explicitly ordering-only, never a display
 * value (see its own header).
 */
export function formatTicketOpportunityMilestoneDisplay(
  row: Pick<
    TicketOpportunityTimelineRow,
    'temporalPrecision' | 'dateValue' | 'at' | 'startsAt' | 'endsAt'
  >,
): TicketOpportunityMilestoneDisplay {
  if (row.temporalPrecision === 'date') {
    if (row.dateValue === null) {
      throw new Error('a date-precision milestone must carry dateValue');
    }
    return {
      dateLabel: calendarDateWeekdayLabel(row.dateValue),
      timeLabel: null,
      role: calendarDayRole(row.dateValue),
      accessibleDateLabel: calendarDateAccessibleWeekdayLabel(row.dateValue),
    };
  }

  if (row.temporalPrecision === 'datetime') {
    if (row.at === null) {
      throw new Error('a datetime-precision milestone must carry at');
    }
    const tokyoDate = tokyoCalendarDateFromInstant(row.at);
    return {
      dateLabel: calendarDateWeekdayLabel(tokyoDate),
      timeLabel: tokyoTimeLabel(row.at),
      role: calendarDayRole(tokyoDate),
      accessibleDateLabel: calendarDateAccessibleWeekdayLabel(tokyoDate),
    };
  }

  if (row.startsAt === null || row.endsAt === null) {
    throw new Error('a window-precision milestone must carry startsAt and endsAt');
  }
  const startDate = tokyoCalendarDateFromInstant(row.startsAt);
  const endDate = tokyoCalendarDateFromInstant(row.endsAt);
  const startTime = tokyoTimeLabel(row.startsAt);
  const endTime = tokyoTimeLabel(row.endsAt);
  const role = calendarDayRole(startDate);
  const accessibleDateLabel = calendarDateAccessibleWeekdayLabel(startDate);
  if (startDate === endDate) {
    return {
      dateLabel: calendarDateWeekdayLabel(startDate),
      timeLabel: `${startTime}〜${endTime}`,
      role,
      accessibleDateLabel,
    };
  }
  return {
    dateLabel: `${calendarDateWeekdayLabel(startDate)} 〜 ${calendarDateWeekdayLabel(endDate)}`,
    timeLabel: `${startTime} 〜 ${endTime}`,
    role,
    accessibleDateLabel,
  };
}

/**
 * The Asia/Tokyo calendar date a milestone concerns, for internal
 * red/remaining-days logic only - never rendered directly (that would
 * reintroduce the synthetic-midnight-as-display hazard
 * formatTicketOpportunityMilestoneDisplay avoids). Prefers the most precise
 * value available, same priority order as
 * ticketOpportunityMilestoneSortInstant.
 *
 * Exported (not just used internally) so Home's deadline-ordering projection
 * (domain/homeDeadlines.ts, Issue #143) can sort by the same window-end-
 * preferring deadline date this module already uses for actionability/
 * remaining-days, rather than re-deriving it or falling back to
 * ticketOpportunityMilestoneSortInstant's window-*start* ordering (see that
 * function's own header - it is chronological-display ordering, not
 * deadline-date resolution, and using it for deadline sort would rank a
 * window-precision application_close by when the window *opened*, not when
 * it *closes*).
 */
export function ticketOpportunityMilestoneTokyoCalendarDate(
  row: Pick<TicketOpportunityTimelineRow, 'dateValue' | 'at' | 'startsAt' | 'endsAt'>,
): string {
  if (row.at !== null) {
    return tokyoCalendarDateFromInstant(row.at);
  }
  // A window's *end* is the date this concerns for deadline purposes - e.g.
  // an application_close milestone can legitimately be window-precision
  // (nothing in the schema ties milestone_type to temporal_precision; see
  // supabase/migrations/20260828000100_create_ticket_opportunity_milestones.sql).
  // Preferring startsAt here would read the window's *open* as the
  // deadline, escalating "still actionable" to false days before the
  // window actually closes.
  if (row.endsAt !== null) {
    return tokyoCalendarDateFromInstant(row.endsAt);
  }
  if (row.startsAt !== null) {
    return tokyoCalendarDateFromInstant(row.startsAt);
  }
  if (row.dateValue !== null) {
    return row.dateValue;
  }
  throw new Error('a milestone must carry at least one temporal value');
}

/**
 * Opportunity-scope terminal cancellation (Issue #172 root cause B / Claude
 * C1 + Codex X2, adjudicated aggregation rule - deliberately NOT "any one
 * selected target Occurrence is canceled"):
 *
 * 1. The parent Event is canceled -> the whole Opportunity is terminal,
 *    regardless of targetScope.
 * 2. `event_wide` with the Event not canceled -> never terminal from
 *    Occurrence state alone. `event_wide` is a semantic fact about the
 *    whole Event, not a snapshot of whichever Occurrences currently exist
 *    (product-rules.md "Target scope"), so one current Occurrence being
 *    canceled must not cancel the Opportunity.
 * 3. `selected_occurrences` with the Event not canceled -> terminal only
 *    when the target set is *completely resolved* (targetOccurrences.length
 *    === targetOccurrenceIdCount), that resolved set is non-empty, AND
 *    every resolved target Occurrence is canceled. Neither an empty
 *    resolved set nor a *partially* resolved one (e.g. a defensive
 *    missing-read drop for only some ids - see
 *    ticketOpportunityTimeline.ts's own header on
 *    buildTicketOpportunityTimelineRows) may read as "all canceled" -
 *    both are inferring global cancellation from an incomplete/unresolved
 *    target set, which the Issue #172 adjudication explicitly rules out.
 *    Checking length equality (not just non-empty) is what closes this:
 *    a request for 3 targets that resolves only 1 (2 dropped) must not
 *    satisfy `.every(...)` on that 1 alone and falsely go terminal.
 *
 * A partially canceled `selected_occurrences` target (some but not all
 * targets canceled) is NOT terminal here - see
 * ticketOpportunityTargetScopeSummaryLabel for how that partial state stays
 * visible without marking the whole Opportunity canceled.
 */
export function isTicketOpportunityRowEffectivelyCanceled(
  row: Pick<
    TicketOpportunityTimelineRow,
    'targetScope' | 'eventCanceled' | 'targetOccurrences' | 'targetOccurrenceIdCount'
  >,
): boolean {
  if (row.eventCanceled) {
    return true;
  }
  if (row.targetScope === 'event_wide') {
    return false;
  }
  if (row.targetOccurrences.length === 0) {
    return false;
  }
  if (row.targetOccurrences.length !== row.targetOccurrenceIdCount) {
    return false;
  }
  return row.targetOccurrences.every((occurrence) => isOccurrenceCanceled(occurrence));
}

/**
 * Issue #144 Task Contract minimum safe rule, factored out of
 * isActionableTicketOpportunityDeadline (Issue #191): the "which milestones
 * ever get urgency treatment" gate - `myState === 'planned'`, an
 * `application_close` milestone, and a non-canceled Opportunity. Never true
 * for result_announcement/sale_start/payment_window (no outcome/settlement
 * state exists in this MVP to justify escalating those), and never true
 * when there is no personal `planned` state at all or once the whole
 * Opportunity is effectively canceled (Issue #172 root cause B).
 *
 * Deliberately excludes the not-yet-past condition
 * isActionableTicketOpportunityDeadline adds on top of this - that
 * condition alone must not decide "does this milestone even carry urgency
 * vocabulary", since Issue #191's `terminal`/受付終了 classification
 * intentionally still applies to an already-past deadline of this same
 * shape (see ticketOpportunityDeadlineBadge).
 */
function isDeadlineRelevantMilestone(
  row: Pick<
    TicketOpportunityTimelineRow,
    | 'milestoneType'
    | 'myState'
    | 'targetScope'
    | 'eventCanceled'
    | 'targetOccurrences'
    | 'targetOccurrenceIdCount'
  >,
): boolean {
  if (row.myState !== 'planned') {
    return false;
  }
  if (row.milestoneType !== 'application_close') {
    return false;
  }
  return !isTicketOpportunityRowEffectivelyCanceled(row);
}

/**
 * Issue #144 Task Contract minimum safe rule: red deadline emphasis is
 * limited to a milestone the caller can actually still act on - see
 * isDeadlineRelevantMilestone for the shape of milestone this ever applies
 * to - and a deadline that has not already passed.
 */
export function isActionableTicketOpportunityDeadline(
  row: Pick<
    TicketOpportunityTimelineRow,
    | 'milestoneType'
    | 'myState'
    | 'dateValue'
    | 'at'
    | 'startsAt'
    | 'endsAt'
    | 'targetScope'
    | 'eventCanceled'
    | 'targetOccurrences'
    | 'targetOccurrenceIdCount'
  >,
  todayTokyoDate: string,
): boolean {
  if (!isDeadlineRelevantMilestone(row)) {
    return false;
  }
  const deadlineDate = ticketOpportunityMilestoneTokyoCalendarDate(row);
  return deadlineDate >= todayTokyoDate;
}

/** Whole Tokyo-calendar-day difference (to - from), by plain date
 * arithmetic - never the JS runtime's local timezone. */
function daysBetweenTokyoDates(fromDate: string, toDate: string): number {
  const from = parseTokyoCalendarDate(fromDate);
  const to = parseTokyoCalendarDate(toDate);
  const fromMs = Date.UTC(from.year, from.month - 1, from.day);
  const toMs = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
}

/** The exact source time a milestone's deadline falls on, in the same
 * `at` > `endsAt` precision-priority order ticketOpportunityMilestoneTokyoCalendarDate
 * uses for the date itself - null for a date-only milestone (never a fake
 * time; Issue #191 Task Contract "date-only → fake timeを作らない"), and
 * for a window/datetime malformed enough to carry neither (defensive; both
 * are otherwise guaranteed present for their own precision). */
function ticketOpportunityMilestoneTokyoTimeLabel(
  row: Pick<TicketOpportunityTimelineRow, 'at' | 'endsAt'>,
): string | null {
  if (row.at !== null) {
    return tokyoTimeLabel(row.at);
  }
  if (row.endsAt !== null) {
    return tokyoTimeLabel(row.endsAt);
  }
  return null;
}

/** A Badge variant string matching ui/Badge's own BadgeVariant values -
 * spelled out here rather than imported, since domain code may not depend
 * on @/ui (see the architecture import boundary in eslint.config.mjs);
 * ticketOpportunityStateBadgeVariant follows the same precedent. */
export type TicketOpportunityDeadlineBadgeVariant = 'deadline' | 'outline' | 'terminal';

export interface TicketOpportunityDeadlineBadge {
  variant: TicketOpportunityDeadlineBadgeVariant;
  label: string;
}

/**
 * The single deadline-urgency classification authority (Issue #191 Task
 * Contract): Home (homeDeadlines.ts) and /tickets (TicketOpportunityRow)
 * both call this instead of holding their own <=3-day/<14-day/red
 * threshold, so "how many days until this turns red" is decided in exactly
 * one place. Canonical thresholds, all counted as whole Asia/Tokyo
 * calendar-day differences (never an hour-duration split):
 *
 * | day difference | variant    | label                                    |
 * | --------------- | ---------- | ---------------------------------------- |
 * | already past    | `terminal` | 受付終了                                  |
 * | 0 (today)       | `deadline` | 本日 HH:MMまで (source time) / 本日締切 (date-only) |
 * | 1-3             | `deadline` | 残りN日                                   |
 * | 4-13            | `outline`  | 残りN日                                   |
 * | 14+             | (none)     | null                                     |
 *
 * Scoped to exactly the rows isDeadlineRelevantMilestone calls relevant - a
 * no-state/applied/non-application_close/effectively-canceled row always
 * returns null, never red or terminal (Issue #191 Task Contract "絶対に
 * redへ昇格しない"). The `terminal` case is the one bounded addition this
 * Task makes on top of isActionableTicketOpportunityDeadline's actionable
 * (not-yet-past) rows: a previously-actionable application_close deadline
 * that has already passed still classifies, so a caller that elects to
 * retain such a row (e.g. the #192 visible-window Task's bounded
 * post-final retention) has vocabulary to render it - this module makes no
 * retention/visibility decision of its own.
 */
export function ticketOpportunityDeadlineBadge(
  row: Pick<
    TicketOpportunityTimelineRow,
    | 'milestoneType'
    | 'myState'
    | 'dateValue'
    | 'at'
    | 'startsAt'
    | 'endsAt'
    | 'targetScope'
    | 'eventCanceled'
    | 'targetOccurrences'
    | 'targetOccurrenceIdCount'
  >,
  todayTokyoDate: string,
): TicketOpportunityDeadlineBadge | null {
  if (!isDeadlineRelevantMilestone(row)) {
    return null;
  }
  const deadlineDate = ticketOpportunityMilestoneTokyoCalendarDate(row);
  const days = daysBetweenTokyoDates(todayTokyoDate, deadlineDate);
  if (days < 0) {
    return { variant: 'terminal', label: '受付終了' };
  }
  if (days === 0) {
    const time = ticketOpportunityMilestoneTokyoTimeLabel(row);
    return { variant: 'deadline', label: time !== null ? `本日 ${time}まで` : '本日締切' };
  }
  if (days <= 3) {
    return { variant: 'deadline', label: `残り${String(days)}日` };
  }
  if (days <= 13) {
    return { variant: 'outline', label: `残り${String(days)}日` };
  }
  return null;
}

/**
 * Auxiliary target-scope summary text (Issue #144 Task Contract "補助情報").
 * `event_wide` reads as "公演全体" (a semantic fact, not a snapshot of
 * whichever Occurrences currently exist - product-rules.md "Target scope").
 * `selected_occurrences` lists each target Occurrence's own date/time, using
 * the same occurrence display convention as the rest of the product
 * (catalogFormatting.ts) - never a raw Occurrence UUID.
 */
export function ticketOpportunityTargetScopeSummaryLabel(
  row: Pick<TicketOpportunityTimelineRow, 'targetScope' | 'targetOccurrences'>,
): string {
  if (row.targetScope === 'event_wide') {
    return '公演全体';
  }
  if (row.targetOccurrences.length === 0) {
    return '対象の公演回情報がありません';
  }
  // A partially canceled selected_occurrences target (some but not all
  // targets canceled) is not whole-Opportunity terminal (see
  // isTicketOpportunityRowEffectivelyCanceled) - the canceled target still
  // needs to be distinguishable here using the same "中止" vocabulary used
  // everywhere else, per Issue #172 root cause B's presentation rule.
  const labels = row.targetOccurrences.map((occurrence) => {
    const tokyoDate = tokyoCalendarDateFromInstant(occurrence.startsAt);
    const base = `${calendarDateWeekdayLabel(tokyoDate)} ${tokyoTimeLabel(occurrence.startsAt)}`;
    return isOccurrenceCanceled(occurrence) ? `${base}（中止）` : base;
  });
  return `対象公演回: ${labels.join('、')}`;
}
