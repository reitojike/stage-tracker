"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Button, Field, Input } from "@stage-tracker/ui";
import {
  cancelScheduleContactRequestAction,
  requestScheduleContactAction,
} from "@/lib/actions/schedule/schedule-contact-actions";
import { fieldErrorMessage } from "@/lib/actions/validationErrors";

export function RequestContactForm() {
  const [email, setEmail] = useState("");
  const router = useRouter();
  const [mode, setMode] = useState<"request" | "cancel">("request");
  const [notice, setNotice] = useState<string | null>(null);
  const request = useAction(requestScheduleContactAction, {
    onSuccess: () => {
      setEmail("");
      setNotice("申請を受け付けました。");
      router.refresh();
    },
  });
  const cancel = useAction(cancelScheduleContactRequestAction, {
    onSuccess: () => {
      setEmail("");
      setNotice("取消の操作を受け付けました。");
      router.refresh();
    },
  });
  const busy = request.isExecuting || cancel.isExecuting;
  const result = mode === "request" ? request.result : cancel.result;
  function submit(next: "request" | "cancel") {
    if (busy) return;
    setNotice(null);
    setMode(next);
    request.reset();
    cancel.reset();
    (next === "request" ? request : cancel).execute({
      recipientEmail: email,
    });
  }
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit("request");
  }
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-sm">
      <Field
        id="contact-request-email"
        label="相手の登録メールアドレス"
        required
        description="最初の登録申請にだけ使います。取消も、申請時に入力したアドレスを指定してください。"
        error={
          fieldErrorMessage(result.validationErrors, "recipientEmail")
            ? "メールアドレスを確認してください。"
            : undefined
        }
      >
        <Input
          name="recipientEmail"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          type="email"
          autoComplete="off"
          required
          disabled={busy}
        />
      </Field>
      <div className="flex flex-wrap gap-sm">
        <Button type="submit" disabled={busy}>
          {request.isExecuting ? "申請中…" : "登録を申請する"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => submit("cancel")}
        >
          {cancel.isExecuting ? "取消中…" : "申請を取り消す"}
        </Button>
      </div>
      {result.serverError ? (
        <p role="alert" className="text-body-sm text-destructive">
          {result.serverError.message}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-body-sm">
          {notice}
        </p>
      ) : null}
    </form>
  );
}
