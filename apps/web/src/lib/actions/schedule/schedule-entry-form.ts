import { z } from "zod";
import {
  err,
  ok,
  personalScheduleEntryIdSchema,
  personalScheduleEntryTemporalSchema,
  type PersonalScheduleEntryTemporal,
  type Result,
} from "@stage-tracker/domain";
import { parseDateTimeLocal } from "../../datetime-local";

/**
 * `/schedule/new` と `/schedule/[entryId]/edit` が共有するフォーム入力の
 * 生形。両画面ともバリデーションルールは共通: 件名必須、temporalMode 必須、all-day なら
 * 開始日必須＋終了日≧開始日、time-bounded なら開始日時必須＋
 * 終了日時≧開始日時。
 *
 * `allDayStartsOn`/`allDayEndsOn` は `<input type="date">` の値
 * （"YYYY-MM-DD"）、`timeBoundedStartsAt`/`timeBoundedEndsAt` は
 * `<input type="datetime-local">` の値（"YYYY-MM-DDTHH:mm"、秒なし）
 * をそのまま渡す。
 */
export interface ScheduleEntryFormInput {
  readonly temporalMode: "all-day" | "time-bounded";
  readonly allDayStartsOn?: string | undefined;
  readonly allDayEndsOn?: string | undefined;
  readonly timeBoundedStartsAt?: string | undefined;
  readonly timeBoundedEndsAt?: string | undefined;
}

export interface ScheduleEntryFormFieldError {
  readonly field:
    | "allDayStartsOn"
    | "allDayEndsOn"
    | "timeBoundedStartsAt"
    | "timeBoundedEndsAt";
  readonly message: string;
}

/**
 * フォーム入力から `PersonalScheduleEntryTemporal`（domain の discriminated
 * union）を組み立てる純粋関数。ここでは zod の schema オブジェクトを直接
 * 触らず、`Result` を返すだけにして単体テストしやすくしている
 * （呼び出し元の `scheduleEntryInputSchema` の `superRefine` がこれを
 * `ctx.addIssue` へ橋渡しする）。
 *
 * 開始日≦終了日 / 開始日時≦終了日時の順序チェックは、ここで独自に
 * 再実装せず `personalScheduleEntryTemporalSchema`
 * （`@stage-tracker/domain`）に委譲する - product invariant の
 * canonical source を domain 側の1箇所に保つため。
 */
export function parseScheduleEntryTemporal(
  input: ScheduleEntryFormInput,
): Result<PersonalScheduleEntryTemporal, ScheduleEntryFormFieldError> {
  if (input.temporalMode === "all-day") {
    const startsOn = input.allDayStartsOn?.trim();
    if (startsOn === undefined || startsOn.length === 0) {
      return err({
        field: "allDayStartsOn",
        message: "開始日を入力してください。",
      });
    }
    // 終了日省略時は開始日と同日（Spec 007 の単日 lifecycle semantics と同じ
    // 「単日は startsOn === endsOn」慣習）。
    const endsOnRaw = input.allDayEndsOn?.trim();
    const endsOn =
      endsOnRaw === undefined || endsOnRaw.length === 0 ? startsOn : endsOnRaw;

    const parsed = personalScheduleEntryTemporalSchema.safeParse({
      kind: "all-day",
      startsOn,
      endsOn,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field =
        issue?.path[0] === "endsOn" ? "allDayEndsOn" : "allDayStartsOn";
      // issue.message は使わない。domain schema のメッセージは invariant を
      // 説明する開発者向けの英語（"endsOn must be on or after startsOn."）で
      // あって画面表示用ではなく、そのまま出すとユーザーに英語が見える。
      // どのフィールドが問題かは path から分かるので、表示文言はこの層が持つ。
      return err({
        field,
        message:
          field === "allDayEndsOn"
            ? "終了日は開始日以降の日付を入力してください。"
            : "開始日・終了日を確認してください。",
      });
    }
    return ok(parsed.data);
  }

  const startsAtRaw = input.timeBoundedStartsAt?.trim();
  if (startsAtRaw === undefined || startsAtRaw.length === 0) {
    return err({
      field: "timeBoundedStartsAt",
      message: "開始日時を入力してください。",
    });
  }
  const startsAtResult = parseDateTimeLocal(startsAtRaw, {
    syntax: "minute-only",
  });
  if (startsAtResult.kind !== "ok") {
    return err({
      field: "timeBoundedStartsAt",
      message:
        startsAtResult.kind === "invalid-format"
          ? "日時の形式が正しくありません。"
          : "実在する日時を入力してください。",
    });
  }

  const endsAtRaw = input.timeBoundedEndsAt?.trim();
  let endsAt: string | null = null;
  if (endsAtRaw !== undefined && endsAtRaw.length > 0) {
    const endsAtResult = parseDateTimeLocal(endsAtRaw, {
      syntax: "minute-only",
    });
    if (endsAtResult.kind !== "ok") {
      return err({
        field: "timeBoundedEndsAt",
        message:
          endsAtResult.kind === "invalid-format"
            ? "日時の形式が正しくありません。"
            : "実在する日時を入力してください。",
      });
    }
    endsAt = endsAtResult.value;
  }

  const parsed = personalScheduleEntryTemporalSchema.safeParse({
    kind: "time-bounded",
    startsAt: startsAtResult.value,
    endsAt,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field =
      issue?.path[0] === "endsAt" ? "timeBoundedEndsAt" : "timeBoundedStartsAt";
    // all-day 側と同じ理由で issue.message は使わない（上のコメント参照）。
    return err({
      field,
      message:
        field === "timeBoundedEndsAt"
          ? "終了日時は開始日時以降の日時を入力してください。"
          : "開始日時・終了日時を確認してください。",
    });
  }
  return ok(parsed.data);
}

/**
 * `next-safe-action` の `.inputSchema()` に渡す Server Action 入力 schema。
 * 件名/メモ/blocking は素直な zod validation、temporal の妥当性は
 * `parseScheduleEntryTemporal` へ委譲して `ctx.addIssue` で該当フィールドへ
 * 差し戻す（`validationErrors` として画面がフィールド直下に表示できる形）。
 */
export const scheduleEntryFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "件名を入力してください。")
      .max(200, "件名は200文字以内で入力してください。"),
    memo: z
      .string()
      .trim()
      .max(2000, "メモは2000文字以内で入力してください。")
      .optional(),
    blocking: z.boolean(),
    temporalMode: z.enum(
      ["all-day", "time-bounded"],
      "予定の種類を選択してください。",
    ),
    allDayStartsOn: z.string().optional(),
    allDayEndsOn: z.string().optional(),
    timeBoundedStartsAt: z.string().optional(),
    timeBoundedEndsAt: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const result = parseScheduleEntryTemporal(data);
    if (!result.ok) {
      ctx.addIssue({
        code: "custom",
        path: [result.error.field],
        message: result.error.message,
      });
    }
  });

export type ScheduleEntryFormValues = z.infer<typeof scheduleEntryFormSchema>;

/**
 * `/schedule/[entryId]/edit` 用: 同じフィールド集合に `entryId` を追加した
 * schema。`safeExtend` で temporal refinement とフラットな field path を
 * 継承し、`entryId` の branded ID 型を維持する。
 */
export const scheduleEntryFormWithIdSchema = scheduleEntryFormSchema.safeExtend(
  {
    entryId: personalScheduleEntryIdSchema,
  },
);

/** `memo` の空文字は「未入力」= `null` として永続化する（product は空文字とnullを二重化しない）。 */
export function normalizeMemo(memo: string | undefined): string | null {
  if (memo === undefined || memo.length === 0) {
    return null;
  }
  return memo;
}
