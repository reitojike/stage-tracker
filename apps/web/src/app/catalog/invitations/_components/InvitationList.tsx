"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@stage-tracker/ui";
import {
  acceptInvitationAction,
  declineInvitationAction,
  undoDeclineInvitationAction,
  type DeclinedInvitationSnapshotOutput,
} from "@/lib/actions/invitations";
import type { ReceivedInvitation } from "../_data/listMyReceivedInvitations";
import { instantToDateTimeLocalValue } from "../_lib/instantFormat";

/** P3 決定（`docs/v2/decisions.md`）: decline は即座に hard delete して
 * 確定させ、undo は「作り直し」で実現する。undo の猶予時間は実装で
 * 決めてよい値 —— 8秒とする。 */
const UNDO_WINDOW_MS = 8000;

type CardPhase =
  | { readonly kind: "pending" }
  | { readonly kind: "busy" }
  | {
      readonly kind: "declined";
      readonly snapshot: DeclinedInvitationSnapshotOutput | null;
    }
  | { readonly kind: "undo-failed" }
  | { readonly kind: "removed" };

interface CardEntry {
  readonly key: string;
  readonly invitation: ReceivedInvitation;
  readonly phase: CardPhase;
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
 *   （`declineInvitationAction`）。その後 `UNDO_WINDOW_MS` の間「取り消す」
 *   を表示する（サーバには一切中間状態を持たない —— 表示しているのは
 *   client-local な snapshot だけ）。
 * - 効果的に中止済みの招待（event/occurrence どちらかが cancel 済み）は
 *   「閉じる」のみ（undo 無しの decline 相当）。
 */
export function InvitationList({ initialInvitations }: InvitationListProps) {
  const router = useRouter();
  const [entries, setEntries] = useState<CardEntry[]>(() =>
    initialInvitations.map((invitation) => ({
      key: invitation.invitationId,
      invitation,
      phase: { kind: "pending" },
    })),
  );
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timerMap = timers.current;
    return () => {
      for (const timer of timerMap.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  function setPhase(key: string, phase: CardPhase) {
    setEntries((prev) =>
      prev.map((entry) => (entry.key === key ? { ...entry, phase } : entry)),
    );
  }

  async function handleAccept(entry: CardEntry) {
    setPhase(entry.key, { kind: "busy" });
    const result = await acceptInvitationAction({
      occurrenceId: entry.invitation.occurrenceId,
    });
    if (result?.serverError) {
      setPhase(entry.key, { kind: "pending" });
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

  async function handleDecline(entry: CardEntry, offerUndo: boolean) {
    setPhase(entry.key, { kind: "busy" });
    const result = await declineInvitationAction({
      invitationId: entry.invitation.invitationId,
    });
    if (result?.serverError) {
      setPhase(entry.key, { kind: "pending" });
      return;
    }
    if (!offerUndo) {
      setPhase(entry.key, { kind: "removed" });
      return;
    }
    const snapshot = result?.data?.snapshot ?? null;
    setPhase(entry.key, { kind: "declined", snapshot });
    const timer = setTimeout(() => {
      setPhase(entry.key, { kind: "removed" });
      timers.current.delete(entry.key);
    }, UNDO_WINDOW_MS);
    timers.current.set(entry.key, timer);
  }

  async function handleUndo(
    entry: CardEntry,
    snapshot: DeclinedInvitationSnapshotOutput,
  ) {
    const timer = timers.current.get(entry.key);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(entry.key);
    }
    setPhase(entry.key, { kind: "busy" });
    const result = await undoDeclineInvitationAction(snapshot);
    if (result?.serverError) {
      setPhase(entry.key, { kind: "undo-failed" });
      return;
    }
    setPhase(entry.key, { kind: "pending" });
    router.refresh();
  }

  const visibleEntries = entries.filter(
    (entry) => entry.phase.kind !== "removed",
  );
  const pendingCount = visibleEntries.filter(
    (entry) => entry.phase.kind === "pending" || entry.phase.kind === "busy",
  ).length;

  if (visibleEntries.length === 0) {
    return (
      <p className="text-body-sm text-muted-foreground">招待はありません。</p>
    );
  }

  return (
    <div className="flex flex-col gap-md">
      <p className="text-body-sm text-muted-foreground">
        未回答 {pendingCount}件
      </p>
      <ul className="flex flex-col gap-sm">
        {visibleEntries.map((entry) => (
          <InvitationCard
            key={entry.key}
            entry={entry}
            onAccept={() => {
              void handleAccept(entry);
            }}
            onDecline={(offerUndo) => {
              void handleDecline(entry, offerUndo);
            }}
            onUndo={(snapshot) => {
              void handleUndo(entry, snapshot);
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
  onDecline,
  onUndo,
}: {
  entry: CardEntry;
  onAccept: () => void;
  onDecline: (offerUndo: boolean) => void;
  onUndo: (snapshot: DeclinedInvitationSnapshotOutput) => void;
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
        <div className="flex items-center gap-sm">
          <span className="text-body text-foreground">
            {context.event.title} —{" "}
            {instantToDateTimeLocalValue(context.occurrence.startsAt).replace(
              "T",
              " ",
            )}
          </span>
          {isEffectivelyCanceled ? (
            <Badge variant="terminal">中止</Badge>
          ) : null}
        </div>
      )}

      {phase.kind === "declined" ? (
        <div className="flex items-center gap-sm">
          <span className="text-body-sm text-muted-foreground">
            参加しないにしました。
          </span>
          {phase.snapshot !== null ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (phase.snapshot !== null) {
                  onUndo(phase.snapshot);
                }
              }}
            >
              取り消す
            </Button>
          ) : null}
        </div>
      ) : phase.kind === "undo-failed" ? (
        <p role="alert" className="text-body-sm text-destructive">
          招待を復元できませんでした。招待者に再度の招待を依頼してください。
        </p>
      ) : isEffectivelyCanceled ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={phase.kind === "busy"}
          onClick={() => onDecline(false)}
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
            onClick={() => onDecline(true)}
          >
            参加しない
          </Button>
        </div>
      )}
    </li>
  );
}
