import type { PersonalScheduleEntry } from "@stage-tracker/domain";
import { instantToDateTimeLocalValue } from "@/lib/datetime-local-value";
import type { ScheduleEntryDefaultValues } from "./ScheduleEntryFields";

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
    timeBoundedStartsAt: instantToDateTimeLocalValue(entry.temporal.startsAt),
    timeBoundedEndsAt:
      entry.temporal.endsAt === null
        ? undefined
        : instantToDateTimeLocalValue(entry.temporal.endsAt),
  };
}
