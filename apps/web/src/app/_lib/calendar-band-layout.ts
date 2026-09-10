import type { TokyoCalendarDate } from "@stage-tracker/domain";

/**
 * Generic multi-day "band" week-layout algorithm, ported from
 * `apps/legacy-web/src/domain/calendarMonth.ts`'s `layoutWeekBands`
 * (`docs/v2/oracle-domain.md` §2.9 "Personal schedule / My Calendar": "月表示
 * の band...1 週あたり同時表示できる band は最大 `MAX_BAND_LANES = 2`").
 *
 * Kept generic and feature-agnostic (like `./calendar-grid.ts` and
 * `./calendar-day-role.ts`) rather than living under `(app)/catalog/_lib`:
 * the oracle names the same `MAX_BAND_LANES = 2` cap for My Calendar's own
 * multi-day PersonalSchedule bands, so a later Task giving `/calendar` band
 * rendering (a separate, already-known gap - see this Task's report) can
 * reuse this algorithm unchanged instead of duplicating it.
 */

export interface BandSegment {
  readonly eventId: string;
  readonly eventTitle: string;
  readonly startDate: TokyoCalendarDate;
  readonly endDate: TokyoCalendarDate;
  readonly isCanceled: boolean;
}

/** `T` positioned within a week's lane grid - `lane` plus a 0-6 column index
 * (inclusive on both ends) for `startCol`/`endCol`. Generic so a richer
 * segment shape than plain `BandSegment` gets that shape back on every
 * positioned segment. */
export type Positioned<T extends BandSegment> = T & {
  readonly lane: number;
  readonly startCol: number;
  readonly endCol: number;
};

export interface WeekBandLayout<T extends BandSegment = BandSegment> {
  readonly weekStartDate: TokyoCalendarDate;
  /** Bounded to at most `maxLanes` entries. */
  readonly segments: readonly Positioned<T>[];
  /** `overflowEvents.length`. */
  readonly overflowCount: number;
  /** The segments pushed beyond the lane cap this week, deduplicated by
   * `eventId` (so a segment whose range itself overflows more than one week
   * is still one hidden entry, not one per week). The full `T` shape, not
   * just the base `BandSegment` fields. */
  readonly overflowEvents: readonly T[];
}

/** Bounded lane count for month-view band rendering: a cell's marker total
 * is capped so at most 2 concurrent bands may occupy any single day. */
export const MAX_BAND_LANES = 2;

/**
 * Lays out the band segments active during one week (7 consecutive dates,
 * Sunday..Saturday) into a bounded number of non-overlapping lanes.
 * Segments are clipped to the week's own date range first: a run spanning a
 * week boundary produces one positioned segment per week it touches.
 *
 * Lane assignment is the standard interval-partitioning greedy: sort by
 * start column ascending (ties broken by the longer segment first, so a
 * multi-day run sharing a start column with a single-day one is not
 * arbitrarily preferred over it), then assign each segment to any lane whose
 * last-placed segment already ended before it starts, opening a new lane
 * only when none is free.
 */
export function layoutWeekBands<T extends BandSegment>(
  weekDates: readonly TokyoCalendarDate[],
  segments: readonly T[],
  maxLanes: number = MAX_BAND_LANES,
): WeekBandLayout<T> {
  if (weekDates.length !== 7) {
    throw new Error("expected exactly 7 dates (Sunday..Saturday) for a week");
  }
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];
  if (weekStart === undefined || weekEnd === undefined) {
    throw new Error("expected exactly 7 dates (Sunday..Saturday) for a week");
  }

  const clipped = segments
    .filter(
      (segment) => segment.startDate <= weekEnd && segment.endDate >= weekStart,
    )
    .map((segment) => {
      const clippedStart =
        segment.startDate > weekStart ? segment.startDate : weekStart;
      const clippedEnd = segment.endDate < weekEnd ? segment.endDate : weekEnd;
      return {
        original: segment,
        startCol: weekDates.indexOf(clippedStart),
        endCol: weekDates.indexOf(clippedEnd),
      };
    })
    .sort((a, b) => {
      if (a.startCol !== b.startCol) {
        return a.startCol - b.startCol;
      }
      const lengthA = a.endCol - a.startCol;
      const lengthB = b.endCol - b.startCol;
      return lengthB - lengthA;
    });

  const laneEndCols: number[] = [];
  const positioned: Positioned<T>[] = [];
  const overflowEventInfo = new Map<string, T>();

  for (const segment of clipped) {
    let lane = laneEndCols.findIndex((endCol) => endCol < segment.startCol);
    if (lane === -1) {
      if (laneEndCols.length < maxLanes) {
        lane = laneEndCols.length;
        laneEndCols.push(segment.endCol);
      } else {
        overflowEventInfo.set(segment.original.eventId, segment.original);
        continue;
      }
    } else {
      laneEndCols[lane] = segment.endCol;
    }
    positioned.push({
      ...segment.original,
      startCol: segment.startCol,
      endCol: segment.endCol,
      lane,
    });
  }

  const overflowEvents = [...overflowEventInfo.values()];

  return {
    weekStartDate: weekStart,
    segments: positioned,
    overflowCount: overflowEvents.length,
    overflowEvents,
  };
}
