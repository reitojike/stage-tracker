"use client";

import { useAction } from "next-safe-action/hooks";
import { Button } from "@stage-tracker/ui";
import { deletePasskeyAction } from "@/lib/actions/passkeys";

/**
 * AGENTS.md「マイページ」/ oracle-routes-ui.md §2: 削除は行内即時ボタン、
 * 確認ダイアログなし（低リスク・再登録可能なため意図的に省略）。
 */
export function DeletePasskeyForm({ passkeyId }: { passkeyId: string }) {
  const { execute, isExecuting, result } = useAction(deletePasskeyAction);

  return (
    <div className="flex items-center gap-xs">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isExecuting}
        onClick={() => execute({ passkeyId })}
      >
        {isExecuting ? "削除中…" : "削除"}
      </Button>
      {result.serverError ? (
        <span role="alert" className="text-body-sm text-destructive">
          {result.serverError.message}
        </span>
      ) : null}
    </div>
  );
}
