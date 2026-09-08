"use client";

import type { FormEvent } from "react";
import { useAction } from "next-safe-action/hooks";
import type { Event, Occurrence } from "@stage-tracker/domain";
import { Badge, Button } from "@stage-tracker/ui";
import {
  cancelEventAction,
  deleteEventAction,
  uncancelEventAction,
  updateEventDetailsAction,
  updateEventRangeAction,
} from "@/lib/actions/events";
import { fieldErrorMessage } from "@/lib/actions/validationErrors";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";
import { OccurrenceList } from "./OccurrenceList";

/**
 * `/catalog/events/[eventId]/edit` の owner 専用フォーム群
 * （`docs/v2/oracle-routes-ui.md` §2「Event 編集」）。
 *
 * - 詳細編集/期間編集: 成功時は画面に留まり、簡易な成功メッセージで通知
 *   （`WriteNotice` 相当。専用 `aria-live` component は `packages/ui` に
 *   まだ無く、この Task の編集許可範囲にも含まれないため、role属性付きの
 *   plain text で代替する — このタスクの報告に discretion として記録する）。
 * - 中止/解除: 確認ダイアログなし（可逆操作）。
 * - 削除: 確認 Sheet 相当（`ConfirmDeleteButton`）必須。成功時
 *   `deleteEventAction` 自身が `/catalog` へ redirect する。
 */
export function EditEventForm({
  event,
  occurrences,
}: {
  event: Event;
  occurrences: readonly Occurrence[];
}) {
  const detailsAction = useAction(updateEventDetailsAction);
  const rangeAction = useAction(updateEventRangeAction);
  const cancelAction = useAction(cancelEventAction);
  const uncancelAction = useAction(uncancelEventAction);
  const deleteAction = useAction(deleteEventAction);

  function handleDetailsSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const formData = new FormData(formEvent.currentTarget);
    detailsAction.execute({
      eventId: event.id,
      title: String(formData.get("title") ?? ""),
      venue: String(formData.get("venue") ?? ""),
      sourceUrl: String(formData.get("sourceUrl") ?? ""),
      memo: String(formData.get("memo") ?? ""),
    });
  }

  function handleRangeSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const formData = new FormData(formEvent.currentTarget);
    rangeAction.execute({
      eventId: event.id,
      startsOn: String(formData.get("startsOn") ?? ""),
      endsOn: String(formData.get("endsOn") ?? ""),
    });
  }

  const isCanceled = event.canceledAt !== null;
  const detailsErrors = detailsAction.result.validationErrors;
  const rangeErrors = rangeAction.result.validationErrors;

  return (
    <div className="flex flex-col gap-lg">
      {isCanceled ? <Badge variant="terminal">中止</Badge> : null}

      <form
        onSubmit={handleDetailsSubmit}
        className="flex flex-col gap-md border-b-2 border-border pb-lg"
      >
        <h2 className="text-title leading-title font-semibold text-foreground">
          基本情報
        </h2>
        <EditField
          label="タイトル"
          name="title"
          defaultValue={event.title}
          required
          error={fieldErrorMessage(detailsErrors, "title")}
        />
        <EditField label="会場" name="venue" defaultValue={event.venue ?? ""} />
        <EditField
          label="参照URL"
          name="sourceUrl"
          type="url"
          defaultValue={event.sourceUrl ?? ""}
          error={fieldErrorMessage(detailsErrors, "sourceUrl")}
        />
        <label className="flex flex-col gap-xs text-body-sm">
          <span className="font-medium text-foreground">メモ</span>
          <textarea
            name="memo"
            rows={3}
            defaultValue={event.memo ?? ""}
            className="rounded-control border border-input bg-background p-sm text-body outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </label>
        {detailsAction.result.serverError ? (
          <p role="alert" className="text-body-sm text-destructive">
            {detailsAction.result.serverError.message}
          </p>
        ) : null}
        {detailsAction.hasSucceeded ? (
          <p role="status" className="text-body-sm text-muted-foreground">
            保存しました。
          </p>
        ) : null}
        <Button type="submit" disabled={detailsAction.isExecuting}>
          {detailsAction.isExecuting ? "保存中…" : "基本情報を保存"}
        </Button>
      </form>

      <form
        onSubmit={handleRangeSubmit}
        className="flex flex-col gap-md border-b-2 border-border pb-lg"
      >
        <h2 className="text-title leading-title font-semibold text-foreground">
          開催期間
        </h2>
        <EditField
          label="開始日"
          name="startsOn"
          type="date"
          defaultValue={event.startsOn}
          required
          error={fieldErrorMessage(rangeErrors, "startsOn")}
        />
        <EditField
          label="終了日"
          name="endsOn"
          type="date"
          defaultValue={event.endsOn}
          required
          error={fieldErrorMessage(rangeErrors, "endsOn")}
        />
        {rangeAction.result.serverError ? (
          <p role="alert" className="text-body-sm text-destructive">
            {rangeAction.result.serverError.message}
          </p>
        ) : null}
        {rangeAction.hasSucceeded ? (
          <p role="status" className="text-body-sm text-muted-foreground">
            保存しました。
          </p>
        ) : null}
        <Button type="submit" disabled={rangeAction.isExecuting}>
          {rangeAction.isExecuting ? "保存中…" : "開催期間を保存"}
        </Button>
      </form>

      <div className="flex flex-col gap-sm border-b-2 border-border pb-lg">
        <h2 className="text-title leading-title font-semibold text-foreground">
          中止
        </h2>
        {isCanceled ? (
          <Button
            type="button"
            variant="outline"
            disabled={uncancelAction.isExecuting}
            onClick={() => uncancelAction.execute({ eventId: event.id })}
          >
            {uncancelAction.isExecuting ? "処理中…" : "中止を解除する"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={cancelAction.isExecuting}
            onClick={() => cancelAction.execute({ eventId: event.id })}
          >
            {cancelAction.isExecuting ? "処理中…" : "このイベントを中止にする"}
          </Button>
        )}
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

      <OccurrenceList
        eventId={event.id}
        eventRange={{ startsOn: event.startsOn, endsOn: event.endsOn }}
        occurrences={occurrences}
      />

      <div className="flex flex-col gap-sm">
        <h2 className="text-title leading-title font-semibold text-foreground">
          削除
        </h2>
        <ConfirmDeleteButton
          label="このイベントを削除する"
          confirmDescription="このイベントと、削除可能な公演回をまとめて削除します。この操作は取り消せません。"
          isExecuting={deleteAction.isExecuting}
          onConfirm={() => deleteAction.execute({ eventId: event.id })}
        />
        {deleteAction.result.serverError ? (
          <p role="alert" className="text-body-sm text-destructive">
            {deleteAction.result.serverError.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function EditField({
  label,
  name,
  type = "text",
  defaultValue,
  required = false,
  error,
}: {
  label: string;
  name: string;
  type?: string;
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
        type={type}
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
