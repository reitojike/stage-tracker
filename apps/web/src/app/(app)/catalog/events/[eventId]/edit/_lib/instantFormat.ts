import type { Instant } from "@stage-tracker/domain";
import { instantToDateTimeLocalValue as formatDateTimeLocalValue } from "@/lib/datetime-local-value";

/** `<input type="datetime-local">` の defaultValue 用に、Asia/Tokyo の
 * wall-clock 表記（"YYYY-MM-DDTHH:mm"、秒無し）へ変換する。null は空文字
 * （未設定を表す）。 */
export function instantToDateTimeLocalValue(instant: Instant | null): string {
  if (instant === null) {
    return "";
  }
  return formatDateTimeLocalValue(instant);
}
