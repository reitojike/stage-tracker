import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateServerClient = vi.fn();
const mockGetAll = vi.fn();
const mockSet = vi.fn();
const cookieStore = { getAll: mockGetAll, set: mockSet };

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}));

const { createSupabaseCookielessServerClient, createSupabaseServerClient } =
  await import("./server");

describe("Supabase server factories", () => {
  beforeEach(() => {
    mockCreateServerClient.mockReset();
    mockGetAll.mockReset();
    mockSet.mockReset();
    mockCreateServerClient.mockImplementation((_url, _key, options) => ({
      options,
    }));
    mockGetAll.mockReturnValue([{ name: "sb-session", value: "session" }]);
  });

  it("enables Passkey on the typed shared server client and preserves cookie wiring", async () => {
    const client = await createSupabaseServerClient();
    const options = (
      client as unknown as {
        options: {
          auth: { experimental: { passkey: boolean } };
          cookies: {
            getAll: () => unknown;
            setAll: (
              cookies: { name: string; value: string; options: object }[],
            ) => void;
          };
        };
      }
    ).options;

    expect(options.auth.experimental.passkey).toBe(true);
    expect(options.cookies.getAll()).toEqual([
      { name: "sb-session", value: "session" },
    ]);

    options.cookies.setAll([
      { name: "sb-session", value: "updated", options: { httpOnly: true } },
    ]);
    expect(mockSet).toHaveBeenCalledWith("sb-session", "updated", {
      httpOnly: true,
    });

    mockSet.mockImplementationOnce(() => {
      throw new Error("read-only cookie store");
    });
    expect(() =>
      options.cookies.setAll([
        { name: "sb-session", value: "updated", options: {} },
      ]),
    ).not.toThrow();
  });

  it("keeps the cookieless client write-free", async () => {
    const client = await createSupabaseCookielessServerClient();
    const options = (
      client as unknown as {
        options: {
          cookies: {
            getAll: () => unknown;
            setAll: (
              cookies: { name: string; value: string; options: object }[],
            ) => void;
          };
        };
      }
    ).options;

    expect(options.cookies.getAll()).toEqual([
      { name: "sb-session", value: "session" },
    ]);
    options.cookies.setAll([
      { name: "sb-code-verifier", value: "value", options: {} },
    ]);
    expect(mockSet).not.toHaveBeenCalled();
  });
});
