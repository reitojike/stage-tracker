/**
 * `next-safe-action` の既定（nested）validation error 形状
 * （`{ fieldName: { _errors: string[] } }`）から、`ScheduleEntryFields` が
 * 表示する「フィールド名 → 先頭エラーメッセージ」の平坦な map を作る。
 *
 * `scheduleEntryFormSchema` と `scheduleEntryFormWithIdSchema`
 * （`@/lib/actions/schedule/schedule-entry-form`）はどちらもフラットな
 * `z.object`（intersection ではない）なので、この読み取りロジックを
 * create/edit の両フォームで共通化できる - 詳細は
 * `schedule-entry-form.ts` の `scheduleEntryFormWithIdSchema` doc comment
 * を参照。
 */
export interface ScheduleEntryFieldErrorMap {
  readonly title?: string;
  readonly memo?: string;
  readonly temporalMode?: string;
  readonly allDayStartsOn?: string;
  readonly allDayEndsOn?: string;
  readonly timeBoundedStartsAt?: string;
  readonly timeBoundedEndsAt?: string;
}

const FIELD_NAMES = [
  "title",
  "memo",
  "temporalMode",
  "allDayStartsOn",
  "allDayEndsOn",
  "timeBoundedStartsAt",
  "timeBoundedEndsAt",
] as const;

export function toScheduleEntryFieldErrorMap(
  validationErrors: unknown,
): ScheduleEntryFieldErrorMap {
  if (typeof validationErrors !== "object" || validationErrors === null) {
    return {};
  }
  const record = validationErrors as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const field of FIELD_NAMES) {
    const node = record[field];
    if (typeof node !== "object" || node === null) {
      continue;
    }
    const errors = (node as { _errors?: unknown })._errors;
    if (Array.isArray(errors) && typeof errors[0] === "string") {
      result[field] = errors[0];
    }
  }
  return result;
}
