import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  eventIdSchema,
  instantSchema,
  tokyoCalendarDateSchema,
  userIdSchema,
  type Event,
} from "@stage-tracker/domain";
import EditEventPage from "./page";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getEventForEdit: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
  })),
}));

vi.mock("./_data/getEventForEdit", () => ({
  getEventForEdit: (...args: unknown[]) => mocks.getEventForEdit(...args),
}));

const EVENT_ID = eventIdSchema.parse("11111111-1111-4111-8111-111111111111");
const OWNER_ID = userIdSchema.parse("22222222-2222-4222-8222-222222222222");
const OTHER_USER_ID = userIdSchema.parse(
  "33333333-3333-4333-8333-333333333333",
);

function buildEvent(ownerId: string): Event {
  return {
    id: EVENT_ID,
    ownerId: userIdSchema.parse(ownerId),
    title: "My Event",
    venue: null,
    sourceUrl: null,
    memo: null,
    startsOn: tokyoCalendarDateSchema.parse("2026-05-01"),
    endsOn: tokyoCalendarDateSchema.parse("2026-05-31"),
    canceledAt: null,
    createdAt: instantSchema.parse("2026-01-01T00:00:00Z"),
    updatedAt: instantSchema.parse("2026-01-01T00:00:00Z"),
  };
}

/**
 * 受け入れ条件「非 owner が編集画面で permission-denied になること」の
 * 検証。DB を使わず、read boundary の結果をモックして画面分岐だけを
 * 確認する。
 */
describe("EditEventPage", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.getEventForEdit.mockReset();
    mocks.refresh.mockReset();
  });

  it("renders a permission-denied panel for a non-owner", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: OTHER_USER_ID } } });
    mocks.getEventForEdit.mockResolvedValue({
      ok: true,
      value: [{ event: buildEvent(OWNER_ID), occurrences: [] }],
    });

    const ui = await EditEventPage({
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    render(ui);

    expect(screen.getByText("編集する権限がありません")).toBeInTheDocument();
    expect(screen.queryByText("イベントを編集")).not.toBeInTheDocument();
  });

  it("renders the edit form for the owner", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: OWNER_ID } } });
    mocks.getEventForEdit.mockResolvedValue({
      ok: true,
      value: [{ event: buildEvent(OWNER_ID), occurrences: [] }],
    });

    const ui = await EditEventPage({
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    render(ui);

    expect(screen.getByText("イベントを編集")).toBeInTheDocument();
  });

  it("renders an empty panel when the event does not exist", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: OWNER_ID } } });
    mocks.getEventForEdit.mockResolvedValue({ ok: true, value: [] });

    const ui = await EditEventPage({
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    render(ui);

    expect(
      screen.getByText("指定されたイベントが見つかりません"),
    ).toBeInTheDocument();
  });
});
