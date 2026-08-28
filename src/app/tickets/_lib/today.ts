import { tokyoCalendarDateFromInstant } from '@/domain/eventCatalog';

// Mirrors src/app/calendar/_lib/today.ts verbatim: src/domain stays pure/
// clock-free, and each route owns its own clock read rather than sharing one
// (see that module's own header).
export function currentTokyoDate(): string {
  return tokyoCalendarDateFromInstant(new Date().toISOString());
}
