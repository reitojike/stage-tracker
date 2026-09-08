import type { Instant, PersonalScheduleEntry } from "@stage-tracker/domain";
import { instantToTokyoWallClock } from "@stage-tracker/domain";
import type { ScheduleEntryDefaultValues } from "./ScheduleEntryFields";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `Instant` を `<input type="datetime-local">` の値（Asia/Tokyo ローカル、秒なし）へ変換する。 */
function instantToDatetimeLocalValue(instant: Instant): string {
  const wallClock = instantToTokyoWallClock(instant);
  return `${wallClock.year}-${pad2(wallClock.month)}-${pad2(wallClock.day)}T${pad2(wallClock.hour)}:${pad2(wallClock.minute)}`;
}

/**
 * `/schedule/[entryId]/edit` が、既存 entry を `ScheduleEntryFields` の
 * `defaultValues` 形へ変換する。domain の `temporal`
 * discriminated union をそのままフォームの平坦なフィールド集合へ写す
 * だけで、product invariant（順序等）は一切再判定しない
 * （それは `scheduleEntryFormSchema`/`parseScheduleEntryTemporal` の責務）。
 */
export function toScheduleEntryDefaultValues(
  entry: PersonalScheduleEntry,
): ScheduleEntryDefaultValues {
  const base = {
    title: entry.title,
    memo: entry.memo ?? undefined,
    blocking: entry.blocking,
  };

  if (entry.temporal.kind === "all-day") {
    return {
      ...base,
      temporalMode: "all-day",
      allDayStartsOn: entry.temporal.startsOn,
      allDayEndsOn: entry.temporal.endsOn,
    };
  }

  return {
    ...base,
    temporalMode: "time-bounded",
    timeBoundedStartsAt: instantToDatetimeLocalValue(entry.temporal.startsAt),
    timeBoundedEndsAt:
      entry.temporal.endsAt === null
        ? undefined
        : instantToDatetimeLocalValue(entry.temporal.endsAt),
  };
}
