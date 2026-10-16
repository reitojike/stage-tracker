"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Button, Field, Input, StatePanel } from "@stage-tracker/ui";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@stage-tracker/ui/components/sheet";
import type { ScheduleContact } from "@stage-tracker/domain";
import {
  setScheduleContactAliasAction,
  unlinkScheduleContactAction,
} from "@/lib/actions/schedule/schedule-contact-actions";
import { fieldErrorMessage } from "@/lib/actions/validationErrors";

function ContactAliasForm({ contact }: { readonly contact: ScheduleContact }) {
  const router = useRouter();
  const { execute, result, isExecuting } = useAction(
    setScheduleContactAliasAction,
    { onSuccess: () => router.refresh() },
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const alias = new FormData(event.currentTarget).get("alias");
    execute({
      contactId: contact.contactId,
      alias: typeof alias === "string" ? alias : "",
    });
  }
  return (
    <form
      key={contact.ownAlias ?? ""}
      onSubmit={submit}
      className="flex flex-col gap-sm"
      noValidate
    >
      <Field
        id={`contact-alias-${contact.contactId}`}
        label="自分用の呼び名"
        description="80文字以内。相手には表示されません。空欄で呼び名を消せます。"
        error={
          fieldErrorMessage(result.validationErrors, "alias")
            ? "呼び名を確認してください（80文字以内）。"
            : undefined
        }
      >
        <Input
          name="alias"
          defaultValue={contact.ownAlias ?? ""}
          disabled={isExecuting}
          autoComplete="off"
        />
      </Field>
      <Button type="submit" variant="outline" disabled={isExecuting}>
        {isExecuting ? "保存中…" : "呼び名を保存する"}
      </Button>
      {result.serverError ? (
        <p role="alert" className="text-body-sm text-destructive">
          {result.serverError.message}
        </p>
      ) : null}
    </form>
  );
}

function UnlinkContactButton({
  contact,
}: {
  readonly contact: ScheduleContact;
}) {
  const [open, setOpen] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const { execute, result, isExecuting, reset } = useAction(
    unlinkScheduleContactAction,
    {
      onSuccess: () => {
        setOpen(false);
        router.refresh();
      },
    },
  );
  const label = contact.ownAlias ?? contact.counterpartEmail;
  function changeOpen(next: boolean) {
    if (isExecuting) return;
    setOpen(next);
    if (!next) reset();
  }
  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetTrigger
        render={
          <Button
            type="button"
            variant="destructive"
            aria-haspopup="dialog"
            aria-label={`${label}の登録を解除`}
            disabled={isExecuting}
          >
            登録を解除する
          </Button>
        }
      />
      <SheetContent
        side="bottom"
        role="alertdialog"
        aria-label="共有相手の登録解除の確認"
        showCloseButton={false}
        initialFocus={cancel}
      >
        <SheetHeader>
          <SheetTitle>共有相手の登録を解除しますか？</SheetTitle>
          <SheetDescription>
            {label}
            と両方向で共有中の予定が互いに見られなくなります。予定本体は削除されません。再登録しても過去の共有は戻りません。
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-md py-md">
          {result.serverError ? (
            <p role="alert" className="text-body-sm text-destructive">
              {result.serverError.message}
            </p>
          ) : null}
        </div>
        <SheetFooter>
          <Button
            type="button"
            variant="destructive"
            disabled={isExecuting}
            onClick={() => execute({ contactId: contact.contactId })}
          >
            {isExecuting ? "解除中…" : "登録と両方向の共有を解除する"}
          </Button>
          <Button
            ref={cancel}
            type="button"
            variant="outline"
            disabled={isExecuting}
            onClick={() => changeOpen(false)}
          >
            キャンセル
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function ScheduleContactList({
  contacts,
}: {
  readonly contacts: readonly ScheduleContact[];
}) {
  if (contacts.length === 0)
    return <StatePanel variant="empty" title="登録済みの共有相手はいません" />;
  return (
    <ul className="flex flex-col gap-md">
      {contacts.map((contact) => (
        <li
          key={contact.contactId}
          className="flex flex-col gap-sm border-b border-border py-sm"
        >
          <p className="break-all text-body font-medium">
            {contact.ownAlias ?? contact.counterpartEmail}
          </p>
          {contact.ownAlias ? (
            <p className="break-all text-body-sm text-muted-foreground">
              {contact.counterpartEmail}
            </p>
          ) : null}
          <ContactAliasForm contact={contact} />
          <UnlinkContactButton contact={contact} />
        </li>
      ))}
    </ul>
  );
}
