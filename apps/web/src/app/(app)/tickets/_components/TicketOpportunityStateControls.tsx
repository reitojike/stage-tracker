"use client";

import { useState, useTransition } from "react";
import type {
  TicketOpportunityId,
  UserTicketOpportunityStatus,
} from "@stage-tracker/domain";
import { Button } from "@stage-tracker/ui";
import { updateTicketOpportunityStateAction } from "@/lib/actions/ticketOpportunityState.actions";
import { WriteNotice } from "./WriteNotice";

/** legacy の `resolveTicketOpportunityStateSetNotice`/
 * `ticketOpportunityRemoveNotice`（`domain/ticketOpportunityFeedback.ts`）
 * と同じ文言。`docs/v2/oracle-routes-ui.md`「チケット一覧」の「成功時
 * `WriteNotice` で通知」要件（review finding: 未実装だった）。 */
function noticeForIntent(intent: "planned" | "applied" | "remove"): string {
  if (intent === "remove") {
    return "登録を解除しました。";
  }
  return intent === "applied"
    ? "「申し込み済み」に設定しました。"
    : "「申し込む予定」に設定しました。";
}

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
 * が未実装だった）。`TicketsView`（`isFirstRowForOpportunity` かつ
 * `!isPostFinalRetainedHistory`）が Opportunity につき1回だけ描画する
 * （post-final 行はコントロール自体を非表示にするオラクル要件 - review
 * finding）。成功時は `WriteNotice` で通知する（同じくオラクル要件 -
 * review finding）。
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
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [isPending, startTransition] = useTransition();

  function submit(intent: "planned" | "applied" | "remove") {
    setErrorMessage(null);
    setNotice(null);
    startTransition(async () => {
      const result = await updateTicketOpportunityStateAction({
        opportunityId,
        intent,
      });

      if (result?.serverError) {
        setAttempt((current) => current + 1);
        setErrorMessage(result.serverError.message);
        return;
      }
      if (result?.validationErrors) {
        setAttempt((current) => current + 1);
        setErrorMessage("入力内容を確認してください。");
        return;
      }

      setMyState(intent === "remove" ? null : intent);
      setAttempt((current) => current + 1);
      setNotice(noticeForIntent(intent));
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
      ) : (
        <WriteNotice notice={notice} attempt={attempt} />
      )}
    </div>
  );
}
