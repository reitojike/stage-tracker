"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { OccurrenceId } from "@stage-tracker/domain";
import { Button } from "@stage-tracker/ui";
import { inviteToOccurrenceAction } from "@/lib/actions/invitation.actions";

export interface InviteFormProps {
  readonly occurrenceId: OccurrenceId;
}

type InviteMessage = {
  readonly kind: "success" | "error";
  readonly text: string;
};

/**
 * `docs/v2/oracle-routes-ui.md` §2 イベント詳細の招待フォーム
 * （legacy の `InviteSheet` 相当。`packages/ui` にまだ Sheet component が
 * 無いため `<details>` ベースの折り畳みで実装する — 見た目の実装詳細）。
 *
 * **opacity（AGENTS.md「Invitation」、`docs/v2/decisions.md`「踏んでは
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
  const [message, setMessage] = useState<InviteMessage | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await inviteToOccurrenceAction({ occurrenceId, email });

      if (result?.serverError) {
        setMessage({ kind: "error", text: result.serverError.message });
        return;
      }
      if (result?.validationErrors) {
        setMessage({
          kind: "error",
          text: "メールアドレスの形式を確認してください。",
        });
        return;
      }

      // 成功: invitee 側の実際の分岐に関わらず、常にこの1文だけを表示する。
      setMessage({ kind: "success", text: "招待を送信しました。" });
      setEmail("");
    });
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
      >
        招待する
      </Button>
    );
  }

  const fieldId = `invite-email-${occurrenceId}`;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-xs">
      <label
        className="text-label font-medium text-foreground"
        htmlFor={fieldId}
      >
        招待するメールアドレス
      </label>
      <input
        id={fieldId}
        name="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="h-9 rounded-control border border-input bg-background px-3 text-body-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <div className="flex gap-xs">
        <Button type="submit" size="sm" disabled={isPending}>
          送信
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => {
            setOpen(false);
            setMessage(null);
          }}
        >
          閉じる
        </Button>
      </div>
      {message !== null ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className="text-body-sm"
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
