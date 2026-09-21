import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema, userIdSchema } from "@stage-tracker/domain";
import EventDetailPage from "./page";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn<(...args: unknown[]) => unknown>(),
  getEventWithOccurrences: vi.fn<(...args: unknown[]) => unknown>(),
  listMyParticipations: vi.fn<(...args: unknown[]) => unknown>(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
  })),
}));

vi.mock("@/lib/data", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data")>("@/lib/data")),
  getEventWithOccurrences: (...args: unknown[]) =>
    mocks.getEventWithOccurrences(...args),
  listMyParticipations: (...args: unknown[]) =>
    mocks.listMyParticipations(...args),
}));

const EVENT_ID = eventIdSchema.parse("11111111-1111-4111-8111-111111111111");
const USER_ID = userIdSchema.parse("22222222-2222-4222-8222-222222222222");

describe("EventDetailPage not-found states", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.getEventWithOccurrences.mockReset();
    mocks.listMyParticipations.mockReset();
  });

  it("keeps the not-found copy for a malformed event id", async () => {
    const ui = await EventDetailPage({
      params: Promise.resolve({ eventId: "malformed" }),
      searchParams: Promise.resolve({}),
    });
    render(ui);

    expect(
      screen.getByText("指定されたイベントが見つかりません"),
    ).toBeInTheDocument();
    expect(mocks.getEventWithOccurrences).not.toHaveBeenCalled();
  });

  it("keeps the not-found copy when a valid id has no row", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    mocks.getEventWithOccurrences.mockResolvedValue({ ok: true, value: [] });
    mocks.listMyParticipations.mockResolvedValue({ ok: true, value: [] });

    const ui = await EventDetailPage({
      params: Promise.resolve({ eventId: EVENT_ID }),
      searchParams: Promise.resolve({}),
    });
    render(ui);

    expect(
      screen.getByText("指定されたイベントが見つかりません"),
    ).toBeInTheDocument();
  });
});
