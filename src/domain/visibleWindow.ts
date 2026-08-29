// Bounded visible-window constants (Issue #192) - the single place Home's
// and Tickets' own window/limit values live, so no screen component or
// domain projection redeclares a day-count/limit literal of its own (Task
// Contract: "Window valuesをscreenへ散らさない").
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs).

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
