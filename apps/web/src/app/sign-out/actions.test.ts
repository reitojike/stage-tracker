// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieJar, redirect } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://sign-out.supabase.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => Array.from(cookieJar, ([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      if (value) cookieJar.set(name, value);
      else cookieJar.delete(name);
    },
  }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

const fetchMock = vi.fn<typeof fetch>();

describe("signOut with the real Supabase SSR client", () => {
  beforeEach(async () => {
    cookieJar.clear();
    redirect.mockClear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    const user = {
      id: "00000000-0000-4000-8000-000000000001",
      aud: "authenticated",
      role: "authenticated",
      email: "sign-out@example.test",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(user), { status: 200 }),
    );
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const accessToken = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
      sub: user.id,
      exp: Math.floor(Date.now() / 1000) + 3600,
      role: user.role,
    })}.test-signature`;
    const client = await createSupabaseServerClient();
    const { error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: "test-refresh-token",
    });
    expect(error).toBeNull();
    expect(cookieJar.size).toBeGreaterThan(0);
    fetchMock.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("clears the SSR session and redirects after successful global logout", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(signOut()).rejects.toThrow("REDIRECT:/sign-in");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/logout?scope=global",
    );
    expect(cookieJar.size).toBe(0);
    expect(redirect).toHaveBeenCalledOnce();
  });

  it.each(["network", "server"])(
    "reports a %s failure without redirecting while the SSR session remains",
    async (failure) => {
      const before = Array.from(cookieJar);
      if (failure === "network") {
        fetchMock.mockRejectedValue(new TypeError("network unavailable"));
      } else {
        fetchMock.mockResolvedValue(
          new Response(JSON.stringify({ message: "unavailable" }), {
            status: 500,
          }),
        );
      }
      await expect(signOut()).rejects.toThrow(
        "サインアウトできませんでした。もう一度お試しください。",
      );
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
        "/logout?scope=global",
      );
      expect(Array.from(cookieJar)).toEqual(before);
      expect(redirect).not.toHaveBeenCalled();
    },
  );
});
