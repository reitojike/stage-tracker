"use client";

import { useState } from "react";
import { CheckboxField, TextAreaField, TextField } from "./FormField";
import type { ScheduleEntryFieldErrorMap } from "./scheduleValidationErrors";

/**
 * `/schedule/new` と `/schedule/[entryId]/edit` が共有するフィールド集合
 * （`docs/v2/oracle-routes-ui.md` §2「予定作成」「予定編集」:
 * 「バリデーションルールは作成フォームと共通」）。
 *
 * temporalMode の radio 切替に応じて all-day/time-bounded の入力群を
 * 出し分けるためだけの client state を持つ - それ以外は uncontrolled
 * （`defaultValue`/`defaultChecked`、送信時に親が `FormData` から読む）。
 */
export interface ScheduleEntryDefaultValues {
  readonly title?: string | undefined;
  readonly memo?: string | undefined;
  readonly blocking?: boolean | undefined;
  readonly temporalMode?: "all-day" | "time-bounded" | undefined;
  readonly allDayStartsOn?: string | undefined;
  readonly allDayEndsOn?: string | undefined;
  readonly timeBoundedStartsAt?: string | undefined;
  readonly timeBoundedEndsAt?: string | undefined;
}

interface ScheduleEntryFieldsProps {
  readonly defaultValues?: ScheduleEntryDefaultValues;
  readonly fieldErrors?: ScheduleEntryFieldErrorMap;
  readonly disabled?: boolean;
}

export function ScheduleEntryFields({
  defaultValues,
  fieldErrors,
  disabled,
}: ScheduleEntryFieldsProps) {
  const [temporalMode, setTemporalMode] = useState<"all-day" | "time-bounded">(
    defaultValues?.temporalMode ?? "all-day",
  );

  return (
    <fieldset
      disabled={disabled}
      className="flex flex-col gap-4 border-none p-0"
    >
      <TextField
        id="title"
        name="title"
        label="件名"
        required
        defaultValue={defaultValues?.title}
        error={fieldErrors?.title}
      />
      <TextAreaField
        id="memo"
        name="memo"
        label="メモ"
        defaultValue={defaultValues?.memo}
        error={fieldErrors?.memo}
      />
      <CheckboxField
        id="blocking"
        name="blocking"
        label="この予定がある間は空き時間として扱わない（blocking）"
        helperText="オフにすると、一覧には表示されますが空き時間の扱いは変わりません。共有先にも同じ設定がそのまま伝わります。"
        defaultChecked={defaultValues?.blocking ?? true}
      />

      <div
        role="radiogroup"
        aria-label="予定の種類"
        className="flex flex-col gap-2"
      >
        <span className="text-label font-medium text-foreground">
          予定の種類
          <span aria-hidden className="text-destructive">
            {" "}
            *
          </span>
        </span>
        <label className="flex items-center gap-2 text-body-sm text-foreground">
          <input
            type="radio"
            name="temporalMode"
            value="all-day"
            checked={temporalMode === "all-day"}
            onChange={() => setTemporalMode("all-day")}
          />
          終日
        </label>
        <label className="flex items-center gap-2 text-body-sm text-foreground">
          <input
            type="radio"
            name="temporalMode"
            value="time-bounded"
            checked={temporalMode === "time-bounded"}
            onChange={() => setTemporalMode("time-bounded")}
          />
          時刻指定
        </label>
        {fieldErrors?.temporalMode ? (
          <p role="alert" className="text-body-sm text-destructive">
            {fieldErrors.temporalMode}
          </p>
        ) : null}
      </div>

      {temporalMode === "all-day" ? (
        <>
          <TextField
            id="allDayStartsOn"
            name="allDayStartsOn"
            type="date"
            label="開始日"
            required
            defaultValue={defaultValues?.allDayStartsOn}
            error={fieldErrors?.allDayStartsOn}
          />
          <TextField
            id="allDayEndsOn"
            name="allDayEndsOn"
            type="date"
            label="終了日"
            helperText="未入力の場合は開始日と同じ日になります。"
            defaultValue={defaultValues?.allDayEndsOn}
            error={fieldErrors?.allDayEndsOn}
          />
        </>
      ) : (
        <>
          <TextField
            id="timeBoundedStartsAt"
            name="timeBoundedStartsAt"
            type="datetime-local"
            label="開始日時"
            required
            defaultValue={defaultValues?.timeBoundedStartsAt}
            error={fieldErrors?.timeBoundedStartsAt}
          />
          <TextField
            id="timeBoundedEndsAt"
            name="timeBoundedEndsAt"
            type="datetime-local"
            label="終了日時"
            helperText="未定の場合は空欄のままにできます。"
            defaultValue={defaultValues?.timeBoundedEndsAt}
            error={fieldErrors?.timeBoundedEndsAt}
          />
        </>
      )}
    </fieldset>
  );
}

/**
 * submit ハンドラが読む生の `FormData` を、Server Action の入力形へ変換する
 * 共有ヘルパー。`blocking` は checkbox の有無（"on"/欠如）から boolean へ、
 * 各テキストフィールドは空文字を `undefined`（未入力）へ正規化する -
 * `scheduleEntryFormSchema`/`parseScheduleEntryTemporal` 側は「省略」と
 * 「空文字」を区別しないため、ここで単一の表現へ揃える。
 */
export function readScheduleEntryFormData(formData: FormData): {
  title: string;
  memo: string | undefined;
  blocking: boolean;
  temporalMode: "all-day" | "time-bounded";
  allDayStartsOn: string | undefined;
  allDayEndsOn: string | undefined;
  timeBoundedStartsAt: string | undefined;
  timeBoundedEndsAt: string | undefined;
} {
  const readOptional = (key: string): string | undefined => {
    const value = formData.get(key);
    if (typeof value !== "string" || value.trim().length === 0) {
      return undefined;
    }
    return value;
  };

  return {
    title: readOptional("title") ?? "",
    memo: readOptional("memo"),
    blocking: formData.get("blocking") === "on",
    temporalMode:
      formData.get("temporalMode") === "time-bounded"
        ? "time-bounded"
        : "all-day",
    allDayStartsOn: readOptional("allDayStartsOn"),
    allDayEndsOn: readOptional("allDayEndsOn"),
    timeBoundedStartsAt: readOptional("timeBoundedStartsAt"),
    timeBoundedEndsAt: readOptional("timeBoundedEndsAt"),
  };
}
