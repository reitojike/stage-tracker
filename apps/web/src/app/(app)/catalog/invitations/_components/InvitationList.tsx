"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@stage-tracker/ui";
import { instantToTokyoCalendarDate } from "@stage-tracker/domain";
import {
  acceptInvitationAction,
  declineInvitationAction,
} from "@/lib/actions/invitations";
import type { ReceivedInvitation } from "../_data/listMyReceivedInvitations";
import {
  formatTokyoCalendarDateJa,
  occurrenceTimeRangeLabel,
} from "@/app/_lib/format";

type CardPhase =
  | { readonly kind: "pending" }
  | { readonly kind: "confirm-decline" }
  | { readonly kind: "busy" }
  | { readonly kind: "removed" };

type FailedAction = "参加する" | "参加しない" | "閉じる";

interface CardError {
  readonly action: FailedAction;
  readonly message: string;
}

interface CardEntry {
  readonly key: string;
  readonly invitation: ReceivedInvitation;
  readonly phase: CardPhase;
  readonly error: CardError | null;
}

export interface InvitationListProps {
  readonly initialInvitations: readonly ReceivedInvitation[];
}

/**
 * `/catalog/invitations` の操作本体（`docs/v2/oracle-routes-ui.md` §2
 * 「Invitation 一覧」）。
 *
 * - 「参加する」: 通常の participation write と同一の operation
 *   （`acceptInvitationAction`）。成功時、同一 occurrence への他の
 *   pending invitation も自動解決される（DB trigger）ため、client 側でも
 *   同一 occurrenceId のカードをまとめて除去する。
 * - 「参加しない」: P3 決定どおり即座に hard delete で確定
 *   （`declineInvitationAction`）。undo は無い（`docs/v2/decisions.md`
 *   「P3 の実装可否」節 - invitee 側から invitation を作り直す経路が現行
 *   スキーマに存在しないため、PO 判断で Issue #382 へ切り出し済み）。
 *   確定後は取り消せないため、実行前に一段階の確認を挟む
 *   （押し間違い対策 - undo が無い現状ではここでしか防げない）。
 * - 効果的に中止済みの招待（event/occurrence どちらかが cancel 済み）は
 *   「閉じる」のみ。中止済みで元々参加できない招待を閉じるだけなので確認は
 *   挟まない。
 */
export function InvitationList({ initialInvitations }: InvitationListProps) {
  const router = useRouter();
  const [entries, setEntries] = useState<CardEntry[]>(() =>
    initialInvitations.map((invitation) => ({
      key: invitation.invitationId,
      invitation,
      phase: { kind: "pending" },
      error: null,
    })),
  );

  function setPhase(
    key: string,
    phase: CardPhase,
    error: CardError | null = null,
  ) {
    setEntries((prev) =>
      prev.map((entry) =>
        entry.key === key ? { ...entry, phase, error } : entry,
      ),
    );
  }

  async function handleAccept(entry: CardEntry) {
    setPhase(entry.key, { kind: "busy" });
    const result = await acceptInvitationAction({
      occurrenceId: entry.invitation.occurrenceId,
    });
    if (result?.serverError) {
      setPhase(
        entry.key,
        { kind: "pending" },
        { action: "参加する", message: result.serverError.message },
      );
      return;
    }
    // 「参加する」は同一 occurrence への他の pending invitation も自動的に
    // 解決する（DB trigger）ため、同じ occurrenceId のカードをまとめて
    // client-local state からも除去する。
    setEntries((prev) =>
      prev.filter(
        (item) =>
          item.invitation.occurrenceId !== entry.invitation.occurrenceId,
      ),
    );
    router.refresh();
  }

  async function handleDecline(
    entry: CardEntry,
    action: Extract<FailedAction, "参加しない" | "閉じる">,
  ) {
    setPhase(entry.key, { kind: "busy" });
    const result = await declineInvitationAction({
      invitationId: entry.invitation.invitationId,
    });
    if (result?.serverError) {
      setPhase(
        entry.key,
        { kind: "pending" },
        { action, message: result.serverError.message },
      );
      return;
    }
    setPhase(entry.key, { kind: "removed" });
    router.refresh();
  }

  const visibleEntries = entries.filter(
    (entry) => entry.phase.kind !== "removed",
  );

  if (visibleEntries.length === 0) {
    return (
      <p className="text-body-sm text-muted-foreground">招待はありません。</p>
    );
  }

  return (
    <div className="flex flex-col gap-md">
      <ul className="flex flex-col gap-sm">
        {visibleEntries.map((entry) => (
          <InvitationCard
            key={entry.key}
            entry={entry}
            onAccept={() => {
              void handleAccept(entry);
            }}
            onRequestDecline={() => {
              setPhase(entry.key, { kind: "confirm-decline" });
            }}
            onCancelDecline={() => {
              setPhase(entry.key, { kind: "pending" });
            }}
            onConfirmDecline={() => {
              void handleDecline(entry, "参加しない");
            }}
            onClose={() => {
              void handleDecline(entry, "閉じる");
            }}
          />
        ))}
      </ul>
    </div>
  );
}

function InvitationCard({
  entry,
  onAccept,
  onRequestDecline,
  onCancelDecline,
  onConfirmDecline,
  onClose,
}: {
  entry: CardEntry;
  onAccept: () => void;
  onRequestDecline: () => void;
  onCancelDecline: () => void;
  onConfirmDecline: () => void;
  onClose: () => void;
}) {
  const { invitation, phase } = entry;
  const context = invitation.context;
  const isEffectivelyCanceled =
    context !== null &&
    (context.event.canceledAt !== null ||
      context.occurrence.canceledAt !== null);

  return (
    <li className="flex flex-col gap-xs border-b border-border py-sm">
      {context === null ? (
        <p className="text-body-sm text-muted-foreground">
          （イベント情報を読み込めませんでした）
        </p>
      ) : (
        <div className="flex flex-col gap-2xs">
          <div className="flex flex-wrap items-center gap-2xs">
            <span className="text-title font-semibold text-foreground">
              {context.event.title}
            </span>
            {isEffectivelyCanceled ? (
              <Badge variant="terminal">中止</Badge>
            ) : null}
          </div>
          <span className="text-body-sm text-muted-foreground">
            {formatTokyoCalendarDateJa(
              instantToTokyoCalendarDate(context.occurrence.startsAt),
            )}{" "}
            {occurrenceTimeRangeLabel(
              context.occurrence.startsAt,
              context.occurrence.endsAt,
            )}
          </span>
        </div>
      )}

      {entry.error !== null ? (
        <p role="alert" className="text-body-sm text-destructive">
          「{entry.error.action}」: {entry.error.message}
        </p>
      ) : null}

      {phase.kind === "confirm-decline" ? (
        <div className="flex items-center gap-sm">
          <span className="text-body-sm text-muted-foreground">
            参加しないにしますか？あとから取り消せません。
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancelDecline}
          >
            キャンセル
          </Button>
          <Button type="button" size="sm" onClick={onConfirmDecline}>
            はい、参加しない
          </Button>
        </div>
      ) : isEffectivelyCanceled ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={phase.kind === "busy"}
          onClick={onClose}
        >
          閉じる
        </Button>
      ) : (
        <div className="flex gap-sm">
          <Button
            type="button"
            disabled={phase.kind === "busy"}
            onClick={onAccept}
          >
            参加する
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={phase.kind === "busy"}
            onClick={onRequestDecline}
          >
            参加しない
          </Button>
        </div>
      )}
    </li>
  );
}
