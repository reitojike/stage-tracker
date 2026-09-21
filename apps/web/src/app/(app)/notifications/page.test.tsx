import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import NotificationsPage from "./page";
import NotificationsLoading from "./loading";

const mockCreateSupabaseServerClient = vi.fn<(...args: unknown[]) => unknown>();
const mockRequireAuthenticatedUserId = vi.fn<(...args: unknown[]) => unknown>();
const mockListMyNotifications = vi.fn<(...args: unknown[]) => unknown>();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => mockCreateSupabaseServerClient(),
}));

vi.mock("@/app/_lib/require-authenticated-user-id", () => ({
  requireAuthenticatedUserId: (...args: unknown[]) =>
    mockRequireAuthenticatedUserId(...args),
}));

vi.mock("@/lib/data/reads/notifications", () => ({
  listMyNotifications: (...args: unknown[]) => mockListMyNotifications(...args),
  encodeNotificationCursor: (cursor: { createdAt: string; id: string }) =>
    Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url"),
  decodeNotificationCursor: (value: string | null | undefined) => {
    if (value === null || value === undefined) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(value, "base64url").toString("utf8"),
      );
      return parsed;
    } catch {
      return null;
    }
  },
}));

vi.mock("./_components/NotificationsList", () => ({
  NotificationsList: ({
    initialNotifications,
    previousHref,
    nextHref,
  }: {
    readonly initialNotifications: readonly { id: string }[];
    readonly previousHref?: string;
    readonly nextHref?: string;
  }) => (
    <>
      <ul aria-label="お知らせ一覧">
        {initialNotifications.map((notification) => (
          <li key={notification.id}>{notification.id}</li>
        ))}
      </ul>
      {previousHref ? <a href={previousHref}>前の50件</a> : null}
      {nextHref ? <a href={nextHref}>次の50件</a> : null}
    </>
  ),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";

describe("NotificationsPage", () => {
  beforeEach(() => {
    mockCreateSupabaseServerClient.mockReset();
    mockRequireAuthenticatedUserId.mockReset();
    mockListMyNotifications.mockReset();
    mockCreateSupabaseServerClient.mockResolvedValue({});
    mockRequireAuthenticatedUserId.mockResolvedValue({
      ok: true,
      value: USER_ID,
    });
  });

  it("renders the page heading and supplied populated window", async () => {
    mockListMyNotifications.mockResolvedValue({
      ok: true,
      value: {
        items: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            kind: "invitation_received",
            sourceId: "33333333-3333-4333-8333-333333333333",
            createdAt: "2026-09-17T00:00:00.000Z",
            readAt: null,
            source: { status: "resolved" },
          },
        ],
        nextCursor: null,
        hasPrevious: false,
      },
    });

    const ui = await NotificationsPage();
    render(ui);

    expect(
      screen.getByRole("heading", { name: "お知らせ" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "お知らせ一覧" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("22222222-2222-4222-8222-222222222222"),
    ).toBeInTheDocument();
    expect(mockListMyNotifications).toHaveBeenCalledWith({}, null, {
      before: null,
      snapshot: null,
    });
  });

  it("uses the canonical empty StatePanel copy", async () => {
    mockListMyNotifications.mockResolvedValue({
      ok: true,
      value: { items: [], nextCursor: null, hasPrevious: false },
    });

    const ui = await NotificationsPage();
    render(ui);

    expect(
      screen.getByRole("heading", { name: "お知らせ" }),
    ).toBeInTheDocument();
    expect(screen.getByText("お知らせはありません")).toBeInTheDocument();
    expect(
      screen.getByText("新しいお知らせが届くとここに表示されます。"),
    ).toBeInTheDocument();
    expect(
      screen
        .getByText("お知らせはありません")
        .closest("[data-slot=state-panel]"),
    ).toHaveAttribute("data-variant", "empty");
  });

  it("keeps list failures as an error StatePanel", async () => {
    mockListMyNotifications.mockResolvedValue({
      ok: false,
      error: {
        kind: "failure",
        message: "private failure",
        phase: "notification-list",
      },
    });

    const ui = await NotificationsPage();
    render(ui);

    expect(screen.getByRole("alert")).toHaveAttribute("data-variant", "error");
    expect(
      screen.getByText("お知らせを読み込めませんでした"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("しばらくしてから再度お試しください。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("お知らせはありません")).not.toBeInTheDocument();
  });

  it("keeps source-resolution failures as screen errors instead of resolved rows", async () => {
    mockListMyNotifications.mockResolvedValue({
      ok: false,
      error: {
        kind: "permission-denied",
        message: "private source failure",
        phase: "source-resolution",
      },
    });

    const ui = await NotificationsPage();
    render(ui);

    expect(screen.getByRole("alert")).toHaveAttribute("data-variant", "error");
    expect(
      screen.getByText("お知らせを読み込めませんでした"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("この招待はすでに終了しています。"),
    ).not.toBeInTheDocument();
  });

  it("exposes bounded older and previous-window navigation", async () => {
    mockListMyNotifications.mockResolvedValue({
      ok: true,
      value: {
        items: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            kind: "invitation_received",
            sourceId: "33333333-3333-4333-8333-333333333333",
            createdAt: "2026-09-17T00:00:00.000Z",
            readAt: null,
            source: { status: "resolved" },
          },
        ],
        nextCursor: {
          createdAt: "2026-09-17T00:00:00.000Z",
          id: "22222222-2222-4222-8222-222222222222",
        },
        hasPrevious: true,
      },
    });

    const firstUi = await NotificationsPage();
    render(firstUi);
    expect(screen.getByRole("link", { name: "次の50件" })).toHaveAttribute(
      "href",
      expect.stringContaining("cursor="),
    );
    cleanup();

    const olderUi = await NotificationsPage({
      searchParams: Promise.resolve({
        cursor:
          "eyJjcmVhdGVkQXQiOiIyMDI2LTA5LTE3VDAwOjAwOjAwLjAwMFoiLCJpZCI6IjIyMjIyMjIyLTIyMjItNDIyMi04MjIyLTIyMjIyMjIyMjIyMiJ9",
        snapshot:
          "eyJjcmVhdGVkQXQiOiIyMDI2LTA5LTE3VDAwOjAwOjAwLjAwMFoiLCJpZCI6IjIyMjIyMjIyLTIyMjItNDIyMi04MjIyLTIyMjIyMjIyMjIyMiJ9",
      }),
    });
    render(olderUi);
    expect(screen.getByRole("link", { name: "前の50件" })).toHaveAttribute(
      "href",
      expect.stringContaining("before="),
    );
  });

  it("renders an unavailable StatePanel when auth is unavailable", async () => {
    mockRequireAuthenticatedUserId.mockResolvedValue({
      ok: false,
      error: { kind: "unauthenticated", message: "not signed in" },
    });

    const ui = await NotificationsPage();
    render(ui);

    expect(
      screen.getByRole("heading", { name: "お知らせ" }),
    ).toBeInTheDocument();
    expect(screen.getByText("サインインが必要です")).toBeInTheDocument();
    expect(mockListMyNotifications).not.toHaveBeenCalled();
  });

  it("keeps the loading heading chrome aligned with the production page", () => {
    render(<NotificationsLoading />);

    expect(
      screen.getByRole("heading", { name: "お知らせ" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("読み込み中…");
  });
});
