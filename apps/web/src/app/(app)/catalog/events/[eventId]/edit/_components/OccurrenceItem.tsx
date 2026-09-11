"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import type { EventId, Occurrence } from "@stage-tracker/domain";
import { Badge } from "@stage-tracker/ui";
import { Button } from "@stage-tracker/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@stage-tracker/ui/components/sheet";
import {
  cancelEventOccurrenceAction,
  deleteEventOccurrenceAction,
  uncancelEventOccurrenceAction,
  updateOccurrenceAction,
} from "@/lib/actions/events";
import { fieldErrorMessage } from "@/lib/actions/validationErrors";
import { instantToDateTimeLocalValue } from "../_lib/instantFormat";

/**
 * 1件の occurrence の表示 + owner 操作（`docs/v2/oracle-routes-ui.md`
 * §2「Event 編集」: 更新成功後は値を保持したまま編集 Sheet を閉じる、
 * 中止/解除はトグル・確認なし、削除は確認 Sheet 必須）。
 */
export function OccurrenceItem({
  eventId,
  occurrence,
}: {
  eventId: EventId;
  occurrence: Occurrence;
}) {
  const router = useRouter();
  const [updateOpen, setUpdateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const updateAction = useAction(updateOccurrenceAction, {
    onSuccess: () => {
      setUpdateOpen(false);
      router.refresh();
    },
  });
  const cancelAction = useAction(cancelEventOccurrenceAction);
  const uncancelAction = useAction(uncancelEventOccurrenceAction);
  const deleteAction = useAction(deleteEventOccurrenceAction, {
    onSuccess: () => {
      setDeleteOpen(false);
      router.refresh();
    },
  });

  const isCanceled = occurrence.canceledAt !== null;
  const updateFormId = `occurrence-update-form-${occurrence.id}`;

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

  function handleUpdateOpenChange(nextOpen: boolean) {
    setUpdateOpen(nextOpen);
    if (!nextOpen) {
      updateAction.reset();
    }
  }

  function handleDeleteOpenChange(nextOpen: boolean) {
    setDeleteOpen(nextOpen);
    if (!nextOpen) {
      deleteAction.reset();
    }
  }

  const validationErrors = updateAction.result.validationErrors;

  return (
    <div className="flex flex-col gap-xs border-b border-border py-sm">
      <div className="flex items-center gap-sm">
        <span className="text-body text-foreground">
          {instantToDateTimeLocalValue(occurrence.startsAt).replace("T", " ")}
        </span>
        {isCanceled ? <Badge variant="terminal">中止</Badge> : null}
      </div>
      <div className="flex flex-wrap gap-sm">
        <Sheet open={updateOpen} onOpenChange={handleUpdateOpenChange}>
          <SheetTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-haspopup="dialog"
              >
                変更
              </Button>
            }
          />
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>公演回を変更</SheetTitle>
              <SheetDescription>
                公演回の開場・開演・終演日時を変更します。すべて日本時間（Asia/Tokyo）です。
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-md py-md">
              <form
                id={updateFormId}
                onSubmit={handleSubmit}
                className="flex flex-col gap-sm"
                aria-busy={updateAction.isExecuting}
              >
                <OccurrenceField
                  label="開演日時"
                  name="startsAt"
                  id={`${updateFormId}-startsAt`}
                  defaultValue={instantToDateTimeLocalValue(
                    occurrence.startsAt,
                  )}
                  required
                  disabled={updateAction.isExecuting}
                  error={fieldErrorMessage(validationErrors, "startsAt")}
                />
                <OccurrenceField
                  label="終演日時"
                  name="endsAt"
                  id={`${updateFormId}-endsAt`}
                  defaultValue={instantToDateTimeLocalValue(occurrence.endsAt)}
                  disabled={updateAction.isExecuting}
                  error={fieldErrorMessage(validationErrors, "endsAt")}
                />
                <OccurrenceField
                  label="開場日時"
                  name="doorsAt"
                  id={`${updateFormId}-doorsAt`}
                  defaultValue={instantToDateTimeLocalValue(occurrence.doorsAt)}
                  disabled={updateAction.isExecuting}
                  error={fieldErrorMessage(validationErrors, "doorsAt")}
                />
                {updateAction.result.serverError ? (
                  <p role="alert" className="text-body-sm text-destructive">
                    {updateAction.result.serverError.message}
                  </p>
                ) : null}
              </form>
            </div>
            <SheetFooter>
              <Button
                type="submit"
                form={updateFormId}
                disabled={updateAction.isExecuting}
              >
                {updateAction.isExecuting ? "保存中…" : "保存"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={updateAction.isExecuting}
                onClick={() => setUpdateOpen(false)}
              >
                キャンセル
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
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
        <Sheet open={deleteOpen} onOpenChange={handleDeleteOpenChange}>
          <SheetTrigger
            render={
              <Button
                type="button"
                variant="destructive"
                size="sm"
                aria-haspopup="dialog"
              >
                この公演回を削除する
              </Button>
            }
          />
          <SheetContent side="bottom" showCloseButton={false}>
            <SheetHeader>
              <SheetTitle>この公演回を削除</SheetTitle>
              <SheetDescription>
                参加・招待データが無い場合のみ削除できます。この操作は取り消せません。よろしいですか？
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-md py-md">
              {deleteAction.result.serverError ? (
                <p role="alert" className="text-body-sm text-destructive">
                  {deleteAction.result.serverError.message}
                </p>
              ) : null}
            </div>
            <SheetFooter>
              <Button
                type="button"
                variant="destructive"
                disabled={deleteAction.isExecuting}
                onClick={() =>
                  deleteAction.execute({
                    eventId,
                    occurrenceId: occurrence.id,
                  })
                }
              >
                {deleteAction.isExecuting ? "削除中…" : "削除する"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={deleteAction.isExecuting}
                onClick={() => setDeleteOpen(false)}
              >
                キャンセル
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
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
    </div>
  );
}

function OccurrenceField({
  label,
  name,
  id,
  defaultValue,
  required = false,
  disabled,
  error,
}: {
  label: string;
  name: string;
  id: string;
  defaultValue: string;
  required?: boolean;
  disabled: boolean;
  error?: string | undefined;
}) {
  const errorId = `${id}-error`;

  return (
    <label htmlFor={id} className="flex flex-col gap-xs text-body-sm">
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
        id={id}
        name={name}
        type="datetime-local"
        required={required}
        defaultValue={defaultValue}
        disabled={disabled}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        className="h-9 rounded-control border border-input bg-background px-sm text-body outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {error !== undefined ? (
        <span id={errorId} role="alert" className="text-destructive">
          {error}
        </span>
      ) : null}
    </label>
  );
}
