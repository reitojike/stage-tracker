import {
  compareInstants,
  isInstantSameOrAfter,
  tokyoCalendarDayRangeUtc,
  type PersonalScheduleEntry,
  type TokyoCalendarDate,
} from "@stage-tracker/domain";
import type { ScreenNow } from "@/app/_lib/now";
import type { MergedListBlockState, BlockState } from "@/app/_lib/read-state";
import type { HomeUpcomingItem } from "../../_lib/home-loader";
import type {
  CalendarScheduleItem,
  TokyoDateIndex,
} from "../../calendar/_lib/calendar-loader";
import { scheduleEntryDatesInRange } from "../../calendar/_lib/calendar-view-model";

export function scheduleEntrySortInstant(entry: PersonalScheduleEntry) {
  return entry.temporal.kind === "all-day"
    ? tokyoCalendarDayRangeUtc(entry.temporal.startsOn).startInstant
    : entry.temporal.startsAt;
}

export function isUpcomingScheduleEntry(
  entry: PersonalScheduleEntry,
  now: ScreenNow,
) {
  return entry.temporal.kind === "all-day"
    ? tokyoCalendarDayRangeUtc(entry.temporal.endsOn).endInstantExclusive >
        now.nowInstant
    : isInstantSameOrAfter(
        entry.temporal.endsAt ?? entry.temporal.startsAt,
        now.nowInstant,
      );
}

export function projectSharedHome(
  own: MergedListBlockState<readonly HomeUpcomingItem[]>,
  entries: readonly PersonalScheduleEntry[],
  now: ScreenNow,
): MergedListBlockState<readonly HomeUpcomingItem[]> {
  if (
    own.variant === "error" ||
    own.variant === "unavailable" ||
    (own.variant === "partial" && !own.b.ok)
  )
    return own;
  const shared: HomeUpcomingItem[] = entries
    .filter((e) => isUpcomingScheduleEntry(e, now))
    .map((entry) => ({
      kind: "schedule",
      entry,
      isOwner: false,
      sortInstant: scheduleEntrySortInstant(entry),
    }));
  const data = [...(own.variant === "empty" ? [] : own.data), ...shared]
    .sort((a, b) => compareInstants(a.sortInstant, b.sortInstant))
    .slice(0, 5);
  if (own.variant === "partial") return { ...own, data };
  return data.length ? { variant: "populated", data } : { variant: "empty" };
}

export function buildScheduleIndex(
  entries: readonly PersonalScheduleEntry[],
  start: TokyoCalendarDate,
  end: TokyoCalendarDate,
): TokyoDateIndex<CalendarScheduleItem> {
  const items: CalendarScheduleItem[] = [];
  const byDate = new Map<TokyoCalendarDate, CalendarScheduleItem[]>();
  for (const entry of entries) {
    const dates = scheduleEntryDatesInRange(entry, start, end);
    if (!dates.length) continue;
    const item = { entry };
    items.push(item);
    for (const date of dates)
      byDate.set(date, [...(byDate.get(date) ?? []), item]);
  }
  return { items, byDate };
}

export function projectSharedCalendar(
  own: BlockState<TokyoDateIndex<CalendarScheduleItem>>,
  entries: readonly PersonalScheduleEntry[],
  start: TokyoCalendarDate,
  end: TokyoCalendarDate,
): BlockState<TokyoDateIndex<CalendarScheduleItem>> {
  if (own.variant === "error" || own.variant === "unavailable") return own;
  const data = buildScheduleIndex(
    [
      ...(own.variant === "populated"
        ? own.data.items.map((i) => i.entry)
        : []),
      ...entries,
    ],
    start,
    end,
  );
  return data.items.length
    ? { variant: "populated", data }
    : { variant: "empty" };
}
