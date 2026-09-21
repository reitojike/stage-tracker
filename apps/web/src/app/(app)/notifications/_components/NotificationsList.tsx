"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  CompactList,
  LinkButton,
  ListRow,
  ListRowLink,
  StatePanel,
} from "@stage-tracker/ui";
import { instantSchema } from "@stage-tracker/domain";
import { markNotificationsReadAction } from "@/lib/actions/notifications";
import type { NotificationListItem } from "@/lib/data/reads/notifications";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import { formatTokyoDateTimeJa } from "@/lib/tokyo-format";

const INVITATION_NOTIFICATION_TITLE = "参加への招待が届いています";
const RESOLVED_INVITATION_MESSAGE = "この招待はすでに終了しています。";
const READ_STATE_FAILURE_TITLE = "お知らせを既読にできませんでした";

export interface NotificationsListProps {
  readonly initialNotifications: readonly NotificationListItem[];
  readonly previousHref?: string;
  readonly nextHref?: string;
}

type ReadActionResult = Awaited<ReturnType<typeof markNotificationsReadAction>>;

/**
 * The Notifications screen's only client boundary. The server supplies a
 * bounded list snapshot; this component passes the exact IDs it renders to
 * the existing #512 action after the rows have committed on the client.
 * Local read presentation changes only after the action succeeds, and a
 * failed write leaves the canonical unread cue visible with a retry.
 */
export function NotificationsList({
  initialNotifications,
  previousHref,
  nextHref,
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
  const snapshotSubmissionKey = `${renderedIds.join("\u001f")}:${retryAttempt}`;
  const submissionsRef = useRef<Map<string, Promise<ReadActionResult>>>(
    new Map(),
  );

  useEffect(() => {
    let active = true;

    let submission = submissionsRef.current.get(snapshotSubmissionKey);
    if (submission === undefined) {
      submission = markNotificationsReadAction({
        notificationIds: renderedIds,
      });
      submissionsRef.current.set(snapshotSubmissionKey, submission);
    }

    void submission.then(
      (result) => {
        if (!active) {
          return;
        }

        if (result?.data?.ok === true) {
          setReadIds(new Set(renderedIds));
          setReadWriteError(false);
        } else {
          setReadWriteError(true);
        }
      },
      () => {
        if (active) {
          setReadWriteError(true);
        }
      },
    );

    return () => {
      active = false;
    };
  }, [renderedIds, retryAttempt, snapshotSubmissionKey]);

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

      {previousHref !== undefined || nextHref !== undefined ? (
        <nav
          aria-label="お知らせのページ移動"
          className="flex items-center justify-between gap-sm"
        >
          {previousHref !== undefined ? (
            <LinkButton href={previousHref} variant="outline" size="sm">
              前の50件
            </LinkButton>
          ) : (
            <span />
          )}
          {nextHref !== undefined ? (
            <LinkButton href={nextHref} variant="outline" size="sm">
              次の50件
            </LinkButton>
          ) : null}
        </nav>
      ) : null}
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
        dateTime={instantSchema.parse(notification.createdAt)}
        className="text-body-sm text-muted-foreground"
      >
        {formatTokyoDateTimeJa(instantSchema.parse(notification.createdAt))}
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
