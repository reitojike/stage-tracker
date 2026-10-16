import { beforeEach, describe, expect, it, vi } from "vitest";
const USER = "11111111-1111-4111-8111-111111111111";
const ENTRY = "22222222-2222-4222-8222-222222222222";
const stub = { auth: { getUser: vi.fn() }, rpc: vi.fn() };
const reads = vi.hoisted(() => ({
  listVisiblePersonalSchedule: vi.fn(),
  getVisiblePersonalScheduleEntry: vi.fn(),
  getOwnScheduleShareId: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => stub,
}));
vi.mock("@/lib/data", () => reads);
const { readSharedScheduleAction } =
  await import("./shared-schedule-read-actions");
beforeEach(() => {
  vi.clearAllMocks();
  stub.auth.getUser.mockResolvedValue({
    data: { user: { id: USER } },
    error: null,
  });
  reads.listVisiblePersonalSchedule.mockResolvedValue({ ok: true, value: [] });
  reads.getVisiblePersonalScheduleEntry.mockResolvedValue({
    ok: true,
    value: null,
  });
  reads.getOwnScheduleShareId.mockResolvedValue({ ok: true, value: null });
});
describe("authenticated shared snapshot read", () => {
  it("derives actor from session and includes only non-owned entries from the RLS read", async () => {
    reads.listVisiblePersonalSchedule.mockResolvedValue({
      ok: true,
      value: [
        { ownerId: USER, title: "own" },
        { ownerId: "other", title: "shared" },
      ],
    });
    expect((await readSharedScheduleAction({ kind: "list" }))?.data).toEqual({
      kind: "list",
      actorId: USER,
      entries: [{ ownerId: "other", title: "shared" }],
    });
    expect(reads.listVisiblePersonalSchedule).toHaveBeenCalledExactlyOnceWith(
      stub,
    );
    expect(stub.rpc).not.toHaveBeenCalled();
  });
  it("rejects caller-supplied identity and unauthenticated reads", async () => {
    const input = { kind: "list" as const, actorId: USER };
    expect(
      (await readSharedScheduleAction(input))?.validationErrors,
    ).toBeDefined();
    expect(reads.listVisiblePersonalSchedule).not.toHaveBeenCalled();
    stub.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(
      (await readSharedScheduleAction({ kind: "list" }))?.serverError?.kind,
    ).toBe("unauthenticated");
    expect(reads.listVisiblePersonalSchedule).not.toHaveBeenCalled();
  });
  it("returns the same null for an RLS-invisible or absent entry and uses the authenticated recipient", async () => {
    expect(
      (await readSharedScheduleAction({ kind: "detail", entryId: ENTRY }))
        ?.data,
    ).toMatchObject({ kind: "detail", actorId: USER, entry: null });
    expect(reads.getOwnScheduleShareId).toHaveBeenCalledExactlyOnceWith(
      stub,
      ENTRY,
      USER,
    );
  });
  it("does not convert a read failure into an authorized empty snapshot", async () => {
    reads.listVisiblePersonalSchedule.mockResolvedValue({
      ok: false,
      error: { kind: "permission-denied", message: "表示できません" },
    });
    const result = await readSharedScheduleAction({ kind: "list" });
    expect(result?.data).toBeUndefined();
    expect(result?.serverError?.kind).toBe("permission-denied");
  });
  it("keeps an authorized entry independent from a failed capability read", async () => {
    reads.getVisiblePersonalScheduleEntry.mockResolvedValue({
      ok: true,
      value: { id: ENTRY, title: "authorized" },
    });
    reads.getOwnScheduleShareId.mockResolvedValue({
      ok: false,
      error: { kind: "failure", message: "確認できません" },
    });
    expect(
      (await readSharedScheduleAction({ kind: "detail", entryId: ENTRY }))
        ?.data,
    ).toMatchObject({ entry: { title: "authorized" }, share: { ok: false } });
  });
});
