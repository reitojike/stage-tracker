import { Badge, CompactList, ListRowLink } from "@stage-tracker/ui";

/**
 * AGENTS.md「マイページ」: 「招待一覧」行は常時表示（0件でも消えない）、
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
      <h2
        id="mypage-schedule-event-heading"
        className="text-title leading-title font-semibold text-foreground"
      >
        予定とイベント
      </h2>
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
