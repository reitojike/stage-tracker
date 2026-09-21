"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { isCanceled, type Event, type Occurrence } from "@stage-tracker/domain";
import {
  Badge,
  Field,
  Input,
  SectionHeading,
  Textarea,
  WriteNotice,
} from "@stage-tracker/ui";
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
import { formatTokyoCalendarDateRangeJa } from "@/lib/tokyo-format";
import {
  cancelEventAction,
  deleteEventAction,
  uncancelEventAction,
  updateEventDetailsAction,
  updateEventRangeAction,
} from "@/lib/actions/events";
import { fieldErrorMessage } from "@/lib/actions/validationErrors";
import { OccurrenceList } from "./OccurrenceList";

/**
 * `/catalog/events/[eventId]/edit` の owner 専用フォーム群。Event lifecycle
 * semantics follow Spec 005; exact form and Sheet behavior are runtime-owned.
 *
 * - 詳細編集: 成功時は画面に留まり、shared `WriteNotice` で通知する。
 * - 期間編集: runtime contract に従い shared Sheet 内のフォームで編集し、成功時に
 *   自動 close する。入力失敗時は Sheet を開いたままにする。
 * - 中止/解除: 確認ダイアログなし（可逆操作）。
 * - 削除: shared Sheet による明示的な確認が必須。成功時
 *   `deleteEventAction` 自身が `/catalog` へ redirect する。
 */
export function EditEventForm({
  event,
  occurrences,
}: {
  event: Event;
  occurrences: readonly Occurrence[];
}) {
  const router = useRouter();
  const [rangeOpen, setRangeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [detailsNotice, setDetailsNotice] = useState<string | null>(null);
  const [detailsAttempt, setDetailsAttempt] = useState(0);
  const [cancellationNotice, setCancellationNotice] = useState<string | null>(
    null,
  );
  const [cancellationAttempt, setCancellationAttempt] = useState(0);
  const detailsAction = useAction(updateEventDetailsAction, {
    onSuccess: () => {
      setDetailsNotice("保存しました。");
      setDetailsAttempt((value) => value + 1);
    },
  });
  const rangeAction = useAction(updateEventRangeAction, {
    onSuccess: () => {
      setRangeOpen(false);
      router.refresh();
    },
  });
  const cancelAction = useAction(cancelEventAction, {
    onSuccess: () => {
      setCancellationNotice("このイベントを中止にしました。");
      setCancellationAttempt((value) => value + 1);
      router.refresh();
    },
  });
  const uncancelAction = useAction(uncancelEventAction, {
    onSuccess: () => {
      setCancellationNotice("このイベントの中止を解除しました。");
      setCancellationAttempt((value) => value + 1);
      router.refresh();
    },
  });
  const deleteAction = useAction(deleteEventAction);

  function handleDetailsSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setDetailsNotice(null);
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

  const canceled = isCanceled(event);
  const detailsErrors = detailsAction.result.validationErrors;
  const rangeErrors = rangeAction.result.validationErrors;

  function handleRangeOpenChange(nextOpen: boolean) {
    setRangeOpen(nextOpen);
    if (!nextOpen) {
      rangeAction.reset();
    }
  }

  function handleDeleteOpenChange(nextOpen: boolean) {
    setDeleteOpen(nextOpen);
    if (!nextOpen) {
      deleteAction.reset();
    }
  }

  return (
    <div className="flex flex-col gap-lg">
      {canceled ? <Badge variant="terminal">中止</Badge> : null}

      <form
        onSubmit={handleDetailsSubmit}
        className="flex flex-col gap-md border-b-2 border-border pb-lg"
      >
        <SectionHeading>基本情報</SectionHeading>
        <Field
          id="event-edit-title"
          label="タイトル"
          required
          error={fieldErrorMessage(detailsErrors, "title")}
        >
          <Input name="title" defaultValue={event.title} required />
        </Field>
        <Field id="event-edit-venue" label="会場">
          <Input name="venue" defaultValue={event.venue ?? ""} />
        </Field>
        <Field
          id="event-edit-sourceUrl"
          label="参照URL"
          error={fieldErrorMessage(detailsErrors, "sourceUrl")}
        >
          <Input
            name="sourceUrl"
            type="url"
            defaultValue={event.sourceUrl ?? ""}
          />
        </Field>
        <Field id="event-edit-memo" label="メモ">
          <Textarea name="memo" rows={3} defaultValue={event.memo ?? ""} />
        </Field>
        {detailsAction.result.serverError ? (
          <p role="alert" className="text-body-sm text-destructive">
            {detailsAction.result.serverError.message}
          </p>
        ) : null}
        <WriteNotice notice={detailsNotice} attempt={detailsAttempt} />
        <Button type="submit" disabled={detailsAction.isExecuting}>
          {detailsAction.isExecuting ? "保存中…" : "基本情報を保存"}
        </Button>
      </form>

      <div className="flex flex-col gap-sm border-b-2 border-border pb-lg">
        <SectionHeading>開催期間</SectionHeading>
        <p className="text-body-sm text-muted-foreground">
          {formatTokyoCalendarDateRangeJa(event.startsOn, event.endsOn)}
        </p>
        <Sheet open={rangeOpen} onOpenChange={handleRangeOpenChange}>
          <SheetTrigger
            render={
              <Button type="button" variant="outline" aria-haspopup="dialog">
                開催期間を変更
              </Button>
            }
          />
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>開催期間を変更</SheetTitle>
              <SheetDescription>
                開催期間と公演回の日時を両方とも新しい期間へ移す場合は、先に開催期間を広げてください。
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-md py-md">
              <form
                id={`event-range-form-${event.id}`}
                onSubmit={handleRangeSubmit}
                className="flex flex-col gap-md"
                aria-busy={rangeAction.isExecuting}
              >
                <Field
                  id="event-edit-startsOn"
                  label="開始日"
                  required
                  error={fieldErrorMessage(rangeErrors, "startsOn")}
                >
                  <Input
                    name="startsOn"
                    type="date"
                    defaultValue={event.startsOn}
                    required
                  />
                </Field>
                <Field
                  id="event-edit-endsOn"
                  label="終了日"
                  required
                  error={fieldErrorMessage(rangeErrors, "endsOn")}
                >
                  <Input
                    name="endsOn"
                    type="date"
                    defaultValue={event.endsOn}
                    required
                  />
                </Field>
                {rangeAction.result.serverError ? (
                  <p role="alert" className="text-body-sm text-destructive">
                    {rangeAction.result.serverError.message}
                  </p>
                ) : null}
              </form>
            </div>
            <SheetFooter>
              <Button
                type="submit"
                form={`event-range-form-${event.id}`}
                disabled={rangeAction.isExecuting}
              >
                {rangeAction.isExecuting ? "保存中…" : "開催期間を保存"}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      <div className="flex flex-col gap-sm border-b-2 border-border pb-lg">
        <SectionHeading>中止</SectionHeading>
        <WriteNotice
          notice={cancellationNotice}
          attempt={cancellationAttempt}
        />
        {canceled ? (
          <Button
            type="button"
            variant="outline"
            disabled={uncancelAction.isExecuting}
            onClick={() => {
              setCancellationNotice(null);
              uncancelAction.execute({ eventId: event.id });
            }}
          >
            {uncancelAction.isExecuting ? "処理中…" : "中止を解除する"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={cancelAction.isExecuting}
            onClick={() => {
              setCancellationNotice(null);
              cancelAction.execute({ eventId: event.id });
            }}
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
        <SectionHeading>削除</SectionHeading>
        <Sheet open={deleteOpen} onOpenChange={handleDeleteOpenChange}>
          <SheetTrigger
            render={
              <Button
                type="button"
                variant="destructive"
                aria-haspopup="dialog"
              >
                このイベントを削除する
              </Button>
            }
          />
          <SheetContent side="bottom" showCloseButton={false}>
            <SheetHeader>
              <SheetTitle>このイベントを削除</SheetTitle>
              <SheetDescription>
                このイベントと、削除可能な公演回をまとめて削除します。この操作は取り消せません。よろしいですか？
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
                onClick={() => deleteAction.execute({ eventId: event.id })}
              >
                {deleteAction.isExecuting ? "削除中…" : "削除する"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={deleteAction.isExecuting}
                onClick={() => handleDeleteOpenChange(false)}
              >
                キャンセル
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
