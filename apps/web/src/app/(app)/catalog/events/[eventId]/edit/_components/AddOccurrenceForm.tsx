"use client";

import { useRef, type FormEvent } from "react";
import { useAction } from "next-safe-action/hooks";
import type { EventId } from "@stage-tracker/domain";
import { Button } from "@stage-tracker/ui";
import { addOccurrenceAction } from "@/lib/actions/events";
import { fieldErrorMessage } from "@/lib/actions/validationErrors";

/**
 * 公演回の追加（`docs/v2/oracle-routes-ui.md` §2「occurrence 追加/更新」:
 * 追加成功後はフィールドをクリアして次の追加に備える）。
 */
export function AddOccurrenceForm({ eventId }: { eventId: EventId }) {
  const formRef = useRef<HTMLFormElement>(null);
  const { execute, isExecuting, result } = useAction(addOccurrenceAction, {
    onSuccess: () => formRef.current?.reset(),
  });

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const formData = new FormData(formEvent.currentTarget);
    execute({
      eventId,
      startsAt: String(formData.get("startsAt") ?? ""),
      endsAt: String(formData.get("endsAt") ?? ""),
      doorsAt: String(formData.get("doorsAt") ?? ""),
    });
  }

  const validationErrors = result.validationErrors;

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="flex flex-col gap-sm border border-dashed border-border p-md"
    >
      <h3 className="text-body font-medium text-foreground">公演回を追加</h3>
      <Field
        label="開演日時"
        name="startsAt"
        required
        error={fieldErrorMessage(validationErrors, "startsAt")}
      />
      <Field
        label="終演日時"
        name="endsAt"
        error={fieldErrorMessage(validationErrors, "endsAt")}
      />
      <Field
        label="開場日時"
        name="doorsAt"
        error={fieldErrorMessage(validationErrors, "doorsAt")}
      />
      {result.serverError ? (
        <p role="alert" className="text-body-sm text-destructive">
          {result.serverError.message}
        </p>
      ) : null}
      <Button type="submit" variant="outline" disabled={isExecuting}>
        {isExecuting ? "追加中…" : "追加する"}
      </Button>
    </form>
  );
}

function Field({
  label,
  name,
  required = false,
  error,
}: {
  label: string;
  name: string;
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
