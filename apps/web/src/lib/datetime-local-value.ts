import { instantToTokyoWallClock, type Instant } from "@stage-tracker/domain";

/** `datetime-local` 用の Tokyo wall-clock 表記（秒なし）。空欄の扱いは呼出元が持つ。 */
export function instantToDateTimeLocalValue(instant: Instant): string {
  const wall = instantToTokyoWallClock(instant);
  const pad2 = (value: number) => String(value).padStart(2, "0");
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}T${pad2(wall.hour)}:${pad2(wall.minute)}`;
}
