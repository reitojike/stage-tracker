// Bounded visible-window constants and predicate (Issue #192) - the single
// place Home's and Tickets' own window/limit values AND the "is this date
// within N days of that date" comparison itself live, so no screen
// component or domain projection redeclares a day-count/limit literal, or
// re-derives the addDaysToDate+compare boundary check, of its own (Task
// Contract: "Window valuesをscreenへ散らさない").
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs).

import { addDaysToDate } from './calendarMonth.ts';

/** Home's "直近の予定" and "申し込み期限" blocks both only look this many
 * Asia/Tokyo calendar days ahead of today, inclusive of today itself - see
 * domain/homeUpcoming.ts's selectHomeUpcomingItems and
 * domain/homeDeadlines.ts's selectHomeDeadlineRows. Supersedes Issue #143's
 * unbounded-ahead deadline projection. */
export const HOME_WINDOW_DAYS = 14;

/** "直近の予定" nearest-first cap within HOME_WINDOW_DAYS (domain/
 * homeUpcoming.ts's selectHomeUpcomingItems) - supersedes Issue #143's
 * HOME_UPCOMING_LIMIT = 8 broader projection. */
export const HOME_UPCOMING_LIMIT = 5;

/** How many Asia/Tokyo calendar days after a TicketOpportunity's own final
 * milestone's final day a terminal history row keeps appearing in /tickets
 * before dropping off entirely (domain/ticketOpportunityTimeline.ts's
 * selectTicketOpportunityPrimaryRows) - bounded supersede of Issue #175's
 * immediate disappearance once no non-past milestone remains. */
export const TICKET_POST_FINAL_RETENTION_DAYS = 7;

/**
 * Whether `subjectDate` falls on or before `days` Asia/Tokyo calendar days
 * after `anchorDate` (both endpoints inclusive) - the single boundary check
 * every bounded-window projection in this Task Contract needs, whichever
 * direction it's applied in:
 * - Home windows: is a candidate item's own date within HOME_WINDOW_DAYS
 *   *ahead of* today? (subjectDate = item date, anchorDate = today)
 * - Tickets retention: is today still within TICKET_POST_FINAL_RETENTION_DAYS
 *   *ahead of* an Opportunity's final day? (subjectDate = today, anchorDate
 *   = final day)
 *
 * Centralized here (rather than each caller re-deriving
 * `addDaysToDate(anchor, days)` and comparing) so every window/retention
 * boundary in the product shares one inclusive-boundary semantics - a
 * future change to that semantics (e.g. exclusive boundaries) only needs
 * editing once.
 */
export function isOnOrBeforeDaysAhead(
  subjectDate: string,
  anchorDate: string,
  days: number,
): boolean {
  return subjectDate <= addDaysToDate(anchorDate, days);
}
