import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import NotificationsPage from "./page";
import NotificationsLoading from "./loading";

const mockCreateSupabaseServerClient = vi.fn();
const mockRequireAuthenticatedUserId = vi.fn();
const mockListMyNotifications = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => mockCreateSupabaseServerClient(),
}));

vi.mock("@/app/_lib/require-authenticated-user-id", () => ({
  requireAuthenticatedUserId: (...args: unknown[]) =>
    mockRequireAuthenticatedUserId(...args),
}));

vi.mock("@/lib/data/reads/notifications", () => ({
  listMyNotifications: (...args: unknown[]) => mockListMyNotifications(...args),
}));

vi.mock("./_components/NotificationsList", () => ({
  NotificationsList: ({
    initialNotifications,
  }: {
    readonly initialNotifications: readonly { id: string }[];
  }) => (
    <ul aria-label="お知らせ一覧">
      {initialNotifications.map((notification) => (
        <li key={notification.id}>{notification.id}</li>
      ))}
    </ul>
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
      value: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          kind: "invitation_received",
          sourceId: "33333333-3333-4333-8333-333333333333",
          createdAt: "2026-09-17T00:00:00.000Z",
          readAt: null,
          source: { status: "resolved" },
        },
      ],
    });

    const ui = await NotificationsPage();
    render(ui);

    expect(screen.getByRole("heading", { name: "お知らせ" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "お知らせ一覧" })).toBeInTheDocument();
    expect(
      screen.getByText("22222222-2222-4222-8222-222222222222"),
    ).toBeInTheDocument();
    expect(mockListMyNotifications).toHaveBeenCalledWith({});
  });

  it("uses the canonical empty StatePanel copy", async () => {
    mockListMyNotifications.mockResolvedValue({ ok: true, value: [] });

    const ui = await NotificationsPage();
    render(ui);

    expect(screen.getByRole("heading", { name: "お知らせ" })).toBeInTheDocument();
    expect(screen.getByText("お知らせはありません")).toBeInTheDocument();
    expect(
      screen.getByText("新しいお知らせが届くとここに表示されます。"),
    ).toBeInTheDocument();
    expect(screen.getByText("お知らせはありません").closest("[data-slot=state-panel]")).toHaveAttribute(
      "data-variant",
      "empty",
    );
  });

  it("keeps list failures as an error StatePanel", async () => {
    mockListMyNotifications.mockResolvedValue({
      ok: false,
      error: { kind: "failure", message: "private failure", phase: "notification-list" },
    });

    const ui = await NotificationsPage();
    render(ui);

    expect(screen.getByRole("alert")).toHaveAttribute("data-variant", "error");
    expect(screen.getByText("お知らせを読み込めませんでした")).toBeInTheDocument();
    expect(
      screen.getByText("しばらくしてから再度お試しください。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("お知らせはありません")).not.toBeInTheDocument();
  });

  it("keeps source-resolution failures as screen errors instead of resolved rows", async () => {
    mockListMyNotifications.mockResolvedValue({
      ok: false,
      error: {
        kind: "failure",
        message: "private source failure",
        phase: "source-resolution",
      },
    });

    const ui = await NotificationsPage();
    render(ui);

    expect(screen.getByRole("alert")).toHaveAttribute("data-variant", "error");
    expect(screen.getByText("お知らせを読み込めませんでした")).toBeInTheDocument();
    expect(
      screen.queryByText("この招待はすでに終了しています。"),
    ).not.toBeInTheDocument();
  });

  it("renders an unavailable StatePanel when auth is unavailable", async () => {
    mockRequireAuthenticatedUserId.mockResolvedValue({
      ok: false,
      error: { kind: "unauthenticated", message: "not signed in" },
    });

    const ui = await NotificationsPage();
    render(ui);

    expect(screen.getByRole("heading", { name: "お知らせ" })).toBeInTheDocument();
    expect(screen.getByText("サインインが必要です")).toBeInTheDocument();
    expect(mockListMyNotifications).not.toHaveBeenCalled();
  });

  it("keeps the loading heading chrome aligned with the production page", () => {
    render(<NotificationsLoading />);

    expect(screen.getByRole("heading", { name: "お知らせ" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("読み込み中…");
  });
});
