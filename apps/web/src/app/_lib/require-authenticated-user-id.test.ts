import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { requireAuthenticatedUserId } from "./require-authenticated-user-id";

const USER_ID = "11111111-1111-4111-8111-111111111111";

/**
 * `requireAuthenticatedUserId` only ever calls `supabase.auth.getUser()` -
 * stubbing that one method directly (rather than driving a real
 * `@supabase/supabase-js` client through GoTrue's actual session/JWT
 * lifecycle over MSW) is what actually isolates *this* function's own
 * unauthenticated/failure classification, which is the thing this Task
 * needs verified. The GoTrue client's own session-resolution behavior
 * (`_getUser`/`_useSession` in `@supabase/auth-js`) is not code this Task
 * owns or needs to re-verify.
 */
function stubSupabaseClient(
  getUser: SupabaseClient["auth"]["getUser"],
): SupabaseClient {
  return { auth: { getUser } } as unknown as SupabaseClient;
}

describe("requireAuthenticatedUserId", () => {
  it("returns ok(userId) for an authenticated session", async () => {
    const supabase = stubSupabaseClient(
      vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    );

    const result = await requireAuthenticatedUserId(supabase);

    expect(result).toEqual({ ok: true, value: USER_ID });
  });

  it("classifies a missing session as unauthenticated (never a generic failure)", async () => {
    const supabase = stubSupabaseClient(
      vi.fn().mockResolvedValue({
        data: { user: null },
        error: { name: "AuthSessionMissingError", message: "no session" },
      }),
    );

    const result = await requireAuthenticatedUserId(supabase);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unauthenticated");
    }
  });

  it("classifies a thrown/rejected getUser() call as failure, not unauthenticated, without leaking the raw exception message", async () => {
    // PR #381 review finding 2: the raw exception message is server-log-only
    // (`console.error`); `ReadError.message` is always the fixed, safe
    // string `readError()` derives from `kind` (`@/lib/data/read-error.ts`).
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      // swallow the expected log for this test
    });
    const supabase = stubSupabaseClient(
      vi.fn().mockRejectedValue(new Error("network down: 10.0.0.5:5432")),
    );

    const result = await requireAuthenticatedUserId(supabase);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
      expect(result.error.message).not.toContain("10.0.0.5");
    }
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("classifies an unexpected user id shape as failure, without leaking the raw shape/zod detail", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      // swallow the expected log for this test
    });
    const supabase = stubSupabaseClient(
      vi.fn().mockResolvedValue({
        data: { user: { id: "not-a-uuid" } },
        error: null,
      }),
    );

    const result = await requireAuthenticatedUserId(supabase);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
      expect(result.error.message).not.toContain("not-a-uuid");
    }
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});

/**
 * PR #386 review（Codex P1）への回帰テスト。preview では認証を解決する
 * 経路すべてが一致して未認証扱いにする必要がある。ここだけ古いと、
 * `proxy.ts` を通り抜けた先で Production の session が有効に見える。
 */
describe("requireAuthenticatedUserId: Preview deployment", () => {
  it("preview では有効な user が返っても unauthenticated にする", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth/vercel-environment", () => ({
      isPreviewDeployment: () => true,
    }));
    const { requireAuthenticatedUserId: guarded } =
      await import("./require-authenticated-user-id.js");

    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
    const result = await guarded({
      auth: { getUser },
    } as unknown as SupabaseClient);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unauthenticated");
    }
    // Supabase へ問い合わせる前に止まる。
    expect(getUser).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/auth/vercel-environment");
    vi.resetModules();
  });
});
