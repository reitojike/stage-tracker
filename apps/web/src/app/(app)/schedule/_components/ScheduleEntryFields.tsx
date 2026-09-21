"use client";

import { useState } from "react";
import {
  Checkbox,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  RadioChip,
  RadioGroup,
  Textarea,
} from "@stage-tracker/ui";
import type { ScheduleEntryFieldErrorMap } from "./scheduleValidationErrors";

/**
 * `/schedule/new` と `/schedule/[entryId]/edit` が共有する field and
 * validation implementation. Personal Schedule lifecycle semantics remain in
 * Spec 007; exact form mechanics are owned here.
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
      <Field id="title" label="件名" required error={fieldErrors?.title}>
        <Input name="title" required defaultValue={defaultValues?.title} />
      </Field>
      <Field id="memo" label="メモ" error={fieldErrors?.memo}>
        <Textarea name="memo" defaultValue={defaultValues?.memo} rows={3} />
      </Field>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Checkbox
            id="blocking"
            name="blocking"
            defaultChecked={defaultValues?.blocking ?? true}
            disabled={disabled}
            aria-describedby="blocking-helper"
          />
          <label htmlFor="blocking" className="text-body-sm text-foreground">
            この予定がある間は空き時間として扱わない（blocking）
          </label>
        </div>
        <FieldDescription id="blocking-helper">
          オフにすると、一覧には表示されますが空き時間の扱いは変わりません。共有先にも同じ設定がそのまま伝わります。
        </FieldDescription>
      </div>

      <fieldset className="flex flex-col gap-xs border-none p-0">
        <FieldLabel id="temporalMode-label" required>
          予定の種類
        </FieldLabel>
        <RadioGroup
          name="temporalMode"
          value={temporalMode}
          onValueChange={(value: "all-day" | "time-bounded") =>
            setTemporalMode(value)
          }
          disabled={disabled}
          required
          aria-labelledby="temporalMode-label"
          aria-invalid={fieldErrors?.temporalMode !== undefined || undefined}
          aria-describedby={
            fieldErrors?.temporalMode !== undefined
              ? "temporalMode-error"
              : undefined
          }
          className="flex flex-col gap-2"
        >
          <RadioChip value="all-day">終日</RadioChip>
          <RadioChip value="time-bounded">時刻指定</RadioChip>
        </RadioGroup>
        {fieldErrors?.temporalMode !== undefined ? (
          <FieldError id="temporalMode-error">
            {fieldErrors.temporalMode}
          </FieldError>
        ) : null}
      </fieldset>

      {temporalMode === "all-day" ? (
        <>
          <Field
            id="allDayStartsOn"
            label="開始日"
            required
            error={fieldErrors?.allDayStartsOn}
          >
            <Input
              name="allDayStartsOn"
              type="date"
              required
              defaultValue={defaultValues?.allDayStartsOn}
            />
          </Field>
          <Field
            id="allDayEndsOn"
            label="終了日"
            description="未入力の場合は開始日と同じ日になります。"
            error={fieldErrors?.allDayEndsOn}
          >
            <Input
              name="allDayEndsOn"
              type="date"
              defaultValue={defaultValues?.allDayEndsOn}
            />
          </Field>
        </>
      ) : (
        <>
          <Field
            id="timeBoundedStartsAt"
            label="開始日時"
            required
            error={fieldErrors?.timeBoundedStartsAt}
          >
            <Input
              name="timeBoundedStartsAt"
              type="datetime-local"
              required
              defaultValue={defaultValues?.timeBoundedStartsAt}
            />
          </Field>
          <Field
            id="timeBoundedEndsAt"
            label="終了日時"
            description="未定の場合は空欄のままにできます。"
            error={fieldErrors?.timeBoundedEndsAt}
          >
            <Input
              name="timeBoundedEndsAt"
              type="datetime-local"
              defaultValue={defaultValues?.timeBoundedEndsAt}
            />
          </Field>
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
    blocking: formData.has("blocking"),
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
