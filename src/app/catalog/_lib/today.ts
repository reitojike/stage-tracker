import { tokyoCalendarDateFromInstant } from '@/domain/eventCatalog';

/**
 * "Now" as an Asia/Tokyo calendar date. Kept out of src/domain (which stays
 * a pure, DB-free, clock-free layer - see AGENTS.md architecture import
 * boundary intent) and reused by both the month page and the event detail
 * page for their default month/day.
 */
export function currentTokyoDate(): string {
  return tokyoCalendarDateFromInstant(new Date().toISOString());
}
