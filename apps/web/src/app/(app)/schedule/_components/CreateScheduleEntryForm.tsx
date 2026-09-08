"use client";

import type { FormEvent } from "react";
import { useAction } from "next-safe-action/hooks";
import { Button } from "@stage-tracker/ui";
import { createScheduleEntryAction } from "@/lib/actions/schedule/schedule-entry-actions";
import {
  ScheduleEntryFields,
  readScheduleEntryFormData,
} from "./ScheduleEntryFields";
import { toScheduleEntryFieldErrorMap } from "./scheduleValidationErrors";

interface CreateScheduleEntryFormProps {
  /** `/calendar` の選択日から prefill（`?date=` が妥当な場合のみ渡される）。 */
  readonly prefillDate?: string | undefined;
}

/**
 * `/schedule/new`（`docs/v2/oracle-routes-ui.md` §1 `createScheduleEntryAction`)。
 * 成功時は action 自身が `/calendar` へ `redirect()` するため、この
 * コンポーネントは成功後の遷移を自前で行わない
 * （`next-safe-action` は Server Action 内の `redirect()` を
 * navigation として扱い、`serverError`/`validationErrors` とは別に
 * 処理する）。
 */
export function CreateScheduleEntryForm({
  prefillDate,
}: CreateScheduleEntryFormProps) {
  const { execute, result, isExecuting } = useAction(createScheduleEntryAction);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = readScheduleEntryFormData(
      new FormData(event.currentTarget),
    );
    execute(formData);
  }

  const fieldErrors = toScheduleEntryFieldErrorMap(result.validationErrors);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {result.serverError ? (
        <p role="alert" className="text-body-sm text-destructive">
          {result.serverError.message}
        </p>
      ) : null}
      <ScheduleEntryFields
        defaultValues={{
          temporalMode: "all-day",
          allDayStartsOn: prefillDate,
          allDayEndsOn: prefillDate,
        }}
        fieldErrors={fieldErrors}
        disabled={isExecuting}
      />
      <Button type="submit" disabled={isExecuting}>
        {isExecuting ? "作成中…" : "作成する"}
      </Button>
    </form>
  );
}
