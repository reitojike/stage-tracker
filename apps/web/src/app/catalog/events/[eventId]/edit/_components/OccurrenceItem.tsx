"use client";

import { useState, type FormEvent } from "react";
import { useAction } from "next-safe-action/hooks";
import type { EventId, Occurrence } from "@stage-tracker/domain";
import { Badge, Button } from "@stage-tracker/ui";
import {
  cancelEventOccurrenceAction,
  deleteEventOccurrenceAction,
  uncancelEventOccurrenceAction,
  updateOccurrenceAction,
} from "@/lib/actions/events";
import { fieldErrorMessage } from "@/lib/actions/validationErrors";
import { instantToDateTimeLocalValue } from "../_lib/instantFormat";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";

/**
 * 1件の occurrence の表示 + owner 操作（`docs/v2/oracle-routes-ui.md`
 * §2「Event 編集」: 更新成功後は値を保持したまま編集モードを閉じる、
 * 中止/解除はトグル・確認なし、削除は確認必須）。
 */
export function OccurrenceItem({
  eventId,
  occurrence,
}: {
  eventId: EventId;
  occurrence: Occurrence;
}) {
  const [editing, setEditing] = useState(false);
  const updateAction = useAction(updateOccurrenceAction, {
    onSuccess: () => setEditing(false),
  });
  const cancelAction = useAction(cancelEventOccurrenceAction);
  const uncancelAction = useAction(uncancelEventOccurrenceAction);
  const deleteAction = useAction(deleteEventOccurrenceAction);

  const isCanceled = occurrence.canceledAt !== null;

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const formData = new FormData(formEvent.currentTarget);
    updateAction.execute({
      occurrenceId: occurrence.id,
      startsAt: String(formData.get("startsAt") ?? ""),
      endsAt: String(formData.get("endsAt") ?? ""),
      doorsAt: String(formData.get("doorsAt") ?? ""),
    });
  }

  if (editing) {
    const validationErrors = updateAction.result.validationErrors;
    return (
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-sm border border-border p-md"
      >
        <OccurrenceField
          label="開演日時"
          name="startsAt"
          defaultValue={instantToDateTimeLocalValue(occurrence.startsAt)}
          required
          error={fieldErrorMessage(validationErrors, "startsAt")}
        />
        <OccurrenceField
          label="終演日時"
          name="endsAt"
          defaultValue={instantToDateTimeLocalValue(occurrence.endsAt)}
          error={fieldErrorMessage(validationErrors, "endsAt")}
        />
        <OccurrenceField
          label="開場日時"
          name="doorsAt"
          defaultValue={instantToDateTimeLocalValue(occurrence.doorsAt)}
          error={fieldErrorMessage(validationErrors, "doorsAt")}
        />
        {updateAction.result.serverError ? (
          <p role="alert" className="text-body-sm text-destructive">
            {updateAction.result.serverError.message}
          </p>
        ) : null}
        <div className="flex gap-sm">
          <Button type="submit" disabled={updateAction.isExecuting}>
            {updateAction.isExecuting ? "保存中…" : "保存"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={updateAction.isExecuting}
            onClick={() => setEditing(false)}
          >
            キャンセル
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-xs border-b border-border py-sm">
      <div className="flex items-center gap-sm">
        <span className="text-body text-foreground">
          {instantToDateTimeLocalValue(occurrence.startsAt).replace("T", " ")}
        </span>
        {isCanceled ? <Badge variant="terminal">中止</Badge> : null}
      </div>
      <div className="flex flex-wrap gap-sm">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditing(true)}
        >
          変更
        </Button>
        {isCanceled ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uncancelAction.isExecuting}
            onClick={() =>
              uncancelAction.execute({ occurrenceId: occurrence.id })
            }
          >
            {uncancelAction.isExecuting ? "処理中…" : "中止を解除"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={cancelAction.isExecuting}
            onClick={() =>
              cancelAction.execute({ occurrenceId: occurrence.id })
            }
          >
            {cancelAction.isExecuting ? "処理中…" : "中止にする"}
          </Button>
        )}
        <ConfirmDeleteButton
          label="この公演回を削除する"
          confirmDescription="参加・招待データが無い場合のみ削除できます。この操作は取り消せません。"
          isExecuting={deleteAction.isExecuting}
          onConfirm={() =>
            deleteAction.execute({ eventId, occurrenceId: occurrence.id })
          }
        />
      </div>
      {cancelAction.result.serverError ? (
        <p role="alert" className="text-body-sm text-destructive">
          {cancelAction.result.serverError.message}
        </p>
      ) : null}
      {uncancelAction.result.serverError ? (
        <p role="alert" className="text-body-sm text-destructive">
          {uncancelAction.result.serverError.message}
        </p>
      ) : null}
      {deleteAction.result.serverError ? (
        <p role="alert" className="text-body-sm text-destructive">
          {deleteAction.result.serverError.message}
        </p>
      ) : null}
    </div>
  );
}

function OccurrenceField({
  label,
  name,
  defaultValue,
  required = false,
  error,
}: {
  label: string;
  name: string;
  defaultValue: string;
  required?: boolean;
  error?: string | undefined;
}) {
  return (
    <label className="flex flex-col gap-xs text-body-sm">
      <span className="font-medium text-foreground">
        {label}
        {required ? (
          <span aria-hidden className="text-destructive">
            {" "}
            *
          </span>
        ) : null}
      </span>
      <input
        name={name}
        type="datetime-local"
        required={required}
        defaultValue={defaultValue}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? `${name}-error` : undefined}
        className="h-9 rounded-control border border-input bg-background px-sm text-body outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {error !== undefined ? (
        <span id={`${name}-error`} role="alert" className="text-destructive">
          {error}
        </span>
      ) : null}
    </label>
  );
}
