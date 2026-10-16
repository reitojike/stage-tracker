"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { Button, Field, StatePanel } from "@stage-tracker/ui";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@stage-tracker/ui/components/sheet";
import type {
  PersonalScheduleEntryId,
  ScheduleContact,
} from "@stage-tracker/domain";
import { shareScheduleEntryWithContactAction } from "@/lib/actions/schedule/schedule-contact-actions";
import { fieldErrorMessage } from "@/lib/actions/validationErrors";

interface ShareAddFormProps {
  readonly entryId: PersonalScheduleEntryId;
  readonly contacts: readonly ScheduleContact[];
}

/** The server renders this selector only after a successful enabled contact read.
 * The action and DB independently check capability, ownership and generation. */
export function ShareAddForm({ entryId, contacts }: ShareAddFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const formId = `share-add-${entryId}`;
  const selectId = `share-contact-${entryId}`;
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { execute, result, isExecuting, reset } = useAction(
    shareScheduleEntryWithContactAction,
    {
      onSuccess: () => {
        formRef.current?.reset();
        setOpen(false);
        router.refresh();
      },
      onError: () => router.refresh(),
    },
  );
  const error = fieldErrorMessage(result.validationErrors, "contactId")
    ? "共有する相手を選択してください。"
    : undefined;
  function handleOpenChange(nextOpen: boolean) {
    if (isExecuting) return;
    setOpen(nextOpen);
    if (!nextOpen) reset();
  }
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const contactId = new FormData(event.currentTarget).get("contactId");
    execute({
      entryId,
      contactId: typeof contactId === "string" ? contactId : "",
    });
  }
  if (contacts.length === 0)
    return (
      <div className="flex flex-col gap-xs">
        <StatePanel variant="empty" title="登録済みの共有相手がいません" />
        <Link
          className="text-body-sm underline"
          href="/mypage/schedule-contacts"
        >
          共有相手を登録する
        </Link>
      </div>
    );
  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger
        render={
          <Button type="button" variant="ghost" aria-haspopup="dialog">
            + 追加
          </Button>
        }
      />
      <SheetContent side="bottom" showCloseButton={!isExecuting}>
        <SheetHeader>
          <SheetTitle>共有相手を追加</SheetTitle>
          <SheetDescription>
            登録済みの相手から選び、この予定だけを閲覧できるようにします。
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-md py-md">
          <form
            ref={formRef}
            id={formId}
            onSubmit={handleSubmit}
            className="flex flex-col gap-sm"
            noValidate
          >
            <Field id={selectId} label="共有する相手" required error={error}>
              <select
                id={selectId}
                name="contactId"
                defaultValue=""
                required
                disabled={isExecuting}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${selectId}-error` : undefined}
                className="h-9 w-full rounded-control border border-input bg-background px-sm text-body focus-visible:outline-ring"
              >
                <option value="">相手を選択してください</option>
                {contacts.map((contact) => (
                  <option key={contact.contactId} value={contact.contactId}>
                    {contact.ownAlias
                      ? `${contact.ownAlias}（${contact.counterpartEmail}）`
                      : contact.counterpartEmail}
                  </option>
                ))}
              </select>
            </Field>
            {result.serverError ? (
              <p role="alert" className="text-body-sm text-destructive">
                {result.serverError.message}
              </p>
            ) : null}
          </form>
        </div>
        <SheetFooter>
          <Button type="submit" form={formId} disabled={isExecuting}>
            {isExecuting ? "追加中…" : "追加する"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
