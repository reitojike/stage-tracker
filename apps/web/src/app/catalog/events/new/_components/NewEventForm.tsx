"use client";

import type { FormEvent } from "react";
import { useAction } from "next-safe-action/hooks";
import { Button } from "@stage-tracker/ui";
import { createEventAction } from "@/lib/actions/events";
import { fieldErrorMessage } from "@/lib/actions/validationErrors";

/**
 * `/catalog/events/new` のフォーム本体（`docs/v2/oracle-routes-ui.md`
 * §2「Event 作成」）。バリデーションはサーバ側（`createEventInputSchema`）
 * で行い、`fieldErrors` を各フィールド直下に表示する。全体エラーは
 * フォーム先頭に表示する。occurrence 欄は3つとも空なら「occurrence なし」
 * として受理される（Issue #87/#88）。
 */
export function NewEventForm() {
  const { execute, isExecuting, result } = useAction(createEventAction);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    execute({
      title: String(formData.get("title") ?? ""),
      venue: String(formData.get("venue") ?? ""),
      sourceUrl: String(formData.get("sourceUrl") ?? ""),
      memo: String(formData.get("memo") ?? ""),
      startsOn: String(formData.get("startsOn") ?? ""),
      endsOn: String(formData.get("endsOn") ?? ""),
      occurrenceStartsAt: String(formData.get("occurrenceStartsAt") ?? ""),
      occurrenceEndsAt: String(formData.get("occurrenceEndsAt") ?? ""),
      occurrenceDoorsAt: String(formData.get("occurrenceDoorsAt") ?? ""),
    });
  }

  const validationErrors = result.validationErrors;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-lg">
      {result.serverError ? (
        <p
          role="alert"
          className="rounded-control border border-destructive bg-destructive/10 p-compact text-body-sm text-destructive"
        >
          {result.serverError.message}
        </p>
      ) : null}

      <fieldset disabled={isExecuting} className="flex flex-col gap-md">
        <legend className="text-title leading-title font-semibold text-foreground">
          基本情報
        </legend>
        <Field
          label="タイトル"
          name="title"
          required
          error={fieldErrorMessage(validationErrors, "title")}
        />
        <Field label="会場" name="venue" />
        <Field
          label="参照URL"
          name="sourceUrl"
          type="url"
          error={fieldErrorMessage(validationErrors, "sourceUrl")}
        />
        <TextAreaField label="メモ" name="memo" />
      </fieldset>

      <fieldset disabled={isExecuting} className="flex flex-col gap-md">
        <legend className="text-title leading-title font-semibold text-foreground">
          開催期間
        </legend>
        <Field
          label="開始日"
          name="startsOn"
          type="date"
          required
          error={fieldErrorMessage(validationErrors, "startsOn")}
        />
        <Field
          label="終了日"
          name="endsOn"
          type="date"
          required
          error={fieldErrorMessage(validationErrors, "endsOn")}
        />
      </fieldset>

      <fieldset disabled={isExecuting} className="flex flex-col gap-md">
        <legend className="text-title leading-title font-semibold text-foreground">
          初回公演回（任意 - 未定なら空欄のままにできます）
        </legend>
        <Field
          label="開演日時"
          name="occurrenceStartsAt"
          type="datetime-local"
          error={fieldErrorMessage(validationErrors, "occurrenceStartsAt")}
        />
        <Field
          label="終演日時"
          name="occurrenceEndsAt"
          type="datetime-local"
          error={fieldErrorMessage(validationErrors, "occurrenceEndsAt")}
        />
        <Field
          label="開場日時"
          name="occurrenceDoorsAt"
          type="datetime-local"
          error={fieldErrorMessage(validationErrors, "occurrenceDoorsAt")}
        />
      </fieldset>

      <Button type="submit" disabled={isExecuting}>
        {isExecuting ? "作成中…" : "作成する"}
      </Button>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
  error,
}: {
  label: string;
  name: string;
  type?: string;
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

function TextAreaField({ label, name }: { label: string; name: string }) {
  return (
    <label className="flex flex-col gap-xs text-body-sm">
      <span className="font-medium text-foreground">{label}</span>
      <textarea
        name={name}
        rows={3}
        className="rounded-control border border-input bg-background p-sm text-body outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
    </label>
  );
}
