import { beforeEach, describe, expect, it, vi } from "vitest";

const notificationIdA = "11111111-1111-4111-8111-111111111111";
const notificationIdB = "22222222-2222-4222-8222-222222222222";
const notificationIdC = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";

const mockGetUser = vi.fn();
const mockRpc = vi.fn();
const mockRevalidatePath = vi.fn();
const supabaseStub = {
  auth: { getUser: mockGetUser },
  rpc: mockRpc,
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => supabaseStub),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

const { markNotificationsReadAction } = await import("./notifications.js");

describe("markNotificationsReadAction", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockRpc.mockReset();
    mockRevalidatePath.mockReset();
    mockGetUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it("passes only the deduplicated rendered IDs to the existing single-ID RPC", async () => {
    const result = await markNotificationsReadAction({
      notificationIds: [notificationIdA, notificationIdA, notificationIdB],
    });

    expect(result.data).toEqual({ ok: true });
    expect(mockRpc.mock.calls).toEqual([
      ["mark_notification_read", { p_notification_id: notificationIdA }],
      ["mark_notification_read", { p_notification_id: notificationIdB }],
    ]);
    expect(mockRevalidatePath.mock.calls).toEqual([
      ["/notifications"],
      ["/(app)", "layout"],
    ]);
  });

  it("rejects invalid or over-bounded shapes before any write", async () => {
    const result = await markNotificationsReadAction({
      notificationIds: ["not-a-uuid"],
    });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toBeUndefined();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("treats missing/foreign and already-read RPC no-ops as privacy-preserving success", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const result = await markNotificationsReadAction({
      notificationIds: [notificationIdC],
    });

    expect(result.data).toEqual({ ok: true });
    expect(result.data).not.toHaveProperty("notificationIds");
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("does not claim success when one RPC fails, while successful IDs remain canonical and retryable", async () => {
    const rawMessage = "private database failure detail";
    mockRpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: rawMessage, code: "XX000" },
      })
      .mockResolvedValueOnce({ data: null, error: null });

    const result = await markNotificationsReadAction({
      notificationIds: [notificationIdA, notificationIdB, notificationIdC],
    });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toEqual({
      kind: "failure",
      message: "お知らせを既読にできませんでした。",
    });
    expect(result.serverError?.message).not.toContain(rawMessage);
    expect(mockRpc).toHaveBeenCalledTimes(3);
    expect(mockRevalidatePath.mock.calls).toEqual([
      ["/notifications"],
      ["/(app)", "layout"],
    ]);
  });
});
