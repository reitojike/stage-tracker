import { LinkButton, PageHeading, StatePanel } from "@stage-tracker/ui";
import { classifyReadResult } from "@/lib/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthenticatedUserId } from "@/app/_lib/require-authenticated-user-id";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import {
  decodeNotificationCursor,
  encodeNotificationCursor,
  listMyNotifications,
  type NotificationCursor,
} from "@/lib/data/reads/notifications";
import { NotificationsList } from "./_components/NotificationsList";

interface NotificationsPageProps {
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}

interface NotificationPageLocation {
  readonly cursor: NotificationCursor | null;
  readonly before: NotificationCursor | null;
  readonly snapshot: NotificationCursor | null;
}

function firstSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function buildPageHref(location: NotificationPageLocation): string {
  const params = new URLSearchParams();
  if (location.cursor !== null) {
    params.set("cursor", encodeNotificationCursor(location.cursor));
  }
  if (location.before !== null) {
    params.set("before", encodeNotificationCursor(location.before));
  }
  if (location.snapshot !== null) {
    params.set("snapshot", encodeNotificationCursor(location.snapshot));
  }
  const query = params.toString();
  return query.length === 0 ? "/notifications" : `/notifications?${query}`;
}

function getPageLocation(
  params: Record<string, string | string[] | undefined>,
): NotificationPageLocation {
  const before = decodeNotificationCursor(firstSearchParam(params.before));
  return {
    cursor:
      before === null
        ? decodeNotificationCursor(firstSearchParam(params.cursor))
        : null,
    before,
    snapshot: decodeNotificationCursor(firstSearchParam(params.snapshot)),
  };
}

function getPreviousLocation(
  location: NotificationPageLocation,
  firstCursor: NotificationCursor | null,
  hasPrevious: boolean,
): NotificationPageLocation | null {
  if (!hasPrevious || firstCursor === null) {
    return null;
  }
  return {
    cursor: null,
    before: firstCursor,
    snapshot: location.snapshot,
  };
}

function getNextLocation(
  location: NotificationPageLocation,
  nextCursor: NotificationCursor,
): NotificationPageLocation {
  return {
    cursor: nextCursor,
    before: null,
    snapshot: location.snapshot,
  };
}

function cursorFromNotification(notification: {
  readonly createdAt: string;
  readonly id: string;
}): NotificationCursor {
  return { createdAt: notification.createdAt, id: notification.id };
}

function NotificationsPageNavigation({
  previousHref,
  nextHref,
}: {
  readonly previousHref?: string;
  readonly nextHref?: string;
}) {
  if (previousHref === undefined && nextHref === undefined) {
    return null;
  }
  return (
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
  );
}

/** Authenticated persisted Notification inbox (`/notifications`). */
export default async function NotificationsPage({
  searchParams,
}: NotificationsPageProps = {}) {
  const supabase = await createSupabaseServerClient();
  const userResult = await requireAuthenticatedUserId(supabase);

  if (!userResult.ok) {
    return (
      <div className="flex flex-col gap-md">
        <PageHeading>お知らせ</PageHeading>
        <StatePanel
          variant={
            userResult.error.kind === "failure" ? "error" : "unavailable"
          }
          title={
            userResult.error.kind === "failure"
              ? "お知らせを読み込めませんでした"
              : "サインインが必要です"
          }
          {...(userResult.error.kind === "failure"
            ? { description: READ_FAILURE_RETRY_HINT_JA }
            : {})}
        />
      </div>
    );
  }

  const params = searchParams === undefined ? {} : await searchParams;
  const location = getPageLocation(params);
  const result = await listMyNotifications(supabase, location.cursor, {
    before: location.before,
    snapshot: location.snapshot,
  });
  const state =
    !result.ok && result.error.phase === "source-resolution"
      ? { variant: "error" as const }
      : classifyReadResult(
          result,
          (value) => value,
          (data) => data.items.length === 0,
        );

  const firstNotification =
    state.variant === "populated" ? state.data.items[0] : undefined;
  const firstCursor =
    firstNotification === undefined
      ? null
      : cursorFromNotification(firstNotification);
  const previousLocation = getPreviousLocation(
    location,
    firstCursor,
    state.variant === "populated" && state.data.hasPrevious,
  );
  const previousHref =
    previousLocation === null ? undefined : buildPageHref(previousLocation);
  const nextHref =
    state.variant === "populated" && state.data.nextCursor !== null
      ? buildPageHref(
          getNextLocation(
            {
              ...location,
              snapshot: location.snapshot ?? firstCursor,
            },
            state.data.nextCursor,
          ),
        )
      : undefined;
  const navigationProps: {
    readonly previousHref?: string;
    readonly nextHref?: string;
  } = {
    ...(previousHref === undefined ? {} : { previousHref }),
    ...(nextHref === undefined ? {} : { nextHref }),
  };

  return (
    <div className="flex flex-col gap-md">
      <PageHeading>お知らせ</PageHeading>
      {state.variant === "unavailable" || state.variant === "error" ? (
        <StatePanel
          variant={state.variant}
          title={
            state.variant === "error"
              ? "お知らせを読み込めませんでした"
              : "お知らせを確認できません"
          }
          {...(state.variant === "error"
            ? { description: READ_FAILURE_RETRY_HINT_JA }
            : {})}
        />
      ) : state.variant === "empty" ? (
        <>
          <StatePanel
            variant="empty"
            title="お知らせはありません"
            description="新しいお知らせが届くとここに表示されます。"
          />
          <NotificationsPageNavigation {...navigationProps} />
        </>
      ) : (
        <NotificationsList
          initialNotifications={state.data.items}
          {...navigationProps}
        />
      )}
    </div>
  );
}
