import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const secret: { CRON_SECRET: string | undefined } = {
    CRON_SECRET: "s".repeat(32),
  };
  return {
    secret,
    listSources: vi.fn<() => unknown[]>(() => []),
    start: vi.fn<(...args: unknown[]) => Promise<{ runId: string }>>(),
  };
});

vi.mock("@/env", () => ({ env: mocks.secret }));
vi.mock("workflow/api", () => ({
  start: (...args: unknown[]) => mocks.start(...args),
}));
vi.mock(
  "@/workflows/official-import/source-registry",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    listScheduledShadowSources: () => mocks.listSources(),
  }),
);
vi.mock("@/workflows/official-import/scheduled-shadow-workflow", () => ({
  officialImportScheduledShadowWorkflow: vi.fn(),
}));

const { GET } = await import("./route");

function request(authorization?: string): Request {
  return new Request("https://stage-tracker.com/api/official-import/cron", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("GET /api/official-import/cron", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T15:00:00.000Z"));
    mocks.secret.CRON_SECRET = "s".repeat(32);
    mocks.listSources.mockReset();
    mocks.listSources.mockReturnValue([]);
    mocks.start.mockReset();
    mocks.start.mockResolvedValue({ runId: "workflow-test" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("is unavailable outside Production and fails closed without a secret", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await GET(request(`Bearer ${"s".repeat(32)}`))).status).toBe(404);
    vi.stubEnv("VERCEL_ENV", "production");
    mocks.secret.CRON_SECRET = undefined;
    expect((await GET(request())).status).toBe(503);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("rejects missing or incorrect bearer authorization", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer wrong"))).status).toBe(401);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("does nothing while no source has passed its scheduled policy gate", async () => {
    const response = await GET(request(`Bearer ${"s".repeat(32)}`));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("starts each due source with the same Tokyo slot for duplicate deliveries", async () => {
    const source = {
      id: "event.kabuki-bito.schedule",
      fetchCadenceHint: "daily",
    };
    mocks.listSources.mockReturnValue([source]);
    const authorized = request(`Bearer ${"s".repeat(32)}`);
    expect((await GET(authorized)).status).toBe(202);
    expect((await GET(authorized)).status).toBe(202);
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.start.mock.calls[0]?.[1]).toEqual([
      [{ sourceId: "event.kabuki-bito.schedule", tokyoDate: "2026-09-21" }],
    ]);
    expect(mocks.start.mock.calls[1]?.[1]).toEqual(
      mocks.start.mock.calls[0]?.[1],
    );
  });

  it("returns a failure if the scheduled Workflow cannot start", async () => {
    const first = {
      id: "event.kabuki-bito.schedule",
      fetchCadenceHint: "daily",
    };
    const second = {
      id: "ticket.shochiku.schedule",
      fetchCadenceHint: "daily",
    };
    mocks.listSources.mockReturnValue([first, second]);
    mocks.start.mockRejectedValueOnce(new Error("unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await GET(request(`Bearer ${"s".repeat(32)}`))).status).toBe(500);
      expect(mocks.start).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });
});
