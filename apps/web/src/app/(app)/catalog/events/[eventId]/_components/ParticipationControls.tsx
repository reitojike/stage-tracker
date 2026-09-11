"use client";

import { useState, useTransition } from "react";
import {
  isParticipationWriteBlockedByCancellation,
  type EventId,
  type OccurrenceId,
  type ParticipationStatus,
  type ParticipationWriteTransition,
} from "@stage-tracker/domain";
import { Button } from "@stage-tracker/ui";
import { setParticipationChoiceAction } from "@/lib/actions/participation.actions";
import type { ParticipationChoice } from "@/lib/actions/participation";

export interface ParticipationControlsProps {
  readonly eventId: EventId;
  readonly occurrenceId: OccurrenceId;
  readonly initialStatus: ParticipationStatus | null;
  /**
   * `true` の場合、この occurrence の参加状況そのものを読み込めなかった
   * ことを意味する（`_lib/participationLookup.ts` 参照）。「参加していない」
   * (`initialStatus === null`) とは明確に別状態であり、インタラクティブな
   * 選択肢は出さない（read failure を「未参加」という product 上の意味へ
   * 化けさせないため）。
   */
  readonly participationUnavailable: boolean;
  readonly isEffectivelyCanceled: boolean;
  readonly onStatusChange?: (status: ParticipationStatus | null) => void;
}

function transitionFor(
  currentStatus: ParticipationStatus | null,
  target: ParticipationStatus,
): ParticipationWriteTransition {
  if (currentStatus === null) {
    return { kind: "create", status: target };
  }
  return { kind: "update", from: currentStatus, to: target };
}

/**
 * `docs/v2/oracle-routes-ui.md` §2 イベント詳細の participation 操作
 * （`attending`/`considering`/`withdraw`）。legacy の `ParticipationSheet`
 * （bottom sheet modal）に相当する Sheet component は `packages/ui` に
 * まだ無く、このタスクの scope はそこへの追加を含まないため、行内の
 * ボタン群として実装する（見た目の実装詳細であり、oracle が記録するのは
 * 「選択肢クリックで即座に保存」という挙動そのもの）。
 *
 * 中止 (`isEffectivelyCanceled`) 状態での新規 active action の拒否
 * （AGENTS.md「Cancellation」、PO 判断: 新規 `considering` 作成も拒否
 * 対象）は、`@stage-tracker/domain` の
 * `isParticipationWriteBlockedByCancellation` を使って UI 側でも
 * 事前にボタンを disable する。真の enforcement は DB trigger
 * （custom SQLSTATE `90002`）であり、これはあくまで先回りの UX
 * （`docs/v2/oracle-domain.md` §4.2 の「先回りの分類」と同じ位置づけ）。
 */
export function ParticipationControls({
  eventId,
  occurrenceId,
  initialStatus,
  participationUnavailable,
  isEffectivelyCanceled,
  onStatusChange,
}: ParticipationControlsProps) {
  const [status, setStatus] = useState<ParticipationStatus | null>(
    initialStatus,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (participationUnavailable) {
    return (
      <p className="text-body-sm text-muted-foreground">
        参加状況を読み込めませんでした。
      </p>
    );
  }

  function submit(choice: ParticipationChoice) {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await setParticipationChoiceAction({
        eventId,
        occurrenceId,
        choice,
      });

      if (result?.serverError) {
        setErrorMessage(result.serverError.message);
        return;
      }
      if (result?.validationErrors) {
        setErrorMessage("入力内容を確認してください。");
        return;
      }

      const nextStatus = choice === "withdraw" ? null : choice;
      setStatus(nextStatus);
      onStatusChange?.(nextStatus);
    });
  }

  const attendingBlocked =
    status !== "attending" &&
    isParticipationWriteBlockedByCancellation(
      transitionFor(status, "attending"),
      isEffectivelyCanceled,
    );
  const consideringBlocked =
    status !== "considering" &&
    isParticipationWriteBlockedByCancellation(
      transitionFor(status, "considering"),
      isEffectivelyCanceled,
    );

  return (
    <div className="flex flex-col gap-xs">
      <div className="flex flex-wrap gap-xs">
        <Button
          type="button"
          size="sm"
          variant={status === "attending" ? "default" : "outline"}
          disabled={isPending || attendingBlocked}
          aria-pressed={status === "attending"}
          onClick={() => submit("attending")}
        >
          参加する
        </Button>
        <Button
          type="button"
          size="sm"
          variant={status === "considering" ? "default" : "outline"}
          disabled={isPending || consideringBlocked}
          aria-pressed={status === "considering"}
          onClick={() => submit("considering")}
        >
          気になる
        </Button>
        {status !== null ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => submit("withdraw")}
          >
            参加をやめる
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
