import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockVerifyOtp = vi.fn();
const mockCreateSupabaseServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: (...args: unknown[]) =>
    mockCreateSupabaseServerClient(...args),
}));

const { GET } = await import("./route");

/**
 * Codex P1 (docs/v2/decisions.md): forwarding a Production-issued
 * `token_hash` to Preview's public `/auth/confirm` must not establish a
 * Preview session. `verifyOtp` is the only call in this route capable of
 * creating a session cookie (it drives the `@supabase/ssr` cookie adapter
 * internally) - asserting it is never invoked is definitionally sufficient
 * to assert no session cookie is issued.
 */
describe("/auth/confirm - Preview environment authenticated-flow rejection", () => {
  beforeEach(() => {
    mockVerifyOtp.mockReset();
    mockCreateSupabaseServerClient.mockReset();
    mockCreateSupabaseServerClient.mockResolvedValue({
      auth: { verifyOtp: mockVerifyOtp },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a valid token_hash without calling verifyOtp when VERCEL_ENV=preview", async () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");

    const request = new NextRequest(
      "https://branch.vercel.app/auth/confirm?token_hash=abc123&type=email",
    );

    const response = await GET(request);

    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "/sign-in?error=link_expired",
    );
  });

  it("still verifies a valid token_hash and redirects on success outside preview (baseline unaffected)", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const request = new NextRequest(
      "https://stage-tracker.com/auth/confirm?token_hash=abc123&type=email",
    );

    const response = await GET(request);

    expect(mockVerifyOtp).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toBe("/");
  });

  it("still rejects a missing token_hash outside preview (baseline unaffected)", async () => {
    const request = new NextRequest(
      "https://stage-tracker.com/auth/confirm?type=email",
    );

    const response = await GET(request);

    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "/sign-in?error=link_expired",
    );
  });
});
