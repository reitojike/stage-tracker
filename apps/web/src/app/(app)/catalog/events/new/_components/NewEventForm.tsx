"use client";

import type { FormEvent } from "react";
import { useAction } from "next-safe-action/hooks";
import { Button, Field, Input, Textarea } from "@stage-tracker/ui";
import { createEventAction } from "@/lib/actions/events";
import { fieldErrorMessage } from "@/lib/actions/validationErrors";

/**
 * `/catalog/events/new` のフォーム本体（`specs/005-event-occurrence-lifecycle/spec.md`
 * 「Event 作成」）。バリデーションはサーバ側（`createEventInputSchema`）
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
          id="title"
          label="タイトル"
          required
          error={fieldErrorMessage(validationErrors, "title")}
        >
          <Input name="title" required />
        </Field>
        <Field id="venue" label="会場">
          <Input name="venue" />
        </Field>
        <Field
          id="sourceUrl"
          label="参照URL"
          error={fieldErrorMessage(validationErrors, "sourceUrl")}
        >
          <Input name="sourceUrl" type="url" />
        </Field>
        <Field id="memo" label="メモ">
          <Textarea name="memo" rows={3} />
        </Field>
      </fieldset>

      <fieldset disabled={isExecuting} className="flex flex-col gap-md">
        <legend className="text-title leading-title font-semibold text-foreground">
          開催期間
        </legend>
        <Field
          id="startsOn"
          label="開始日"
          required
          error={fieldErrorMessage(validationErrors, "startsOn")}
        >
          <Input name="startsOn" type="date" required />
        </Field>
        <Field
          id="endsOn"
          label="終了日"
          required
          error={fieldErrorMessage(validationErrors, "endsOn")}
        >
          <Input name="endsOn" type="date" required />
        </Field>
      </fieldset>

      <fieldset disabled={isExecuting} className="flex flex-col gap-md">
        <legend className="text-title leading-title font-semibold text-foreground">
          初回公演回（任意 - 未定なら空欄のままにできます）
        </legend>
        <Field
          id="occurrenceStartsAt"
          label="開演日時"
          error={fieldErrorMessage(validationErrors, "occurrenceStartsAt")}
        >
          <Input name="occurrenceStartsAt" type="datetime-local" />
        </Field>
        <Field
          id="occurrenceEndsAt"
          label="終演日時"
          error={fieldErrorMessage(validationErrors, "occurrenceEndsAt")}
        >
          <Input name="occurrenceEndsAt" type="datetime-local" />
        </Field>
        <Field
          id="occurrenceDoorsAt"
          label="開場日時"
          error={fieldErrorMessage(validationErrors, "occurrenceDoorsAt")}
        >
          <Input name="occurrenceDoorsAt" type="datetime-local" />
        </Field>
      </fieldset>

      <Button type="submit" disabled={isExecuting}>
        {isExecuting ? "作成中…" : "作成する"}
      </Button>
    </form>
  );
}
