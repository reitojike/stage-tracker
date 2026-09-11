import {
  instantToTokyoCalendarDate,
  type PersonalScheduleEntryTemporal,
} from "@stage-tracker/domain";
import {
  formatTokyoCalendarDateRangeJa,
  formatTokyoDateTimeJa,
  formatTokyoTime,
} from "@/app/_lib/format";

/**
 * `/schedule/[entryId]` の詳細表示用、entry の `temporal` を人間可読な
 * 日本語文字列へ変換する。この画面専用の表示ロジックであり、product
 * invariant の判定は一切行わない（それは domain の責務）。
 */
export function formatScheduleEntryTemporal(
  temporal: PersonalScheduleEntryTemporal,
): string {
  if (temporal.kind === "all-day") {
    return `${formatTokyoCalendarDateRangeJa(
      temporal.startsOn,
      temporal.endsOn,
    )}（終日）`;
  }

  const startsLabel = formatTokyoDateTimeJa(temporal.startsAt);

  if (temporal.endsAt === null) {
    return `${startsLabel} 〜（終了時刻未定）`;
  }

  const startsDate = instantToTokyoCalendarDate(temporal.startsAt);
  const endsDate = instantToTokyoCalendarDate(temporal.endsAt);
  const endsLabel =
    startsDate === endsDate
      ? formatTokyoTime(temporal.endsAt)
      : formatTokyoDateTimeJa(temporal.endsAt);

  return `${startsLabel} 〜 ${endsLabel}`;
}
