"use client";

import { useAction } from "next-safe-action/hooks";
import { Button } from "@stage-tracker/ui";
import type { PersonalScheduleEntryId } from "@stage-tracker/domain";
import { removeScheduleShareAsOwnerAction } from "@/lib/actions/schedule/schedule-share-actions";
import type { ScheduleShareRecipient } from "@/lib/actions/schedule/schedule-share-write";

interface RecipientRowProps {
  readonly entryId: PersonalScheduleEntryId;
  readonly recipient: ScheduleShareRecipient;
}

function RecipientRow({ entryId, recipient }: RecipientRowProps) {
  const { execute, isExecuting } = useAction(removeScheduleShareAsOwnerAction);

  return (
    <li className="flex items-center justify-between gap-2 border-b border-border py-2">
      <span className="text-body-sm text-foreground">
        {recipient.recipientEmail}
      </span>
      {/* 「owner の recipient『解除』は確認なしの即時実行」
          （oracle-routes-ui.md §2「予定詳細」）。 */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isExecuting}
        onClick={() => {
          execute({ entryId, shareId: recipient.shareId });
        }}
      >
        {isExecuting ? "解除中…" : "解除"}
      </Button>
    </li>
  );
}

interface RecipientListProps {
  readonly entryId: PersonalScheduleEntryId;
  readonly recipients: readonly ScheduleShareRecipient[];
}

/**
 * owner 向けの共有相手一覧（`docs/v2/oracle-routes-ui.md` §2「予定詳細」:
 * 「空状態（共有先0件）: owner視点で『まだ誰とも共有していません』」）。
 */
export function RecipientList({ entryId, recipients }: RecipientListProps) {
  if (recipients.length === 0) {
    return (
      <p className="text-body-sm text-muted-foreground">
        まだ誰とも共有していません。
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {recipients.map((recipient) => (
        <RecipientRow
          key={recipient.shareId}
          entryId={entryId}
          recipient={recipient}
        />
      ))}
    </ul>
  );
}
