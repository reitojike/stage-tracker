import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import InvitationsPage from "./page";

const mockGetUser = vi.fn();
const mockListMyReceivedInvitations = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));

vi.mock("./_data/listMyReceivedInvitations", () => ({
  listMyReceivedInvitations: (...args: unknown[]) =>
    mockListMyReceivedInvitations(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

/**
 * 受け入れ条件「StatePanel の 3 状態」の検証。`docs/v2/decisions.md`
 * 「M6 が負う責任」節どおり、fetch 失敗 -> error、権限が無い -> unavailable、
 * 0件 -> empty を正しく描画すること（DB を使わない - read boundary の結果を
 * モックする）。
 */
describe("InvitationsPage", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockListMyReceivedInvitations.mockReset();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("renders an error StatePanel on fetch failure", async () => {
    mockListMyReceivedInvitations.mockResolvedValue({
      ok: false,
      error: { kind: "failure", message: "network down" },
    });

    const ui = await InvitationsPage();
    render(ui);

    const panel = screen.getByRole("alert");
    expect(panel).toHaveAttribute("data-variant", "error");
  });

  it("renders an unavailable StatePanel on permission-denied", async () => {
    mockListMyReceivedInvitations.mockResolvedValue({
      ok: false,
      error: { kind: "permission-denied", message: "insufficient_privilege" },
    });

    const ui = await InvitationsPage();
    render(ui);

    expect(screen.getByText("招待を確認できません")).toBeInTheDocument();
    const panel = screen
      .getByText("招待を確認できません")
      .closest("[data-slot=state-panel]");
    expect(panel).toHaveAttribute("data-variant", "unavailable");
  });

  it("renders an empty StatePanel for 0 invitations", async () => {
    mockListMyReceivedInvitations.mockResolvedValue({ ok: true, value: [] });

    const ui = await InvitationsPage();
    render(ui);

    expect(screen.getByText("招待はありません")).toBeInTheDocument();
    expect(screen.getByText("未回答 0件")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "カレンダーへ戻る" }),
    ).toHaveAttribute("href", "/calendar");
  });
});
