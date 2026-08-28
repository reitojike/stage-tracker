import { parseTokyoCalendarDate, tokyoCalendarDateFromInstant } from './eventCatalog.ts';
import { tokyoTimeLabel } from './catalogFormatting.ts';
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

/** Issue #138: both `planned` and `applied` are an in-progress personal
 * planning state, so both map to the same 'subtle' Badge variant - there is
 * no separate "done" visual distinct from "still to do" for this MVP. */
export function ticketOpportunityStateBadgeVariant(status: UserTicketOpportunityStatus): 'subtle' {
  switch (status) {
    case 'planned':
    case 'applied':
      return 'subtle';
  }
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** Plain proleptic-Gregorian weekday-of, matching calendarDayRole.ts's own
 * (private) weekdayOf - calendar arithmetic independent of any timezone
 * offset. Duplicated rather than imported, following that module's own
 * precedent for this exact one-line calculation (cheaper than a cross-module
 * dependency solely for this reuse). */
function weekdayOf(tokyoDate: string): number {
  const { year, month, day } = parseTokyoCalendarDate(tokyoDate);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** "9月10日(火)" - a plain weekday marker, not the Japanese-holiday-aware
 * role calendarDayRole.ts computes for the month calendar: this timeline has
 * no red/blue day-role presentation requirement, only a Fri/Sat/Sun-legible
 * date label, so this always resolves regardless of holiday-snapshot
 * coverage. */
function tokyoMonthDayWeekdayLabel(tokyoDate: string): string {
  const { month, day } = parseTokyoCalendarDate(tokyoDate);
  const weekday = WEEKDAY_LABELS[weekdayOf(tokyoDate)] ?? '?';
  return `${String(month)}月${String(day)}日(${weekday})`;
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
  /** e.g. "9月10日(火)", or "9月10日(木) 〜 9月13日(日)" for a window
   * spanning more than one Tokyo calendar day. */
  dateLabel: string;
  /** e.g. "17:00", or "18:00〜23:59" for a same-day window; null for a
   * date-only milestone, since the source gave no time to show. */
  timeLabel: string | null;
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
    return { dateLabel: tokyoMonthDayWeekdayLabel(row.dateValue), timeLabel: null };
  }

  if (row.temporalPrecision === 'datetime') {
    if (row.at === null) {
      throw new Error('a datetime-precision milestone must carry at');
    }
    const tokyoDate = tokyoCalendarDateFromInstant(row.at);
    return { dateLabel: tokyoMonthDayWeekdayLabel(tokyoDate), timeLabel: tokyoTimeLabel(row.at) };
  }

  if (row.startsAt === null || row.endsAt === null) {
    throw new Error('a window-precision milestone must carry startsAt and endsAt');
  }
  const startDate = tokyoCalendarDateFromInstant(row.startsAt);
  const endDate = tokyoCalendarDateFromInstant(row.endsAt);
  const startTime = tokyoTimeLabel(row.startsAt);
  const endTime = tokyoTimeLabel(row.endsAt);
  if (startDate === endDate) {
    return {
      dateLabel: tokyoMonthDayWeekdayLabel(startDate),
      timeLabel: `${startTime}〜${endTime}`,
    };
  }
  return {
    dateLabel: `${tokyoMonthDayWeekdayLabel(startDate)} 〜 ${tokyoMonthDayWeekdayLabel(endDate)}`,
    timeLabel: `${startTime} 〜 ${endTime}`,
  };
}

/**
 * The Asia/Tokyo calendar date a milestone concerns, for internal
 * red/remaining-days logic only - never rendered directly (that would
 * reintroduce the synthetic-midnight-as-display hazard
 * formatTicketOpportunityMilestoneDisplay avoids). Prefers the most precise
 * value available, same priority order as
 * ticketOpportunityMilestoneSortInstant.
 */
function ticketOpportunityMilestoneTokyoCalendarDate(
  row: Pick<TicketOpportunityTimelineRow, 'dateValue' | 'at' | 'startsAt'>,
): string {
  if (row.at !== null) {
    return tokyoCalendarDateFromInstant(row.at);
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
 * Issue #144 Task Contract minimum safe rule: red deadline emphasis is
 * limited to a milestone the caller can actually still act on -
 * `myState.status === 'planned'`, an `application_close` milestone, and a
 * deadline that has not already passed. Never true for
 * result_announcement/sale_start/payment_window (no outcome/settlement
 * state exists in this MVP to justify escalating those to red), and never
 * true when there is no personal `planned` state at all.
 */
export function isActionableTicketOpportunityDeadline(
  row: Pick<
    TicketOpportunityTimelineRow,
    'milestoneType' | 'myState' | 'dateValue' | 'at' | 'startsAt'
  >,
  todayTokyoDate: string,
): boolean {
  if (row.myState !== 'planned') {
    return false;
  }
  if (row.milestoneType !== 'application_close') {
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

/**
 * "残り3日" / "本日締切" for an actionable deadline row, or null when the
 * row is not actionable (see isActionableTicketOpportunityDeadline) - the
 * caller must gate rendering on that function, this only formats the count.
 */
export function ticketOpportunityDeadlineRemainingDaysLabel(
  row: Pick<
    TicketOpportunityTimelineRow,
    'milestoneType' | 'myState' | 'dateValue' | 'at' | 'startsAt'
  >,
  todayTokyoDate: string,
): string | null {
  if (!isActionableTicketOpportunityDeadline(row, todayTokyoDate)) {
    return null;
  }
  const deadlineDate = ticketOpportunityMilestoneTokyoCalendarDate(row);
  const days = daysBetweenTokyoDates(todayTokyoDate, deadlineDate);
  return days === 0 ? '本日締切' : `残り${String(days)}日`;
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
  const labels = row.targetOccurrences.map((occurrence) => {
    const tokyoDate = tokyoCalendarDateFromInstant(occurrence.startsAt);
    return `${tokyoMonthDayWeekdayLabel(tokyoDate)} ${tokyoTimeLabel(occurrence.startsAt)}`;
  });
  return `対象公演回: ${labels.join('、')}`;
}
