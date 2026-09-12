"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import type { EventId } from "@stage-tracker/domain";
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
  const [successMessage, setSuccessMessage] = useState(false);
  const { execute, isExecuting, result, reset } = useAction(
    addOccurrenceAction,
    {
      onSuccess: () => {
        formRef.current?.reset();
        setSuccessMessage(true);
        router.refresh();
      },
    },
  );

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      reset();
      setSuccessMessage(false);
    }
  }

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setSuccessMessage(false);
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
              label="開演日時"
              name="startsAt"
              id={`${formId}-startsAt`}
              required
              disabled={isExecuting}
              error={fieldErrorMessage(validationErrors, "startsAt")}
            />
            <Field
              label="終演日時"
              name="endsAt"
              id={`${formId}-endsAt`}
              disabled={isExecuting}
              error={fieldErrorMessage(validationErrors, "endsAt")}
            />
            <Field
              label="開場日時"
              name="doorsAt"
              id={`${formId}-doorsAt`}
              disabled={isExecuting}
              error={fieldErrorMessage(validationErrors, "doorsAt")}
            />
            {result.serverError ? (
              <p role="alert" className="text-body-sm text-destructive">
                {result.serverError.message}
              </p>
            ) : null}
            {successMessage ? (
              <p role="status" className="text-body-sm text-muted-foreground">
                公演回を追加しました。次の公演回を入力できます。
              </p>
            ) : null}
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

function Field({
  label,
  name,
  id,
  required = false,
  disabled,
  error,
}: {
  label: string;
  name: string;
  id: string;
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
