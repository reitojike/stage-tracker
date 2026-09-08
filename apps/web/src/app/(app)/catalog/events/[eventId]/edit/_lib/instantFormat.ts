import { instantToTokyoWallClock, type Instant } from "@stage-tracker/domain";

/** `<input type="datetime-local">` の defaultValue 用に、Asia/Tokyo の
 * wall-clock 表記（"YYYY-MM-DDTHH:mm"、秒無し）へ変換する。null は空文字
 * （未設定を表す）。 */
export function instantToDateTimeLocalValue(instant: Instant | null): string {
  if (instant === null) {
    return "";
  }
  const wall = instantToTokyoWallClock(instant);
  const pad2 = (value: number) => String(value).padStart(2, "0");
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}T${pad2(wall.hour)}:${pad2(wall.minute)}`;
}
