import { instantToTokyoWallClock, type Instant } from "@stage-tracker/domain";

/** `../../events/[eventId]/edit/_lib/instantFormat.ts` と同じ変換
 * （route-local な重複 — 既存の `_lib/today.ts` 的な per-route 重複方針を
 * 踏襲する）。Asia/Tokyo の wall-clock 表記（"YYYY-MM-DDTHH:mm"）へ変換
 * する。 */
export function instantToDateTimeLocalValue(instant: Instant): string {
  const wall = instantToTokyoWallClock(instant);
  const pad2 = (value: number) => String(value).padStart(2, "0");
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}T${pad2(wall.hour)}:${pad2(wall.minute)}`;
}
