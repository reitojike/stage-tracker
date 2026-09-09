"use client";

import { useAction } from "next-safe-action/hooks";
import { Button } from "@stage-tracker/ui";
import { deletePasskeyAction } from "@/lib/actions/passkeys";

/**
 * AGENTS.md「マイページ」/ oracle-routes-ui.md §2: 削除は行内即時ボタン、
 * 確認ダイアログなし（低リスク・再登録可能なため意図的に省略）。
 *
 * `passkeyLabel`（`PasskeySection` が同じ行に表示するラベルと同一）を
 * `aria-label` に含める。可視テキストの「削除」は全行で同一のため、これが
 * 無いと複数 Passkey 登録時に screen reader から行を区別できない
 * （`docs/ux-ui.md`「Accessibility baseline」の WCAG 2.2 AA baseline。
 * legacy の `DeletePasskeyForm.tsx` と同じ理由・同じ pattern、PR #129 の
 * Codex finding 参照）。
 */
export function DeletePasskeyForm({
  passkeyId,
  passkeyLabel,
}: {
  passkeyId: string;
  passkeyLabel: string;
}) {
  const { execute, isExecuting, result } = useAction(deletePasskeyAction);

  return (
    <div className="flex items-center gap-xs">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isExecuting}
        onClick={() => execute({ passkeyId })}
        aria-label={
          isExecuting ? `${passkeyLabel}を削除中…` : `${passkeyLabel}を削除`
        }
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
