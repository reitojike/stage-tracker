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

export function currentTokyoDate(): string {
  return tokyoCalendarDateFromInstant(currentInstant());
}
