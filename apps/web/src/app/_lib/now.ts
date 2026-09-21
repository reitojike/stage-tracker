import {
  epochMsToInstant,
  instantToTokyoCalendarDate,
  type Instant,
  type TokyoCalendarDate,
} from "@stage-tracker/domain";

/**
 * The single clock-read boundary shared by every screen implemented in this
 * Task (`/`, `/calendar`, `/catalog`, `/tickets`).
 *
 * The domain package stays clock-free, so this file is the single application
 * collection point for the 4 screens built here (a screen-loader takes
 * `ScreenNow` as an explicit parameter and never reads the clock itself,
 * which is also what keeps the loaders unit-testable with a fixed "now"
 * instead of faking `Date.now()` - see e.g. `(app)/_lib/home-loader.test.ts`).
 *
 * Mirrors `@/lib/tokyo-date.ts`'s `resolveServerTokyoDate` (same pattern: the
 * caller supplies `nowEpochMs`, `@stage-tracker/domain` never calls
 * `Date.now()` itself) but also carries the `Instant` form, since the ticket
 * timeline functions (`buildTicketOpportunityTimelineRows` and friends) need
 * `nowInstant` in addition to `todayTokyoDate`.
 */
export interface ScreenNow {
  readonly nowInstant: Instant;
  readonly todayTokyoDate: TokyoCalendarDate;
}

export function resolveScreenNow(nowEpochMs: number = Date.now()): ScreenNow {
  const nowInstant = epochMsToInstant(nowEpochMs);
  return {
    nowInstant,
    todayTokyoDate: instantToTokyoCalendarDate(nowInstant),
  };
}
