import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetUser = vi.fn();

// @supabase/ssr is mocked at this low level (rather than mocking a wrapper)
// because proxy.ts constructs its own `createServerClient` inline - there is
// no `@/lib/supabase/*` indirection to intercept here.
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}));

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
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

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
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const request = new NextRequest(
      new Request("https://branch.vercel.app/sign-in"),
    );

    const response = await proxy(request);

    // Preview treats this request as unauthenticated, so hitting the public
    // /sign-in path is simply allowed through (not redirected to "/").
    expect(response.headers.get("location")).toBeNull();
  });

  it("still lets an authenticated request through outside preview (baseline unaffected)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const request = new NextRequest(
      new Request("https://stage-tracker.com/catalog", {
        headers: { cookie: "sb-access-token=valid-session" },
      }),
    );

    const response = await proxy(request);

    expect(response.headers.get("location")).toBeNull();
  });

  it("still redirects unauthenticated requests to /sign-in outside preview (baseline unaffected)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

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
