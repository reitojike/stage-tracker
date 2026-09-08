"use client";

import { useRef, useState, type FormEvent } from "react";
import { useAction } from "next-safe-action/hooks";
import { Button } from "@stage-tracker/ui";
import type { PersonalScheduleEntryId } from "@stage-tracker/domain";
import { addScheduleShareByEmailAction } from "@/lib/actions/schedule/schedule-share-actions";
import { TextField } from "./FormField";
import { WriteNotice } from "./WriteNotice";

interface ShareAddFormProps {
  readonly entryId: PersonalScheduleEntryId;
}

/**
 * owner の共有追加（`docs/v2/oracle-routes-ui.md` §1
 * `addScheduleShareByEmailAction`、§2「予定詳細」: 「owner の『+ 追加』→
 * `ShareAddSheet`、成功で自動 close」）。ここでは専用 Sheet の代わりに
 * インラインフォームとして実装し、成功時はフォームをリセットして次の
 * 追加に備える（`DeleteEntryButton.tsx` と同じ簡略化理由）。
 *
 * email が未登録の場合、この action は「知らせてよい」
 * （product-rules.md「Authenticated-user targeting」節・「Invitation
 * とは異なりこの operation には opacity 要件がない」）。この画面は
 * サーバから返る `validation` kind のメッセージをそのまま
 * （AGENTS.md「Human-facing output language」の provider-native 引用
 * 例外に従い、翻訳せず）表示するだけで、未登録かどうかで分岐や隠蔽を
 * 一切行わない - それ自体が「知らせてよい」という判断の実装である。
 */
export function ShareAddForm({ entryId }: ShareAddFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [attempt, setAttempt] = useState(0);
  const { execute, result, isExecuting } = useAction(
    addScheduleShareByEmailAction,
    {
      onSuccess: () => {
        formRef.current?.reset();
        setAttempt((value) => value + 1);
      },
    },
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get("recipientEmail");
    execute({
      entryId,
      recipientEmail: typeof email === "string" ? email : "",
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="flex flex-col gap-2"
      noValidate
    >
      <TextField
        id="recipientEmail"
        name="recipientEmail"
        type="email"
        label="共有する相手のメールアドレス"
        required
        error={
          result.serverError?.message ??
          result.validationErrors?.recipientEmail?._errors?.[0]
        }
      />
      <Button type="submit" disabled={isExecuting}>
        {isExecuting ? "追加中…" : "追加する"}
      </Button>
      <WriteNotice
        notice={attempt > 0 ? "共有に追加しました。" : null}
        attempt={attempt}
      />
    </form>
  );
}
