"use client";

import { useAction } from "next-safe-action/hooks";
import { Button } from "@stage-tracker/ui";
import type { PersonalScheduleEntryId } from "@stage-tracker/domain";
import { removeScheduleShareAction } from "@/lib/actions/schedule/schedule-share-actions";

interface LeaveShareButtonProps {
  readonly entryId: PersonalScheduleEntryId;
}

/**
 * 非owner の自己離脱（`docs/v2/oracle-routes-ui.md` §2「予定詳細」:
 * 「非owner の『共有から外れる』は確認なしの即時実行、成功で `/calendar`
 * へ redirect」）。**entry の削除とは別の operation** - owner-only の
 * hard delete（`DeleteEntryButton.tsx`）とは異なり、この呼び出しは
 * 自分の共有 1 件を消すだけで、entry 自体や他の recipient の共有には
 * 一切影響しない。`removeScheduleShareAction` は shareId を受け取らず
 * `entryId` だけを受け取る設計（`schedule-share-actions.ts` の doc
 * comment 参照）で、この区別を型レベルでも表現している。
 */
export function LeaveShareButton({ entryId }: LeaveShareButtonProps) {
  const { execute, isExecuting, result } = useAction(removeScheduleShareAction);

  return (
    <div className="flex flex-col gap-xs">
      <Button
        type="button"
        variant="outline"
        disabled={isExecuting}
        onClick={() => {
          execute({ entryId });
        }}
      >
        {isExecuting ? "処理中…" : "共有から外れる"}
      </Button>
      {result.serverError ? (
        <p role="alert" className="text-body-sm text-destructive">
          {result.serverError.message}
        </p>
      ) : null}
    </div>
  );
}
