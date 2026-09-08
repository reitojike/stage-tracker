import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetUser = vi.fn();
const capturedCookieOptions: { current: unknown } = { current: null };

// @supabase/ssr is mocked at this low level (rather than mocking a wrapper)
// because proxy.ts constructs its own `createServerClient` inline - there is
// no `@/lib/supabase/*` indirection to intercept here.
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, options: unknown) => {
    capturedCookieOptions.current = options;
    return { auth: { getUser: mockGetUser } };
  }),
}));

/**
 * `getUser()` を「渡された cookie に依存して答える」形にする。
 *
 * 以前この mock は cookie を無視して固定の user を返しており、proxy が
 * `authenticated` を後から false に上書きする**旧機構**しか検証できな
 * かった。現在の保証は「preview では cookie を渡さない」なので、
 * cookie -> user という因果を mock 側にも持たせないと、遮断が効いている
 * ことを実際には確かめられない（PR #386 review, Codex P1）。
 */
function sessionAwareGetUser(sessionUser: { id: string } | null) {
  return () => {
    const handedOver = cookieAdapter().getAll();
    return Promise.resolve({
      data: { user: handedOver.length > 0 ? sessionUser : null },
    });
  };
}

interface CapturedCookieAdapter {
  cookies: {
    getAll: () => unknown[];
    setAll: (
      toSet: { name: string; value: string; options: unknown }[],
      headers: Record<string, string>,
    ) => void;
  };
}

function cookieAdapter(): CapturedCookieAdapter["cookies"] {
  return (capturedCookieOptions.current as CapturedCookieAdapter).cookies;
}

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

const { proxy } = await import("./proxy");

/**
 * Codex P1 (docs/v2/decisions.md): a session cookie issued by a previous
 * deployment can still be accepted by `proxy.ts` on a stable Preview branch
 * URL. This suite asserts `VERCEL_ENV=preview` forces the unauthenticated
 * branch even when `getUser()` resolves a valid user.
 */
describe("proxy - Preview environment authenticated-flow rejection", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects a protected route to /sign-in in preview, even with a valid session cookie", async () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");
    mockGetUser.mockImplementation(sessionAwareGetUser({ id: "user-1" }));

    const request = new NextRequest(
      new Request("https://branch.vercel.app/catalog", {
        headers: { cookie: "sb-access-token=stale-session-from-old-deploy" },
      }),
    );

    const response = await proxy(request);

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/sign-in",
    );
  });

  it("redirects an authenticated request away from /sign-in only outside preview (preview never reaches the authenticated branch)", async () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");
    mockGetUser.mockImplementation(sessionAwareGetUser({ id: "user-1" }));

    const request = new NextRequest(
      new Request("https://branch.vercel.app/sign-in", {
        headers: { cookie: "sb-access-token=stale-session-from-old-deploy" },
      }),
    );

    const response = await proxy(request);

    // Preview treats this request as unauthenticated, so hitting the public
    // /sign-in path is simply allowed through (not redirected to "/").
    expect(response.headers.get("location")).toBeNull();
  });

  it("still lets an authenticated request through outside preview (baseline unaffected)", async () => {
    mockGetUser.mockImplementation(sessionAwareGetUser({ id: "user-1" }));

    const request = new NextRequest(
      new Request("https://stage-tracker.com/catalog", {
        headers: { cookie: "sb-access-token=valid-session" },
      }),
    );

    const response = await proxy(request);

    expect(response.headers.get("location")).toBeNull();
  });

  it("still redirects unauthenticated requests to /sign-in outside preview (baseline unaffected)", async () => {
    mockGetUser.mockImplementation(sessionAwareGetUser({ id: "user-1" }));

    const request = new NextRequest(
      new Request("https://stage-tracker.com/catalog"),
    );

    const response = await proxy(request);

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/sign-in",
    );
  });
});

/**
 * PR #386 review (Codex P1): forcing `authenticated = false` after the fact
 * still performed the authenticated connection - cookies were handed to
 * Supabase, `getUser()` ran against Production, and a refresh would issue
 * new cookies via `setAll()`. The guarantee has to be "no session cookie is
 * handed over at all", the same mechanism `src/lib/supabase/server.ts` uses
 * (docs/v2/decisions.md A24).
 */
describe("proxy - Preview では session cookie を Supabase へ渡さない", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockGetUser.mockImplementation(sessionAwareGetUser({ id: "user-1" }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preview では cookie を読み込んで渡さない", async () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");
    const request = new NextRequest("https://preview.test/calendar");
    request.cookies.set("sb-example-auth-token", "production-session");

    await proxy(request);

    expect(cookieAdapter().getAll()).toEqual([]);
  });

  it("preview では refresh されても cookie を発行しない", async () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");
    const request = new NextRequest("https://preview.test/calendar");

    const response = await proxy(request);
    cookieAdapter().setAll(
      [{ name: "sb-example-auth-token", value: "refreshed", options: {} }],
      {},
    );

    expect(response.cookies.get("sb-example-auth-token")).toBeUndefined();
  });

  it("preview でなければ cookie をそのまま渡す（baseline）", async () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "production");
    const request = new NextRequest("https://app.test/calendar");
    request.cookies.set("sb-example-auth-token", "production-session");

    await proxy(request);

    expect(cookieAdapter().getAll()).toEqual([
      { name: "sb-example-auth-token", value: "production-session" },
    ]);
  });
});
