"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { OccurrenceId } from "@stage-tracker/domain";
import { Button, Field, Input } from "@stage-tracker/ui";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@stage-tracker/ui/components/sheet";
import { inviteToOccurrenceAction } from "@/lib/actions/invitation.actions";

export interface InviteFormProps {
  readonly occurrenceId: OccurrenceId;
}

/**
 * `docs/v2/oracle-routes-ui.md` §2 イベント詳細の招待フォーム
 * （legacy の `InviteSheet` 相当）。Sheet は presentation と lifecycle
 * だけを担当し、招待 action と opacity semantics はこの consumer が持つ。
 *
 * **opacity（specs/001-occurrence-participation/spec.md の Invitation Requirements、`docs/v2/decisions.md`「踏んでは
 * いけない地雷」）**: 成功時は invitee の3分岐（行なし/considering/
 * attending）によらず常に同一の文言・同一のタイミングで完了する。
 * `inviteToOccurrenceAction` が返す成功値は `@stage-tracker/domain` の
 * `InviteOutcome`（`'invite-sent'` の単一リテラル）だけであり、
 * このコンポーネントはそれ以外の情報を使って表示を分岐させない
 * （分岐材料がそもそも無い）。
 */
export function InviteForm({ occurrenceId }: InviteFormProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(null);
    setOperationError(null);
    startTransition(async () => {
      const result = await inviteToOccurrenceAction({ occurrenceId, email });

      if (result?.serverError) {
        setOperationError(result.serverError.message);
        return;
      }
      if (result?.validationErrors) {
        setFieldError("メールアドレスの形式を確認してください。");
        return;
      }

      // 成功: invitee 側の実際の分岐に関わらず、常に同じタイミングで閉じる。
      setEmail("");
      setFieldError(null);
      setOperationError(null);
      setOpen(false);
    });
  }

  const fieldId = `invite-email-${occurrenceId}`;

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setFieldError(null);
            setOperationError(null);
          }
        }}
      >
        <SheetTrigger
          render={
            <Button type="button" size="sm" variant="ghost">
              招待する
            </Button>
          }
        />
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>招待する</SheetTitle>
            <SheetDescription className="sr-only">
              公演回へ招待するメールアドレスを入力します。
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-md py-md">
            <form
              id={`invite-form-${occurrenceId}`}
              onSubmit={handleSubmit}
              className="flex flex-col gap-xs"
              aria-busy={isPending}
            >
              <Field
                id={fieldId}
                label="招待するメールアドレス"
                error={fieldError}
              >
                <Input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  disabled={isPending}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
              {operationError ? (
                <p role="alert" className="text-body-sm text-destructive">
                  {operationError}
                </p>
              ) : null}
            </form>
          </div>
          <SheetFooter>
            <Button
              type="submit"
              form={`invite-form-${occurrenceId}`}
              disabled={isPending}
            >
              送信
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
