import { z } from "zod";
import {
  err,
  ok,
  personalScheduleEntryIdSchema,
  personalScheduleEntryTemporalSchema,
  tokyoWallClockToInstant,
  type PersonalScheduleEntryTemporal,
  type Result,
} from "@stage-tracker/domain";

/**
 * `/schedule/new` と `/schedule/[entryId]/edit` が共有するフォーム入力の
 * 生形。両画面ともバリデーションルールは共通（oracle-routes-ui.md §2
 * 「予定作成」「予定編集」: 件名必須、temporalMode 必須、all-day なら
 * 開始日必須＋終了日≧開始日、time-bounded なら開始日時必須＋
 * 終了日時≧開始日時）。
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

const DATETIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u;

/**
 * `<input type="datetime-local">` の値（オフセットなし、Asia/Tokyo の
 * ローカル壁時計時刻として入力される）を `Instant` へ変換する。
 * `tokyoWallClockToInstant`（`@stage-tracker/domain`）がまさにこの
 * 変換を提供している - 秒/ミリ秒は datetime-local に存在しないため
 * 既定の 0 に委ねる。
 */
function parseDatetimeLocalAsTokyoInstant(raw: string): Result<string, string> {
  const match = DATETIME_LOCAL_PATTERN.exec(raw);
  if (match === null) {
    return err("日時の形式が正しくありません。");
  }
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match;
  if (
    yearStr === undefined ||
    monthStr === undefined ||
    dayStr === undefined ||
    hourStr === undefined ||
    minuteStr === undefined
  ) {
    return err("日時の形式が正しくありません。");
  }
  const result = tokyoWallClockToInstant({
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
    hour: Number(hourStr),
    minute: Number(minuteStr),
  });
  if (!result.ok) {
    return err("実在する日時を入力してください。");
  }
  return ok(result.value);
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
    // 終了日省略時は開始日と同日（product-rules.md「単発の公演は…」と同じ
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
  const startsAtResult = parseDatetimeLocalAsTokyoInstant(startsAtRaw);
  if (!startsAtResult.ok) {
    return err({ field: "timeBoundedStartsAt", message: startsAtResult.error });
  }

  const endsAtRaw = input.timeBoundedEndsAt?.trim();
  let endsAt: string | null = null;
  if (endsAtRaw !== undefined && endsAtRaw.length > 0) {
    const endsAtResult = parseDatetimeLocalAsTokyoInstant(endsAtRaw);
    if (!endsAtResult.ok) {
      return err({ field: "timeBoundedEndsAt", message: endsAtResult.error });
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
const scheduleEntryBaseShape = {
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
};

/**
 * `parseScheduleEntryTemporal` の失敗結果を zod issue へ変換する共有
 * helper（`{code:"custom", path, message}` の組み立てだけを共通化する）。
 * `superRefine` の callback 自体は `scheduleEntryFormSchema` /
 * `scheduleEntryFormWithIdSchema` それぞれで inline に定義する - zod v4 の
 * `z.object<Shape>()` は generic な `Shape` に対しては output 型を
 * `Record<keyof Shape & string, unknown>` 相当までしか解決できず、
 * `ScheduleEntryFormInput` として扱えなくなるため、generic 関数への
 * 抽出は行わず、TS の contextual typing に `data`/`ctx` の型推論を
 * 任せる（zod 自身の `personalScheduleEntryTemporalSchema` の
 * `superRefine` と同じ書き方）。
 */
function addTemporalIssue(
  result: ReturnType<typeof parseScheduleEntryTemporal>,
  addIssue: (issue: {
    code: "custom";
    path: string[];
    message: string;
  }) => void,
): void {
  if (!result.ok) {
    addIssue({
      code: "custom",
      path: [result.error.field],
      message: result.error.message,
    });
  }
}

export const scheduleEntryFormSchema = z
  .object(scheduleEntryBaseShape)
  .superRefine((data, ctx) => {
    addTemporalIssue(parseScheduleEntryTemporal(data), (issue) =>
      ctx.addIssue(issue),
    );
  });

export type ScheduleEntryFormValues = z.infer<typeof scheduleEntryFormSchema>;

/**
 * `/schedule/[entryId]/edit` 用: 同じフィールド集合に `entryId` を追加した
 * schema。`scheduleEntryFormSchema.and(z.object({entryId: ...}))`
 * （intersection）ではなく、同じ base shape を展開したフラットな
 * `z.object` にしているのは、`next-safe-action` のデフォルト
 * （nested）validation error 形状を create/edit の両フォームで同一に保ち、
 * 画面側の field error 読み取りヘルパーを1つに共通化するため
 * （intersection だと validationErrors のノード構造が両辺の合成になり、
 * フラットな `{ title: {...}, allDayStartsOn: {...} }` という前提が
 * 崩れる）。
 */
export const scheduleEntryFormWithIdSchema = z
  .object({ ...scheduleEntryBaseShape, entryId: personalScheduleEntryIdSchema })
  .superRefine((data, ctx) => {
    addTemporalIssue(parseScheduleEntryTemporal(data), (issue) =>
      ctx.addIssue(issue),
    );
  });

/** `memo` の空文字は「未入力」= `null` として永続化する（product は空文字とnullを二重化しない）。 */
export function normalizeMemo(memo: string | undefined): string | null {
  if (memo === undefined || memo.length === 0) {
    return null;
  }
  return memo;
}
