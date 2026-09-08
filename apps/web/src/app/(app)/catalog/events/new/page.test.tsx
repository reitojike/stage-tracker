import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import NewEventPage from "./page";

const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    }),
  })),
}));

/**
 * 受け入れ条件「非 creator が Event 作成画面で permission-denied になる
 * こと」の検証。`isDesignatedCatalogCreator`（fail-closed 判定）の結果に
 * 応じて画面が正しく分岐することを、Supabase client をモックして確認する
 * （DB を使わない - このタスクの受け入れ条件が要求するとおり）。
 */
describe("NewEventPage", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockMaybeSingle.mockReset();
  });

  it("renders a permission-denied panel for a non-creator", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const ui = await NewEventPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(
      screen.getByText("イベントを作成する権限がありません"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "作成する" }),
    ).not.toBeInTheDocument();
  });

  it("renders the create form for a designated creator", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockMaybeSingle.mockResolvedValue({
      data: { user_id: "user-1" },
      error: null,
    });

    const ui = await NewEventPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(
      screen.getByRole("button", { name: "作成する" }),
    ).toBeInTheDocument();
  });

  it("renders an unauthenticated panel when there is no session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const ui = await NewEventPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("ログインが必要です")).toBeInTheDocument();
  });
});
