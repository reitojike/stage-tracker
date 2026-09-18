import { describe, expect, it, vi } from "vitest";

const mockCreateBrowserClient = vi.fn(() => ({}));

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: (...args: unknown[]) => mockCreateBrowserClient(...args),
}));

const { createSupabaseBrowserClient } = await import("./browser");

describe("createSupabaseBrowserClient", () => {
  it("owns the Passkey capability while keeping per-call browser clients", () => {
    const first = createSupabaseBrowserClient();
    const second = createSupabaseBrowserClient();

    expect(first).not.toBe(second);
    expect(mockCreateBrowserClient).toHaveBeenNthCalledWith(
      1,
      "https://example-project.supabase.test",
      "anon-key",
      { auth: { experimental: { passkey: true } } },
    );
  });
});
