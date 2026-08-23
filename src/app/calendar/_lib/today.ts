import { tokyoCalendarDateFromInstant } from '@/domain/eventCatalog';

/**
 * "Now" as an Asia/Tokyo calendar date. Kept out of src/domain (which stays
 * a pure, DB-free, clock-free layer - see AGENTS.md architecture import
 * boundary intent), matching src/app/catalog/_lib/today.ts's own copy for
 * the same reason: each app route owns its feature-local clock read
 * instead of sharing one across features.
 */
export function currentTokyoDate(): string {
  return tokyoCalendarDateFromInstant(new Date().toISOString());
}
