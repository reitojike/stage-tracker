"use client";

import { useState } from "react";
import { Button } from "@stage-tracker/ui";

/**
 * 破壊的操作（hard delete）専用の確認 UI（`docs/v2/oracle-routes-ui.md`
 * §2「破壊的操作（hard delete）のみ確認 Sheet を要求」）。専用の Sheet
 * primitive は `packages/ui` にまだ無く、この Task の編集許可範囲にも
 * 含まれないため、同じ確認契約（確認するまで実行しない・
 * `showCloseButton=false` 相当のフォーカス閉じ込めは省略）を2段階の
 * inline 表示で満たす（このタスクの報告に discretion として記録する）。
 */
export function ConfirmDeleteButton({
  label,
  confirmDescription,
  isExecuting,
  onConfirm,
}: {
  label: string;
  confirmDescription: string;
  isExecuting: boolean;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="destructive"
        onClick={() => setConfirming(true)}
      >
        {label}
      </Button>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-label={label}
      className="flex flex-col gap-sm rounded-control border border-destructive bg-destructive/10 p-md"
    >
      <p className="text-body-sm text-foreground">{confirmDescription}</p>
      <div className="flex gap-sm">
        <Button
          type="button"
          variant="destructive"
          disabled={isExecuting}
          onClick={onConfirm}
        >
          {isExecuting ? "削除中…" : "削除する"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isExecuting}
          onClick={() => setConfirming(false)}
        >
          キャンセル
        </Button>
      </div>
    </div>
  );
}
