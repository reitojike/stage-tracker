import type { SupabaseClient } from "@supabase/supabase-js";
import {
  instantToTokyoCalendarDate,
  compareTokyoCalendarDates,
  type Event,
  type Occurrence,
  type Participation,
  type PersonalScheduleEntry,
  type TokyoCalendarDate,
  type UserId,
} from "@stage-tracker/domain";
import { listMyParticipations, listVisiblePersonalSchedule } from "@/lib/data";
import { classifyBlock1, type BlockState } from "@/app/_lib/read-state";
import { scheduleEntryDatesInRange } from "./calendar-view-model";

/**
 * `/calendar`'s data layer (`docs/v2/oracle-routes-ui.md` §1 `/calendar`).
 *
 * `docs/v2/decisions.md` P4 explicitly supersedes the legacy calendar's
 * single-panel degradation ("カレンダーは複数readの失敗を単一の汎用エラーへ
 * 縮退させる") in favor of the same "read ごとに独立して劣化" rule as home.
 * This is why the 2 reads this screen needs (`listMyParticipations`,
 * `listVisiblePersonalSchedule`) are 2 separate exported loaders below, each
 * with its own `BlockState`, rather than one function that combines them -
 * same shape as `../../_lib/home-loader.ts`'s 2 blocks.
 */

export interface TokyoDateIndex<T> {
  readonly items: readonly T[];
  readonly byDate: ReadonlyMap<TokyoCalendarDate, readonly T[]>;
}

function buildIndex<T>(
  items: readonly T[],
  dateOf: (item: T) => readonly TokyoCalendarDate[],
): TokyoDateIndex<T> {
  const byDate = new Map<TokyoCalendarDate, T[]>();
  for (const item of items) {
    for (const date of dateOf(item)) {
      const existing = byDate.get(date);
      if (existing === undefined) {
        byDate.set(date, [item]);
      } else {
        existing.push(item);
      }
    }
  }
  return { items, byDate };
}

export interface CalendarOccurrenceItem {
  readonly participation: Participation;
  readonly occurrence: Occurrence;
  readonly event: Event;
}

/**
 * "参加予定" block: occurrences the caller has a Participation for, indexed
 * by the Asia/Tokyo calendar date of `occurrence.startsAt` (this Task's
 * "date the item concerns", matching AGENTS.md's own choice of `startsAt`'s
 * date over `doorsAt`/`endsAt` for the Event range containment invariant -
 * the same reasoning applies here). Restricted to `[gridStart, gridEnd]`
 * (the visible month grid, including its leading/trailing adjacent-month
 * days - oracle's "表示グリッド範囲内のみ" for `/calendar`).
 */
export async function loadCalendarOccurrences(
  supabase: SupabaseClient,
  userId: UserId,
  gridStart: TokyoCalendarDate,
  gridEnd: TokyoCalendarDate,
): Promise<BlockState<TokyoDateIndex<CalendarOccurrenceItem>>> {
  const result = await listMyParticipations(supabase, userId);
  return classifyBlock1(
    result,
    (participations) => {
      const items: CalendarOccurrenceItem[] = participations
        .filter((entry) => {
          const date = instantToTokyoCalendarDate(entry.occurrence.startsAt);
          return date >= gridStart && date <= gridEnd;
        })
        .map((entry) => ({
          participation: entry.participation,
          occurrence: entry.occurrence,
          event: entry.event,
        }));
      return buildIndex(items, (item) => [
        instantToTokyoCalendarDate(item.occurrence.startsAt),
      ]);
    },
    (index) => index.items.length === 0,
  );
}

export interface CalendarScheduleItem {
  readonly entry: PersonalScheduleEntry;
}

/**
 * "個人の予定" block: personal schedule entries visible to the caller
 * (owner or shared-with), indexed by every Asia/Tokyo calendar date the
 * entry touches within `[gridStart, gridEnd]`. Both multi-day all-day and
 * known-end time-bounded entries appear on every touched date; an unknown
 * time-bounded end is limited to the start date.
 */
export async function loadCalendarSchedule(
  supabase: SupabaseClient,
  gridStart: TokyoCalendarDate,
  gridEnd: TokyoCalendarDate,
): Promise<BlockState<TokyoDateIndex<CalendarScheduleItem>>> {
  const result = await listVisiblePersonalSchedule(supabase);
  return classifyBlock1(
    result,
    (entries) => {
      const touchedByEntry = entries.map(
        (entry) =>
          [
            entry,
            scheduleEntryDatesInRange(entry, gridStart, gridEnd),
          ] as const,
      );
      const items: CalendarScheduleItem[] = touchedByEntry
        .filter(([, dates]) => dates.length > 0)
        .map(([entry]) => ({ entry }));
      const byDate = new Map<TokyoCalendarDate, CalendarScheduleItem[]>();
      for (const [entry, dates] of touchedByEntry) {
        for (const date of dates) {
          const item: CalendarScheduleItem = { entry };
          const existing = byDate.get(date);
          if (existing === undefined) {
            byDate.set(date, [item]);
          } else {
            existing.push(item);
          }
        }
      }
      return { items, byDate };
    },
    (index) => index.items.length === 0,
  );
}

/** Sorts occurrence items chronologically by their occurrence's `startsAt`
 * (stable tie-break by participation id). Used when rendering a single
 * day's or month's agenda. The pure implementation lives with the calendar
 * view-model so the loader can reuse its pure schedule date-range helper
 * without a runtime module cycle. */
export { compareCalendarOccurrenceItems } from "./calendar-view-model";

/** Re-exported for callers that only have 2 `TokyoCalendarDate`s and want
 * the oracle's own chronological ordering guarantee, without importing
 * `@stage-tracker/domain` directly just for this. */
export { compareTokyoCalendarDates };
