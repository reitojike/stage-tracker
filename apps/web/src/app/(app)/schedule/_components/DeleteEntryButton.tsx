"use client";

import { useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { Button } from "@stage-tracker/ui";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@stage-tracker/ui/components/sheet";
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
 * shared Sheet は presentation と modal lifecycle を担当し、hard delete の
 * action semantics と共有相手への影響文言はこの consumer に残す。
 */
export function DeleteEntryButton({ entryId }: DeleteEntryButtonProps) {
  const [open, setOpen] = useState(false);
  const { execute, isExecuting, result, reset } = useAction(
    deleteScheduleEntryAction,
  );

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      reset();
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger
        render={
          <Button type="button" variant="destructive" aria-haspopup="dialog">
            削除する
          </Button>
        }
      />
      <SheetContent
        side="bottom"
        showCloseButton={false}
        role="alertdialog"
        aria-label="予定の削除の確認"
      >
        <SheetHeader>
          <SheetTitle>予定の削除の確認</SheetTitle>
          <SheetDescription>
            この予定を削除します。この操作は取り消せません。共有相手からもこの予定が見えなくなります。よろしいですか？
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
              handleOpenChange(false);
            }}
          >
            キャンセル
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
