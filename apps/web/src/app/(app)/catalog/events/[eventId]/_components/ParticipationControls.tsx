"use client";

import { useState, useTransition } from "react";
import {
  isParticipationWriteBlockedByCancellation,
  type EventId,
  type OccurrenceId,
  type ParticipationStatus,
  type ParticipationWriteTransition,
} from "@stage-tracker/domain";
import { Button } from "@stage-tracker/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@stage-tracker/ui/components/sheet";
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
 * （`attending`/`considering`/`withdraw`）。Sheet は presentation と
 * lifecycle だけを担当し、choice の即時保存と cancellation の判定は
 * この consumer が担当する。
 *
 * 中止 (`isEffectivelyCanceled`) 状態での新規 active action の拒否
 * （AGENTS.md「Cancellation」、PO 判断: 新規 `considering` 作成も拒否
 * 対象）は、`@stage-tracker/domain` の
 * `isParticipationWriteBlockedByCancellation` を使って UI 側でも
 * 事前に choice を disable する。真の enforcement は DB trigger
 * （custom SQLSTATE `90002`）であり、これはあくまで先回りの UX。
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
  const [open, setOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (participationUnavailable) {
    return (
      <p className="text-body-sm text-muted-foreground">
        参加状況を読み込めませんでした。
      </p>
    );
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    setErrorMessage(null);
  }

  function submit(choice: ParticipationChoice, blocked: boolean) {
    if (blocked) {
      return;
    }
    if (choice !== "withdraw" && choice === status) {
      handleOpenChange(false);
      return;
    }

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
      handleOpenChange(false);
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

  const currentStatusLabel =
    status === "attending"
      ? "参加する"
      : status === "considering"
        ? "気になる"
        : null;

  return (
    <div className="flex flex-wrap items-center gap-sm">
      {currentStatusLabel !== null ? (
        <span
          data-testid="participation-status"
          className="text-body-sm font-medium"
        >
          {currentStatusLabel}
        </span>
      ) : null}
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger
          render={
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-haspopup="dialog"
            >
              変更
            </Button>
          }
        />
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>参加の状態</SheetTitle>
            <SheetDescription className="sr-only">
              参加状態を変更します。
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-md py-md">
            <div className="flex flex-col gap-sm" aria-busy={isPending}>
              {errorMessage !== null ? (
                <p role="alert" className="text-body-sm text-destructive">
                  {errorMessage}
                </p>
              ) : null}
              <div className="flex flex-col gap-xs">
                <Button
                  type="button"
                  size="lg"
                  className="w-full justify-between"
                  variant={status === "attending" ? "default" : "outline"}
                  disabled={isPending || attendingBlocked}
                  aria-pressed={status === "attending"}
                  onClick={() => submit("attending", attendingBlocked)}
                >
                  参加する
                  {status === "attending" ? "（選択中）" : null}
                </Button>
                <Button
                  type="button"
                  size="lg"
                  className="w-full justify-between"
                  variant={status === "considering" ? "default" : "outline"}
                  disabled={isPending || consideringBlocked}
                  aria-pressed={status === "considering"}
                  onClick={() => submit("considering", consideringBlocked)}
                >
                  気になる
                  {status === "considering" ? "（選択中）" : null}
                </Button>
                {status !== null ? (
                  <Button
                    type="button"
                    size="lg"
                    className="w-full justify-start"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => submit("withdraw", false)}
                  >
                    参加をやめる
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
