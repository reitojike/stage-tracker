import {
  instantToTokyoWallClock,
  type PersonalScheduleEntryTemporal,
} from "@stage-tracker/domain";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * `/schedule/[entryId]` の詳細表示用、entry の `temporal` を人間可読な
 * 日本語文字列へ変換する。この画面専用の表示ロジックであり、product
 * invariant の判定は一切行わない（それは domain の責務）。
 */
export function formatScheduleEntryTemporal(
  temporal: PersonalScheduleEntryTemporal,
): string {
  if (temporal.kind === "all-day") {
    if (temporal.startsOn === temporal.endsOn) {
      return `${temporal.startsOn}（終日）`;
    }
    return `${temporal.startsOn} 〜 ${temporal.endsOn}（終日）`;
  }

  const starts = instantToTokyoWallClock(temporal.startsAt);
  const startsLabel = `${starts.year}-${pad2(starts.month)}-${pad2(starts.day)} ${pad2(starts.hour)}:${pad2(starts.minute)}`;

  if (temporal.endsAt === null) {
    return `${startsLabel} 〜（終了時刻未定）`;
  }

  const ends = instantToTokyoWallClock(temporal.endsAt);
  const sameDay =
    starts.year === ends.year &&
    starts.month === ends.month &&
    starts.day === ends.day;
  const endsLabel = sameDay
    ? `${pad2(ends.hour)}:${pad2(ends.minute)}`
    : `${ends.year}-${pad2(ends.month)}-${pad2(ends.day)} ${pad2(ends.hour)}:${pad2(ends.minute)}`;

  return `${startsLabel} 〜 ${endsLabel}`;
}
