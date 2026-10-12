import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TicketsPage from "./page";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
  selected: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/app/_lib/require-authenticated-user-id", () => ({
  requireAuthenticatedUserId: mocks.auth,
}));
vi.mock("./_lib/tickets-loader", () => ({ loadTicketsTimeline: mocks.list }));
vi.mock("./_lib/selected-ticket", async (original) => ({
  ...(await original<typeof import("./_lib/selected-ticket")>()),
  loadSelectedTicket: mocks.selected,
}));
vi.mock("./_components/TicketsView", () => ({
  TicketsView: () => <div>一覧表示</div>,
}));
vi.mock("./_components/SelectedTicketView", () => ({
  SelectedTicketView: () => <div>受付表示</div>,
}));
const ID = "44444444-4444-4444-8444-444444444444";
const USER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue({ ok: true, value: USER });
  mocks.list.mockReset();
  mocks.selected.mockReset();
});

describe("TicketsPage route mode", () => {
  it("uses the existing list without selection", async () => {
    render(
      await TicketsPage({ searchParams: Promise.resolve({ view: "planned" }) }),
    );
    expect(screen.getByText("一覧表示")).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(mocks.selected).not.toHaveBeenCalled();
  });
  it("selection precedes the list view and passes only current user and public ID", async () => {
    render(
      await TicketsPage({
        searchParams: Promise.resolve({ opportunity: ID, view: "past" }),
      }),
    );
    expect(screen.getByText("受付表示")).toBeInTheDocument();
    expect(mocks.selected).toHaveBeenCalledWith(
      expect.anything(),
      USER,
      ID,
      expect.anything(),
    );
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it.each(["bad", [ID], [ID, ID]])(
    "rejects invalid or repeated selection %s before reading",
    async (opportunity) => {
      render(
        await TicketsPage({
          searchParams: Promise.resolve({ opportunity, view: "upcoming" }),
        }),
      );
      expect(
        screen.getByText("受付の指定が正しくありません"),
      ).toBeInTheDocument();
      expect(mocks.list).not.toHaveBeenCalled();
      expect(mocks.selected).not.toHaveBeenCalled();
    },
  );
  it("keeps unauthenticated access gated before selection reads", async () => {
    mocks.auth.mockResolvedValueOnce({
      ok: false,
      error: { kind: "unauthenticated" },
    });
    render(
      await TicketsPage({ searchParams: Promise.resolve({ opportunity: ID }) }),
    );
    expect(screen.getByText("サインインが必要です")).toBeInTheDocument();
    expect(mocks.selected).not.toHaveBeenCalled();
  });
  it("keeps auth read failure distinct from logged out", async () => {
    mocks.auth.mockResolvedValueOnce({ ok: false, error: { kind: "failure" } });
    render(
      await TicketsPage({ searchParams: Promise.resolve({ opportunity: ID }) }),
    );
    expect(
      screen.getByText("チケット情報を読み込めませんでした"),
    ).toBeInTheDocument();
    expect(mocks.selected).not.toHaveBeenCalled();
  });
});
