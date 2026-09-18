import { beforeEach, describe, expect, it, vi } from "vitest";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const OCCURRENCE_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_OCCURRENCE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const SECRET = "secret internal detail";

const mockGetUser = vi.fn();
const mockRpc = vi.fn();
const occurrenceQuery = {
  select: vi.fn(() => occurrenceQuery),
  eq: vi.fn(() => occurrenceQuery),
  order: vi.fn(() => occurrenceQuery),
  range: vi.fn(),
};
const eventQuery = {
  select: vi.fn(() => eventQuery),
  eq: vi.fn(() => eventQuery),
  maybeSingle: vi.fn(),
};
const supabaseStub = {
  auth: { getUser: mockGetUser },
  from: vi.fn((table: string) =>
    table === "events" ? eventQuery : occurrenceQuery,
  ),
  rpc: mockRpc,
};

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => supabaseStub),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

const { updateEventRangeAction } = await import("./events.js");

function insideRangeOccurrence(id = OCCURRENCE_ID) {
  return { id, starts_at: "2026-05-10T09:00:00Z" };
}

function runRangeUpdate() {
  return updateEventRangeAction({
    eventId: EVENT_ID,
    startsOn: "2026-05-01",
    endsOn: "2026-05-31",
  });
}

describe("updateEventRangeAction occurrence pre-validation", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockRpc.mockReset();
    occurrenceQuery.select.mockClear();
    occurrenceQuery.eq.mockClear();
    occurrenceQuery.order.mockClear();
    occurrenceQuery.range.mockReset();
    eventQuery.select.mockClear();
    eventQuery.eq.mockClear();
    eventQuery.maybeSingle.mockReset();
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
    occurrenceQuery.range.mockResolvedValue({
      data: [insideRangeOccurrence()],
      count: 1,
      error: null,
      status: 200,
      statusText: "OK",
    });
    eventQuery.maybeSingle.mockResolvedValue({
      data: { id: EVENT_ID },
      error: null,
    });
    mockRpc.mockResolvedValue({ data: [], error: null });
  });

  it("reads only the current occurrence identity/start fields and proceeds when all are in range", async () => {
    const result = await runRangeUpdate();

    expect(result.data).toEqual({ ok: true });
    expect(eventQuery.eq).toHaveBeenLastCalledWith("owner_id", USER_ID);
    expect(occurrenceQuery.select).toHaveBeenCalledWith("id, starts_at", {
      count: "exact",
    });
    expect(occurrenceQuery.eq).toHaveBeenCalledWith("event_id", EVENT_ID);
    expect(mockRpc).toHaveBeenCalledWith("reschedule_event", {
      p_event_id: EVENT_ID,
      p_starts_on: "2026-05-01",
      p_ends_on: "2026-05-31",
      p_occurrences: [],
    });
  });

  it("stops before the RPC and identifies one outside-range occurrence by Tokyo date/time", async () => {
    occurrenceQuery.range.mockResolvedValue({
      data: [{ id: OCCURRENCE_ID, starts_at: "2026-04-30T09:00:00Z" }],
      count: 1,
      error: null,
      status: 200,
      statusText: "OK",
    });

    const result = await runRangeUpdate();

    expect(result.data).toBeUndefined();
    expect(result.serverError?.kind).toBe("validation");
    expect(result.serverError?.message).toContain("4月30日(木) 18:00");
    expect(result.serverError?.message).not.toContain(OCCURRENCE_ID);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("reports every outside-range occurrence instead of hiding later violations", async () => {
    occurrenceQuery.range.mockResolvedValue({
      data: [
        { id: OCCURRENCE_ID, starts_at: "2026-04-30T09:00:00Z" },
        { id: SECOND_OCCURRENCE_ID, starts_at: "2026-06-01T09:00:00Z" },
      ],
      count: 2,
      error: null,
      status: 200,
      statusText: "OK",
    });

    const result = await runRangeUpdate();

    expect(result.serverError?.message).toContain("4月30日(木) 18:00");
    expect(result.serverError?.message).toContain("6月1日(月) 18:00");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("stops safely when the current occurrence pre-read fails", async () => {
    occurrenceQuery.range.mockResolvedValue({
      data: null,
      count: null,
      error: { code: "XX000", message: SECRET },
      status: 500,
      statusText: "Internal Server Error",
    });

    const result = await runRangeUpdate();

    expect(result.serverError?.kind).toBe("failure");
    expect(result.serverError?.message).not.toContain(SECRET);
    expect(result.serverError?.message).toContain(
      "公演回を確認できませんでした",
    );
    expect(result.serverError?.message).toContain(
      "しばらくしてから再度お試しください。",
    );
    expect(result.serverError?.message).not.toContain("通信状況");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("keeps the DB range constraint as a safe RPC-side fallback", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "23514", message: SECRET },
    });

    const result = await runRangeUpdate();

    expect(result.serverError?.kind).toBe("validation");
    expect(result.serverError?.message).toContain("開催期間");
    expect(result.serverError?.message).toContain("公演回");
    expect(result.serverError?.message).not.toContain(SECRET);
  });

  it("pages through the complete occurrence set before validating", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) =>
      insideRangeOccurrence(
        `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`,
      ),
    );
    occurrenceQuery.range
      .mockResolvedValueOnce({
        data: firstPage,
        count: 501,
        error: null,
        status: 200,
        statusText: "OK",
      })
      .mockResolvedValueOnce({
        data: [{ id: SECOND_OCCURRENCE_ID, starts_at: "2026-06-01T09:00:00Z" }],
        count: 501,
        error: null,
        status: 200,
        statusText: "OK",
      });

    const result = await runRangeUpdate();

    expect(result.serverError?.message).toContain("6月1日(月) 18:00");
    expect(occurrenceQuery.range).toHaveBeenNthCalledWith(1, 0, 499);
    expect(occurrenceQuery.range).toHaveBeenNthCalledWith(2, 500, 999);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns permission feedback before disclosing occurrence validation details", async () => {
    eventQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
    occurrenceQuery.range.mockResolvedValue({
      data: [{ id: OCCURRENCE_ID, starts_at: "2026-04-30T09:00:00Z" }],
      count: 1,
      error: null,
      status: 200,
      statusText: "OK",
    });

    const result = await runRangeUpdate();

    expect(result.serverError?.kind).toBe("permission-denied");
    expect(result.serverError?.message).not.toContain("4月30日(木) 18:00");
    expect(occurrenceQuery.range).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
