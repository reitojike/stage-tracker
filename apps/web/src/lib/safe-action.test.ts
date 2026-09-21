import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserId } from "@stage-tracker/domain";
import { ActionError, GENERIC_FAILURE_MESSAGE_JA } from "@/lib/action-error";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { authActionClient, toActionErrorShape } from "@/lib/safe-action";
import { z } from "zod";

const { mockGetUser } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
let authProbeBodyCalls = 0;
const authProbeAction = authActionClient
  .inputSchema(z.object({ message: z.string() }))
  .action(async ({ parsedInput, ctx }) => {
    authProbeBodyCalls += 1;
    const typedUserId: UserId = ctx.userId;
    return {
      message: parsedInput.message,
      userId: typedUserId,
      userEmail: ctx.userEmail,
    };
  });

describe("toActionErrorShape", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves a base ActionError kind and message", () => {
    expect(
      toActionErrorShape(
        new ActionError("permission-denied", "権限がありません。"),
      ),
    ).toEqual({
      kind: "permission-denied",
      message: "権限がありません。",
    });
  });

  it("preserves the duplicate-occurrence feature kind and message", () => {
    expect(
      toActionErrorShape(
        new ActionError<"duplicate-occurrence">(
          "duplicate-occurrence",
          "同じ日時の公演回が既に登録されています。",
        ),
      ),
    ).toEqual({
      kind: "duplicate-occurrence",
      message: "同じ日時の公演回が既に登録されています。",
    });
  });

  it("preserves the delete-blocked feature kind and message", () => {
    expect(
      toActionErrorShape(
        new ActionError<"delete-blocked">(
          "delete-blocked",
          "関連する参加・招待があるため削除できません。",
        ),
      ),
    ).toEqual({
      kind: "delete-blocked",
      message: "関連する参加・招待があるため削除できません。",
    });
  });

  it("redacts an ordinary Error to the generic failure shape", () => {
    const error = new Error("private database detail");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(toActionErrorShape(error)).toEqual({
      kind: "failure",
      message: GENERIC_FAILURE_MESSAGE_JA,
    });
    expect(consoleError).toHaveBeenCalledWith(error);
  });
});

describe("authActionClient identity boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(createSupabaseServerClient).mockClear();
    mockGetUser.mockReset();
    authProbeBodyCalls = 0;
  });

  it("keeps unauthenticated actions on the existing error vocabulary", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "session missing" },
    });

    const result = await authProbeAction({ message: "ping" });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toEqual({
      kind: "unauthenticated",
      message: "サインインが必要です。",
    });
    expect(authProbeBodyCalls).toBe(0);
  });

  it("fails closed for a malformed authenticated user id without exposing Zod detail", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "malformed-user-id", email: "user@example.com" } },
      error: null,
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const result = await authProbeAction({ message: "ping" });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toEqual({
      kind: "failure",
      message: GENERIC_FAILURE_MESSAGE_JA,
    });
    expect(result.serverError?.message).not.toContain("malformed-user-id");
    expect(consoleError).toHaveBeenCalledWith(
      "[action auth] unexpected auth user id shape",
      expect.any(String),
    );
    expect(authProbeBodyCalls).toBe(0);
  });

  it("passes a valid branded identity and bounded email to the action body", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: "user@example.com" } },
      error: null,
    });

    const result = await authProbeAction({ message: "ping" });

    expect(result.data).toEqual({
      message: "ping",
      userId: USER_ID,
      userEmail: "user@example.com",
    });
    expect(authProbeBodyCalls).toBe(1);
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });
});
