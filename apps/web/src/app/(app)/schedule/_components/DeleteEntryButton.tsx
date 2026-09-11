"use client";

import { useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { Button } from "@stage-tracker/ui";
import type { PersonalScheduleEntryId } from "@stage-tracker/domain";
import { deleteScheduleEntryAction } from "@/lib/actions/schedule/schedule-entry-actions";

interface DeleteEntryButtonProps {
  readonly entryId: PersonalScheduleEntryId;
}

/**
 * owner-only hard delete（product-rules.md「Deletion」節、
 * `docs/v2/oracle-routes-ui.md` §2「予定詳細」: 「owner の『削除』は
 * 確認 Sheet 必須」）。
 *
 * oracle の `Sheet`（ネイティブ `<dialog>` ベースの bottom sheet）は
 * `packages/ui` にまだ無く、このタスクは `packages/ui` を編集できない
 * ため、汎用 Sheet primitive は作らず「破壊的操作の前に明示的な確認
 * ステップを要求する」という要件だけを、この機能に閉じた2段階ボタンで
 * 満たす（このタスクの報告に簡略化の判断として記録する）。
 */
export function DeleteEntryButton({ entryId }: DeleteEntryButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const { execute, isExecuting, result } = useAction(deleteScheduleEntryAction);

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="destructive"
        onClick={() => {
          setConfirming(true);
        }}
      >
        削除する
      </Button>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-label="予定の削除の確認"
      className="flex flex-col gap-2 rounded-control border border-destructive p-md"
    >
      <p className="text-body-sm text-foreground">
        この予定を削除します。この操作は取り消せません。共有相手からもこの予定が見えなくなります。よろしいですか？
      </p>
      {result.serverError ? (
        <p role="alert" className="text-body-sm text-destructive">
          {result.serverError.message}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={isExecuting}
          onClick={() => {
            execute({ entryId });
          }}
        >
          {isExecuting ? "削除中…" : "削除する"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isExecuting}
          onClick={() => {
            setConfirming(false);
          }}
        >
          キャンセル
        </Button>
      </div>
    </div>
  );
}
