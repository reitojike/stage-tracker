import { tokyoCalendarDateFromInstant } from '@/domain/eventCatalog';

/**
 * Home's own clock read (Issue #143). Mirrors every other route's
 * _lib/today.ts (src/app/{calendar,catalog,tickets}/_lib/today.ts): src/domain
 * stays pure/clock-free, and each route owns its own clock read rather than
 * sharing one (see those modules' own headers).
 *
 * Home's upcoming-projection helper (domain/homeUpcoming.ts) additionally
 * needs the current instant, not just the Tokyo calendar date - unlike every
 * other route's month/day-level navigation, it must tell a currently-active
 * time-bounded personal-schedule entry from one whose end has already
 * passed "now", not just "today".
 */
export function currentInstant(): string {
  return new Date().toISOString();
}

export function currentTokyoDate(): string {
  return tokyoCalendarDateFromInstant(currentInstant());
}
