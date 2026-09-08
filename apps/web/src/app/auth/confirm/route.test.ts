import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockVerifyOtp = vi.fn();
const mockCreateSupabaseServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: (...args: unknown[]) =>
    mockCreateSupabaseServerClient(...args),
}));

const { GET } = await import("./route");

/**
 * `/auth/confirm` は session cookie を発行する唯一の Route Handler であり、
 * `verifyOtp` がその発行を駆動する（`@supabase/ssr` の cookie adapter を
 * 内部で動かす）。したがって「`verifyOtp` が呼ばれたか」を見ることは、
 * session が成立したかを見ることと等価。
 */
describe("/auth/confirm", () => {
  beforeEach(() => {
    mockVerifyOtp.mockReset();
    mockCreateSupabaseServerClient.mockReset();
    mockCreateSupabaseServerClient.mockResolvedValue({
      auth: { verifyOtp: mockVerifyOtp },
    });
  });

  it("有効な token_hash を検証し、成功時は next へ redirect する", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const request = new NextRequest(
      "https://stage-tracker.com/auth/confirm?token_hash=abc123&type=email",
    );

    const response = await GET(request);

    expect(mockVerifyOtp).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toBe("/");
  });

  it("token_hash が無ければ verifyOtp を呼ばずに拒否する", async () => {
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
