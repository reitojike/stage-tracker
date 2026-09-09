"use client";

import { useState, useTransition } from "react";
import type { TicketOpportunityId, UserTicketOpportunityStatus } from "@stage-tracker/domain";
import { Button } from "@stage-tracker/ui";
import { updateTicketOpportunityStateAction } from "@/lib/actions/ticketOpportunityState.actions";

export interface TicketOpportunityStateControlsProps {
  readonly opportunityId: TicketOpportunityId;
  /** 呼び出し元本人の現在の planning state。row が無い = 未登録
   * (AGENTS.md「UserTicketOpportunityState」)。 */
  readonly initialState: UserTicketOpportunityStatus | null;
}

/**
 * `docs/v2/oracle-routes-ui.md`「`/tickets`」行の
 * `updateTicketOpportunityStateAction` を呼ぶ、呼び出し元本人だけの
 * planning state 操作（M8 で確定した v2 の不具合の修正 - この write UI 自体
 * が未実装だった）。`TicketsView`（`isFirstRowForOpportunity`）が
 * Opportunity につき1回だけ描画する。
 *
 * `ParticipationControls.tsx` と同じ
 * `useState` + `useTransition` パターン（`useActionState`+`<form>` ではない
 * - legacy はこちらだったが、v2 の他の write control は同じ
 * `next-safe-action` の直接呼び出しパターンに揃っている）。
 */
export function TicketOpportunityStateControls({
  opportunityId,
  initialState,
}: TicketOpportunityStateControlsProps) {
  const [myState, setMyState] = useState<UserTicketOpportunityStatus | null>(
    initialState,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(intent: "planned" | "applied" | "remove") {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await updateTicketOpportunityStateAction({
        opportunityId,
        intent,
      });

      if (result?.serverError) {
        setErrorMessage(result.serverError.message);
        return;
      }
      if (result?.validationErrors) {
        setErrorMessage("入力内容を確認してください。");
        return;
      }

      setMyState(intent === "remove" ? null : intent);
    });
  }

  return (
    <div className="flex flex-col gap-2xs">
      <div className="flex flex-wrap gap-2xs">
        {myState === null ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => submit("planned")}
          >
            申し込む予定にする
          </Button>
        ) : null}
        {myState === "planned" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => submit("applied")}
          >
            申し込み済みにする
          </Button>
        ) : null}
        {myState === "applied" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => submit("planned")}
          >
            申し込む予定に戻す
          </Button>
        ) : null}
        {myState !== null ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => submit("remove")}
          >
            登録を解除
          </Button>
        ) : null}
      </div>
      {errorMessage !== null ? (
        <p role="alert" className="text-body-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
