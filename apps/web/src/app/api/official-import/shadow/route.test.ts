import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStart = vi.fn<(...args: unknown[]) => Promise<{ runId: string }>>();
const mockCreateSupabaseServerClient = vi.fn<() => Promise<unknown>>();
const mockIsDesignatedCatalogCreator =
  vi.fn<(...args: unknown[]) => Promise<boolean>>();

vi.mock("workflow/api", () => ({
  start: (...args: unknown[]) => mockStart(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => mockCreateSupabaseServerClient(),
}));
vi.mock("@/lib/data/creator-capability", () => ({
  isDesignatedCatalogCreator: (...args: unknown[]) =>
    mockIsDesignatedCatalogCreator(...args),
}));
vi.mock("@/workflows/official-import/shadow-workflow", () => ({
  officialImportShadowWorkflow: vi.fn(),
}));

const { POST } = await import("./route");

function request(body: unknown): Request {
  return new Request("https://stage-tracker.com/api/official-import/shadow", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/official-import/shadow", () => {
  beforeEach(() => {
    mockStart.mockReset();
    mockCreateSupabaseServerClient.mockReset();
    mockIsDesignatedCatalogCreator.mockReset();
    mockStart.mockResolvedValue({ runId: "wrun_test" });
    mockCreateSupabaseServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
          error: null,
        })),
      },
    });
    mockIsDesignatedCatalogCreator.mockResolvedValue(true);
  });

  it("starts an allowlisted source as a controlled shadow workflow", async () => {
    const response = await POST(
      request({ sourceId: "event.kabuki-bito.schedule" }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      workflowRunId: "wrun_test",
      sourceId: "event.kabuki-bito.schedule",
      mode: "shadow",
    });
    expect(mockStart).toHaveBeenCalledOnce();
  });

  it("rejects arbitrary URL input before auth or workflow start", async () => {
    const response = await POST(
      request({
        sourceId: "event.kabuki-bito.schedule",
        url: "https://attacker.example/source",
      }),
    );

    expect(response.status).toBe(400);
    expect(mockCreateSupabaseServerClient).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("rejects a policy-held source", async () => {
    const response = await POST(
      request({ sourceId: "ticket.vpass.takarazuka-east" }),
    );

    expect(response.status).toBe(404);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("requires a designated catalog creator", async () => {
    mockIsDesignatedCatalogCreator.mockResolvedValue(false);

    const response = await POST(
      request({ sourceId: "event.kabuki-bito.schedule" }),
    );

    expect(response.status).toBe(403);
    expect(mockStart).not.toHaveBeenCalled();
  });
});
