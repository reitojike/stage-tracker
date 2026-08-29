// Home "申し込み期限" (deadline) block projection (Issue #143).
//
// This module adds no new deadline/actionability semantics of its own: it
// only selects and orders the subset of an already-built #144 Ticket
// Opportunity timeline (domain/ticketOpportunityTimeline.ts) that Home's
// Task Contract calls actionable, reusing isActionableTicketOpportunityDeadline
// and ticketOpportunityMilestoneTokyoCalendarDate from
// ticketOpportunityFormatting.ts exactly as /tickets does - never a separate
// "when is this red" re-derivation.
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs).

import { sortByFieldThenId } from './ordering.ts';
import {
  isActionableTicketOpportunityDeadline,
  ticketOpportunityMilestoneTokyoCalendarDate,
} from './ticketOpportunityFormatting.ts';
import type { TicketOpportunityTimelineRow } from './ticketOpportunityTimeline.ts';
import { HOME_WINDOW_DAYS, isOnOrBeforeDaysAhead } from './visibleWindow.ts';

/**
 * Every actionable deadline row within HOME_WINDOW_DAYS (today..+14 Asia/
 * Tokyo calendar days, inclusive - Issue #192 bounded supersede of Issue
 * #143's unbounded-ahead projection): caller's own `planned` state, an
 * `application_close` milestone, not yet past - see
 * isActionableTicketOpportunityDeadline - nearest deadline first. No count
 * cap within the window (Task Contract: "件数の上限は設けず横に流す"). A
 * window-precision application_close sorts by its window *end* (the actual
 * deadline), not its start - ticketOpportunityMilestoneTokyoCalendarDate
 * already resolves that priority, so this never falls back to
 * ticketOpportunityMilestoneSortInstant's chronological-*display* ordering,
 * which prefers a window's start instant instead.
 *
 * `rows` is expected to be the full #144 timeline (every Opportunity/
 * milestone this caller can read) - filtering to only actionable,
 * in-window rows is this function's job, not the caller's.
 */
export function selectHomeDeadlineRows(
  rows: readonly TicketOpportunityTimelineRow[],
  todayTokyoDate: string,
): TicketOpportunityTimelineRow[] {
  const actionable = rows.filter((row) => {
    if (!isActionableTicketOpportunityDeadline(row, todayTokyoDate)) {
      return false;
    }
    return isOnOrBeforeDaysAhead(
      ticketOpportunityMilestoneTokyoCalendarDate(row),
      todayTokyoDate,
      HOME_WINDOW_DAYS,
    );
  });
  return sortByFieldThenId(actionable, (row) => ticketOpportunityMilestoneTokyoCalendarDate(row));
}
