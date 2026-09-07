import { tokyoCalendarDateFromInstant } from '@/domain/eventCatalog';

/**
 * "Now" as an Asia/Tokyo calendar date. Mirrors src/app/catalog/_lib/today.ts
 * (src/domain stays pure/clock-free - see that module's own header) - used
 * here only to derive a default month/day context for the "イベントを追加"
 * row's link (Issue #193), since My Page has no calendar navigation state of
 * its own to carry, the same situation Home's HomeUpcomingList is in.
 */
export function currentTokyoDate(): string {
  return tokyoCalendarDateFromInstant(new Date().toISOString());
}
