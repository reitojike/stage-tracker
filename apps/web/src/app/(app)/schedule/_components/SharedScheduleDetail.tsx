"use client";
import type { PersonalScheduleEntryId, UserId } from "@stage-tracker/domain";
import { StatePanel } from "@stage-tracker/ui";
import { UNKNOWN_RETRY_HINT_JA } from "@/lib/user-facing-copy";
import { ScheduleEntryDetailView } from "./ScheduleEntryDetailView";
import { LeaveShareButton } from "./LeaveShareButton";
import { useSharedScheduleRead } from "./useSharedScheduleRead";
import { SharedReadNotice } from "./SharedReadNotice";

export function SharedScheduleDetail({
  entryId,
  actorId,
}: {
  readonly entryId: PersonalScheduleEntryId;
  readonly actorId: UserId;
}) {
  const { host, state, retry } = useSharedScheduleRead(
    { kind: "detail", entryId },
    actorId,
  );
  const snapshot =
    state.status === "ready" && state.data.kind === "detail"
      ? state.data
      : null;
  return (
    <div ref={host} className="flex flex-col gap-section">
      <SharedReadNotice status={state.status} retry={retry} />
      {snapshot &&
        (snapshot.entry === null ? (
          <StatePanel variant="empty" title="この予定は見つかりませんでした" />
        ) : (
          <>
            <ScheduleEntryDetailView entry={snapshot.entry} isOwner={false} />
            {!snapshot.share.ok ? (
              <StatePanel
                variant="error"
                title="共有状態を確認できませんでした"
                description={UNKNOWN_RETRY_HINT_JA}
              />
            ) : snapshot.share.value !== null ? (
              <LeaveShareButton entryId={entryId} />
            ) : null}
          </>
        ))}
    </div>
  );
}
