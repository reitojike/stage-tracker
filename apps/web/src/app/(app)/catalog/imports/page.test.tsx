import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import OfficialImportReviewPage from "./page";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const mockGetUser = vi.fn();
const mockIsCreator = vi.fn();
const mockLoadQueue = vi.fn();
const mockLoadHeldPages = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));

vi.mock("@/lib/data/creator-capability", () => ({
  isDesignatedCatalogCreator: (...args: unknown[]) => {
    const result: unknown = mockIsCreator(...args);
    return result;
  },
}));

vi.mock("@/lib/actions/officialImportApply.actions", () => ({
  startOfficialImportApplyAction: vi.fn(),
}));
vi.mock("@/workflows/official-import/apply-workflow", () => ({
  officialImportApplyWorkflow: vi.fn(),
}));

vi.mock("./_lib/review-loader", () => ({
  loadOfficialImportReviewQueue: (...args: unknown[]) => {
    const result: unknown = mockLoadQueue(...args);
    return result;
  },
}));
vi.mock("./_lib/held-page-loader", () => ({
  loadLatestKabukiHeldPageReport: (...args: unknown[]) => {
    const result: unknown = mockLoadHeldPages(...args);
    return result;
  },
}));

describe("OfficialImportReviewPage", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockIsCreator.mockReset();
    mockLoadQueue.mockReset();
    mockLoadHeldPages.mockReset();
  });

  it("does not read or render the queue for a non-creator", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    mockIsCreator.mockResolvedValue(false);

    render(await OfficialImportReviewPage());

    expect(
      screen.getByText("公式情報を確認する権限がありません"),
    ).toBeInTheDocument();
    expect(mockLoadQueue).not.toHaveBeenCalled();
    expect(mockLoadHeldPages).not.toHaveBeenCalled();
  });

  it("renders the creator queue through the ordinary authenticated client", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    mockIsCreator.mockResolvedValue(true);
    mockLoadQueue.mockResolvedValue({ ok: true, value: [] });
    mockLoadHeldPages.mockResolvedValue({ ok: true, value: null });

    render(await OfficialImportReviewPage());

    expect(
      screen.getByRole("heading", { name: "公式情報の確認" }),
    ).toBeInTheDocument();
    expect(screen.getByText("確認待ちの候補はありません")).toBeInTheDocument();
    expect(mockLoadQueue).toHaveBeenCalledTimes(1);
    expect(mockLoadHeldPages).toHaveBeenCalledTimes(1);
  });

  it("requires authentication", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    render(await OfficialImportReviewPage());

    expect(screen.getByText("サインインが必要です")).toBeInTheDocument();
    expect(mockIsCreator).not.toHaveBeenCalled();
  });
});
