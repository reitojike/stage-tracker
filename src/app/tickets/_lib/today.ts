import { tokyoCalendarDateFromInstant } from '@/domain/eventCatalog';

// Mirrors src/app/(home)/_lib/now.ts: src/domain stays pure/clock-free, and
// each route owns its own clock read rather than sharing one (see that
// module's own header). /tickets' forward-looking primary projection (Issue
// #175, selectTicketOpportunityPrimaryRows in domain/ticketOpportunityTimeline.ts)
// needs the current instant, not just the Tokyo calendar date - a `datetime`/
// `window` precision milestone's past/current/upcoming state depends on the
// exact instant, not just today's date.
export function currentInstant(): string {
  return new Date().toISOString();
}

/**
 * `instantIso` lets a caller that already read `currentInstant()` derive
 * `today` from that SAME snapshot (see src/app/tickets/page.tsx) instead of
 * this function taking its own independent `new Date()` read - two
 * independent reads a few milliseconds apart can disagree right at the
 * Asia/Tokyo midnight boundary, which would make selectTicketOpportunityPrimaryRows
 * (domain/ticketOpportunityTimeline.ts) apply `now`/`todayTokyoDate` values
 * that come from different instants (CodeRabbit review finding, PR #177).
 * Defaults to a fresh read for any caller that only needs the date.
 */
export function currentTokyoDate(instantIso: string = currentInstant()): string {
  return tokyoCalendarDateFromInstant(instantIso);
}
