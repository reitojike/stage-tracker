import {
  Badge,
  CompactList,
  ListRowLink,
  SectionHeading,
} from "@stage-tracker/ui";

/**
 * Exact My Page row/badge visibility is owned by this component. Account and
 * invitation semantics are owned by the relevant Living Specs; 「招待一覧」行は常時表示（0件でも消えない）、
 * pending件数>0のときのみバッジ。「イベントを追加」行は `canCreateEvent`
 * （fail-closed）が true のときのみ表示（無効化ではなく非表示）。
 */
export function ScheduleAndEventSection({
  canCreateEvent,
  pendingInvitationCount,
}: {
  canCreateEvent: boolean;
  pendingInvitationCount: number;
}) {
  return (
    <section
      aria-labelledby="mypage-schedule-event-heading"
      className="flex flex-col gap-sm border-b-2 border-border pb-lg"
    >
      <SectionHeading id="mypage-schedule-event-heading">
        予定とイベント
      </SectionHeading>
      <CompactList>
        <li>
          <ListRowLink href="/catalog/invitations">
            <span className="flex items-center justify-between gap-sm">
              <span>招待一覧</span>
              {pendingInvitationCount > 0 ? (
                <Badge variant="subtle">
                  未回答 {pendingInvitationCount}件
                </Badge>
              ) : null}
            </span>
          </ListRowLink>
        </li>
        {canCreateEvent ? (
          <li>
            <ListRowLink href="/catalog/events/new">イベントを追加</ListRowLink>
          </li>
        ) : null}
      </CompactList>
    </section>
  );
}
