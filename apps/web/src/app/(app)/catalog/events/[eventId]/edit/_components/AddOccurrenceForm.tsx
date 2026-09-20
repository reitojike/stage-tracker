"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import type { EventId } from "@stage-tracker/domain";
import { Button, Field, Input, WriteNotice } from "@stage-tracker/ui";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@stage-tracker/ui/components/sheet";
import { addOccurrenceAction } from "@/lib/actions/events";
import { fieldErrorMessage } from "@/lib/actions/validationErrors";

/**
 * 公演回の追加（`docs/v2/oracle-routes-ui.md` §2「occurrence 追加/更新」:
 * 追加成功後はフィールドをクリアして次の追加に備える）。
 *
 * 追加は成功しても Sheet を閉じない。入力を reset して、同じ Sheet から
 * 次の公演回を続けて追加できることが Oracle の success contract である。
 */
export function AddOccurrenceForm({ eventId }: { eventId: EventId }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { execute, isExecuting, result, reset } = useAction(
    addOccurrenceAction,
    {
      onSuccess: () => {
        formRef.current?.reset();
        setNotice("公演回を追加しました。次の公演回を入力できます。");
        setAttempt((value) => value + 1);
        router.refresh();
      },
    },
  );

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      reset();
      setNotice(null);
    }
  }

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setNotice(null);
    const formData = new FormData(formEvent.currentTarget);
    execute({
      eventId,
      startsAt: String(formData.get("startsAt") ?? ""),
      endsAt: String(formData.get("endsAt") ?? ""),
      doorsAt: String(formData.get("doorsAt") ?? ""),
    });
  }

  const validationErrors = result.validationErrors;
  const formId = `occurrence-add-form-${eventId}`;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger
        render={
          <Button type="button" variant="outline" aria-haspopup="dialog">
            ＋ 公演回を追加
          </Button>
        }
      />
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>公演回を追加</SheetTitle>
          <SheetDescription>
            開場・終演が未公表の場合は空欄のまま登録できます。すべて日本時間（Asia/Tokyo）です。
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-md py-md">
          <form
            ref={formRef}
            id={formId}
            onSubmit={handleSubmit}
            className="flex flex-col gap-sm"
            aria-busy={isExecuting}
          >
            <Field
              id={`${formId}-startsAt`}
              label="開演日時"
              required
              error={fieldErrorMessage(validationErrors, "startsAt")}
            >
              <Input
                name="startsAt"
                type="datetime-local"
                required
                disabled={isExecuting}
              />
            </Field>
            <Field
              id={`${formId}-endsAt`}
              label="終演日時"
              error={fieldErrorMessage(validationErrors, "endsAt")}
            >
              <Input
                name="endsAt"
                type="datetime-local"
                disabled={isExecuting}
              />
            </Field>
            <Field
              id={`${formId}-doorsAt`}
              label="開場日時"
              error={fieldErrorMessage(validationErrors, "doorsAt")}
            >
              <Input
                name="doorsAt"
                type="datetime-local"
                disabled={isExecuting}
              />
            </Field>
            {result.serverError ? (
              <p role="alert" className="text-body-sm text-destructive">
                {result.serverError.message}
              </p>
            ) : null}
            <WriteNotice notice={notice} attempt={attempt} />
          </form>
        </div>
        <SheetFooter>
          <Button type="submit" form={formId} disabled={isExecuting}>
            {isExecuting ? "追加中…" : "公演回を追加"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
