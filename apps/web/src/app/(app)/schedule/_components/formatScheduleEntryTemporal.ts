import {
  instantToTokyoCalendarDate,
  type PersonalScheduleEntryTemporal,
} from "@stage-tracker/domain";
import {
  formatTokyoCalendarDateRangeJa,
  formatTokyoCalendarDateWithYearJa,
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
  options: { readonly includeYear?: boolean } = {},
): string {
  const formatDate = options.includeYear
    ? formatTokyoCalendarDateWithYearJa
    : (date: Parameters<typeof formatTokyoCalendarDateWithYearJa>[0]) =>
        formatTokyoCalendarDateRangeJa(date, date);

  if (temporal.kind === "all-day") {
    const range =
      temporal.startsOn === temporal.endsOn
        ? formatDate(temporal.startsOn)
        : `${formatDate(temporal.startsOn)} 〜 ${formatDate(temporal.endsOn)}`;
    return `${range}（終日）`;
  }

  const startsLabel = options.includeYear
    ? `${formatDate(instantToTokyoCalendarDate(temporal.startsAt))} ${formatTokyoTime(temporal.startsAt)}`
    : formatTokyoDateTimeJa(temporal.startsAt);

  if (temporal.endsAt === null) {
    return `${startsLabel} 〜（終了時刻未定）`;
  }

  const startsDate = instantToTokyoCalendarDate(temporal.startsAt);
  const endsDate = instantToTokyoCalendarDate(temporal.endsAt);
  const endsLabel =
    startsDate === endsDate
      ? formatTokyoTime(temporal.endsAt)
      : options.includeYear
        ? `${formatDate(endsDate)} ${formatTokyoTime(temporal.endsAt)}`
        : formatTokyoDateTimeJa(temporal.endsAt);

  return `${startsLabel} 〜 ${endsLabel}`;
}
