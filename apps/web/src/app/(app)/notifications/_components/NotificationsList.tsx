"use client";

import { useEffect, useMemo, useState } from "react";
import type { Instant } from "@stage-tracker/domain";
import {
  Button,
  CompactList,
  ListRow,
  ListRowLink,
  StatePanel,
} from "@stage-tracker/ui";
import { markNotificationsReadAction } from "@/lib/actions/notifications";
import type { NotificationListItem } from "@/lib/data/reads/notifications";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import { formatTokyoDateTimeJa } from "@/app/_lib/format";

const INVITATION_NOTIFICATION_TITLE = "参加への招待が届いています";
const RESOLVED_INVITATION_MESSAGE = "この招待はすでに終了しています。";
const READ_STATE_FAILURE_TITLE = "お知らせを既読にできませんでした";

export interface NotificationsListProps {
  readonly initialNotifications: readonly NotificationListItem[];
}

/**
 * The Notifications screen's only client boundary. The server supplies a
 * bounded list snapshot; this component passes the exact IDs it renders to
 * the existing #512 action after the rows have committed on the client.
 * Local read presentation changes only after the action succeeds, and a
 * failed write leaves the canonical unread cue visible with a retry.
 */
export function NotificationsList({
  initialNotifications,
}: NotificationsListProps) {
  const renderedIds = useMemo(
    () => initialNotifications.map((notification) => notification.id),
    [initialNotifications],
  );
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        initialNotifications
          .filter((notification) => notification.readAt !== null)
          .map((notification) => notification.id),
      ),
  );
  const [readWriteError, setReadWriteError] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    async function markRenderedNotificationsRead() {
      const result = await markNotificationsReadAction({
        notificationIds: renderedIds,
      });
      if (!active) {
        return;
      }

      if (result?.data?.ok === true) {
        setReadIds(new Set(renderedIds));
        setReadWriteError(false);
      } else {
        setReadWriteError(true);
      }
    }

    void markRenderedNotificationsRead();

    return () => {
      active = false;
    };
  }, [renderedIds, retryAttempt]);

  return (
    <div className="flex flex-col gap-md">
      {readWriteError ? (
        <StatePanel
          variant="error"
          title={READ_STATE_FAILURE_TITLE}
          description={READ_FAILURE_RETRY_HINT_JA}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRetryAttempt((attempt) => attempt + 1)}
            >
              もう一度試す
            </Button>
          }
        />
      ) : null}

      <CompactList aria-label="お知らせ一覧">
        {initialNotifications.map((notification) => (
          <li
            key={notification.id}
            data-testid="notification-row"
            data-notification-id={notification.id}
          >
            <NotificationRow
              notification={notification}
              isRead={
                notification.readAt !== null || readIds.has(notification.id)
              }
            />
          </li>
        ))}
      </CompactList>
    </div>
  );
}

function NotificationRow({
  notification,
  isRead,
}: {
  readonly notification: NotificationListItem;
  readonly isRead: boolean;
}) {
  const content = (
    <span className="flex min-w-0 flex-col gap-2xs">
      <span className="flex flex-wrap items-center gap-xs">
        <span className="text-title font-medium text-foreground">
          {INVITATION_NOTIFICATION_TITLE}
        </span>
        <span
          aria-label={isRead ? "既読" : "未読"}
          className={
            isRead
              ? "text-body-sm text-muted-foreground"
              : "text-body-sm font-medium text-primary"
          }
        >
          {isRead ? "既読" : "未読"}
        </span>
      </span>
      <time
        dateTime={notification.createdAt}
        className="text-body-sm text-muted-foreground"
      >
        {formatTokyoDateTimeJa(notification.createdAt as Instant)}
      </time>
      {notification.source.status === "resolved" ? (
        <span className="text-body-sm text-muted-foreground">
          {RESOLVED_INVITATION_MESSAGE}
        </span>
      ) : null}
    </span>
  );

  if (notification.source.status === "active") {
    return (
      <ListRowLink
        href="/catalog/invitations"
        aria-label={`${INVITATION_NOTIFICATION_TITLE}（招待を見る）`}
      >
        {content}
      </ListRowLink>
    );
  }

  return <ListRow>{content}</ListRow>;
}
