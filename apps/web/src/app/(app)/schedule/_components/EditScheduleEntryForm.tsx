"use client";

import type { FormEvent } from "react";
import { useAction } from "next-safe-action/hooks";
import { Button } from "@stage-tracker/ui";
import type { PersonalScheduleEntry } from "@stage-tracker/domain";
import { updateScheduleEntryAction } from "@/lib/actions/schedule/schedule-entry-actions";
import {
  ScheduleEntryFields,
  readScheduleEntryFormData,
} from "./ScheduleEntryFields";
import { toScheduleEntryFieldErrorMap } from "./scheduleValidationErrors";
import { toScheduleEntryDefaultValues } from "./scheduleEntryDefaultValues";

interface EditScheduleEntryFormProps {
  readonly entry: PersonalScheduleEntry;
}

/**
 * `/schedule/[entryId]/edit`（owner専用、`docs/v2/oracle-routes-ui.md` §1
 * `updateScheduleEntryAction`）。owner 判定そのものはこのコンポーネントの
 * 責務ではなく、呼び出し元の page.tsx が owner でないと判断した場合は
 * このコンポーネント自体を描画しない（oracle §2「予定編集」: 「owner
 * 以外が直接 URL へ到達した場合、明示的な permission-denied パネルを
 * 表示（フォーム自体は描画しない）」）。
 */
export function EditScheduleEntryForm({ entry }: EditScheduleEntryFormProps) {
  const { execute, result, isExecuting } = useAction(updateScheduleEntryAction);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = readScheduleEntryFormData(
      new FormData(event.currentTarget),
    );
    execute({ ...formData, entryId: entry.id });
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
        defaultValues={toScheduleEntryDefaultValues(entry)}
        fieldErrors={fieldErrors}
        disabled={isExecuting}
      />
      <Button type="submit" disabled={isExecuting}>
        {isExecuting ? "保存中…" : "保存する"}
      </Button>
    </form>
  );
}
