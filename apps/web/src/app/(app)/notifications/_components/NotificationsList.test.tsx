import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  instantSchema,
  invitationIdSchema,
  occurrenceIdSchema,
  userIdSchema,
} from "@stage-tracker/domain";
import type { NotificationListItem } from "@/lib/data/reads/notifications";
import { NotificationsList } from "./NotificationsList";

const mockMarkNotificationsReadAction = vi.fn();

vi.mock("@/lib/actions/notifications", () => ({
  markNotificationsReadAction: (...args: unknown[]) =>
    mockMarkNotificationsReadAction(...args),
}));

const NOTIFICATION_ID_A = "11111111-1111-4111-8111-111111111111";
const NOTIFICATION_ID_B = "22222222-2222-4222-8222-222222222222";
const SOURCE_ID = invitationIdSchema.parse(
  "33333333-3333-4333-8333-333333333333",
);
const OCCURRENCE_ID = occurrenceIdSchema.parse(
  "44444444-4444-4444-8444-444444444444",
);
const INVITER_ID = userIdSchema.parse("55555555-5555-4555-8555-555555555555");

function buildNotification(options?: {
  readonly id?: string;
  readonly createdAt?: string;
  readonly readAt?: string | null;
  readonly source?: NotificationListItem["source"];
}): NotificationListItem {
  return {
    id: options?.id ?? NOTIFICATION_ID_A,
    kind: "invitation_received",
    sourceId: SOURCE_ID,
    createdAt: options?.createdAt ?? "2026-09-17T00:00:00.000Z",
    readAt: options?.readAt ?? null,
    source: options?.source ?? {
      status: "active",
      invitationId: SOURCE_ID,
      occurrenceId: OCCURRENCE_ID,
      inviterId: INVITER_ID,
    },
  };
}

describe("NotificationsList", () => {
  beforeEach(() => {
    mockMarkNotificationsReadAction.mockReset();
    mockMarkNotificationsReadAction.mockResolvedValue({ data: { ok: true } });
  });

  it("renders the supplied order, exact title, Tokyo timestamp, list semantics, and accessible read cue", async () => {
    const first = buildNotification({ id: NOTIFICATION_ID_A });
    const second = buildNotification({
      id: NOTIFICATION_ID_B,
      createdAt: "2026-09-16T00:00:00.000Z",
      readAt: "2026-09-17T00:01:00.000Z",
    });

    render(<NotificationsList initialNotifications={[first, second]} />);

    expect(
      screen.getByRole("list", { name: "お知らせ一覧" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("参加への招待が届いています")).toHaveLength(2);
    expect(screen.getByText("9月17日(木) 09:00")).toBeInTheDocument();
    expect(screen.getByText("9月16日(水) 09:00")).toBeInTheDocument();
    expect(screen.getByText("未読")).toBeInTheDocument();
    expect(screen.getByText("既読")).toBeInTheDocument();
    expect(screen.getByText("未読")).toHaveAttribute("aria-label", "未読");

    const rows = screen.getAllByTestId("notification-row");
    expect(rows[0]).toHaveAttribute("data-notification-id", NOTIFICATION_ID_A);
    expect(rows[1]).toHaveAttribute("data-notification-id", NOTIFICATION_ID_B);
    await waitFor(() =>
      expect(mockMarkNotificationsReadAction).toHaveBeenCalled(),
    );
  });

  it("navigates active sources and exposes no action for resolved sources", async () => {
    const resolved = buildNotification({
      id: NOTIFICATION_ID_B,
      source: { status: "resolved" },
    });

    render(
      <NotificationsList
        initialNotifications={[buildNotification(), resolved]}
      />,
    );

    const activeLink = screen.getByRole("link", {
      name: /参加への招待が届いています/,
    });
    expect(activeLink).toHaveAttribute("href", "/catalog/invitations");
    expect(
      screen.getByText("この招待はすでに終了しています。"),
    ).toBeInTheDocument();
    const resolvedRow = screen
      .getByText("この招待はすでに終了しています。")
      .closest("li");
    expect(resolvedRow).not.toBeNull();
    expect(resolvedRow).not.toHaveTextContent("参加する");
    expect(resolvedRow).not.toHaveTextContent("参加しない");
    expect(resolvedRow?.querySelector("a,button")).toBeNull();
  });

  it("submits only the rendered snapshot IDs after render, including already-read and resolved rows", async () => {
    const rendered = [
      buildNotification({ id: NOTIFICATION_ID_A, readAt: null }),
      buildNotification({
        id: NOTIFICATION_ID_B,
        readAt: "2026-09-17T00:01:00.000Z",
        source: { status: "resolved" },
      }),
    ];

    render(<NotificationsList initialNotifications={rendered} />);

    await waitFor(() =>
      expect(mockMarkNotificationsReadAction).toHaveBeenCalledWith({
        notificationIds: [NOTIFICATION_ID_A, NOTIFICATION_ID_B],
      }),
    );
    expect(
      mockMarkNotificationsReadAction.mock.calls[0]?.[0],
    ).not.toHaveProperty("before");
  });

  it("keeps unread presentation and offers retry when the read-state write fails", async () => {
    const user = userEvent.setup();
    mockMarkNotificationsReadAction
      .mockResolvedValueOnce({
        serverError: {
          kind: "failure",
          message: "private server detail must not reach the UI",
        },
      })
      .mockResolvedValueOnce({ data: { ok: true } });

    render(<NotificationsList initialNotifications={[buildNotification()]} />);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "お知らせを既読にできませんでした",
      ),
    );
    expect(screen.getByText("未読")).toBeInTheDocument();
    expect(screen.getByRole("alert").textContent).not.toContain(
      "private server detail",
    );

    await user.click(screen.getByRole("button", { name: "もう一度試す" }));

    await waitFor(() => expect(screen.getByText("既読")).toBeInTheDocument());
    expect(mockMarkNotificationsReadAction).toHaveBeenCalledTimes(2);
  });

  it("keeps rejected read-state requests visible and retryable", async () => {
    const user = userEvent.setup();
    mockMarkNotificationsReadAction
      .mockRejectedValueOnce(new Error("request rejected"))
      .mockResolvedValueOnce({ data: { ok: true } });

    render(<NotificationsList initialNotifications={[buildNotification()]} />);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "お知らせを既読にできませんでした",
      ),
    );
    expect(screen.getByText("未読")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "もう一度試す" }));

    await waitFor(() => expect(screen.getByText("既読")).toBeInTheDocument());
    expect(mockMarkNotificationsReadAction).toHaveBeenCalledTimes(2);
  });

  it("does not resubmit an unchanged snapshot after a successful revalidation", async () => {
    const { rerender } = render(
      <NotificationsList initialNotifications={[buildNotification()]} />,
    );

    await waitFor(() =>
      expect(mockMarkNotificationsReadAction).toHaveBeenCalledTimes(1),
    );

    rerender(
      <NotificationsList initialNotifications={[buildNotification()]} />,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockMarkNotificationsReadAction).toHaveBeenCalledTimes(1);
  });

  it("remains safe when React development remounts the effect", async () => {
    render(
      <StrictMode>
        <NotificationsList initialNotifications={[buildNotification()]} />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(mockMarkNotificationsReadAction.mock.calls.length).toBeGreaterThan(
        0,
      ),
    );
    for (const [input] of mockMarkNotificationsReadAction.mock.calls) {
      expect(input).toEqual({ notificationIds: [NOTIFICATION_ID_A] });
    }
  });

  it("uses the existing Tokyo formatter input as a Notification timestamp", () => {
    const item = buildNotification({
      createdAt: instantSchema.parse("2026-09-17T14:30:00Z"),
    });

    render(<NotificationsList initialNotifications={[item]} />);

    expect(screen.getByText("9月17日(木) 23:30")).toBeInTheDocument();
  });
});
