import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(async () => ({ data: { user: null } })),
  start: vi.fn(),
  secret: { CRON_SECRET: "s".repeat(32) },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/env", () => ({ env: mocks.secret }));
vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("@/workflows/official-import/source-registry", () => ({
  listScheduledShadowSources: () => [],
}));
vi.mock("@/workflows/official-import/scheduled-shadow-workflow", () => ({
  officialImportScheduledShadowWorkflow: vi.fn(),
}));

const { config, proxy } = await import("./proxy");
const { GET } = await import("./app/api/official-import/cron/route");

describe("Workflow reserved proxy matcher boundary", () => {
  it.each([
    "/.well-known/workflow/",
    "/.well-known/workflow/v1/flow",
    "/.well-known/workflow/v1/flow/child",
    "/.well-known/workflow/v1/webhook/example",
    "/.well-known/workflow/v1/webhook/example/child",
  ])("leaves %s to the SDK handler", (pathname) => {
    expect(
      unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: pathname }),
    ).toBe(false);
  });

  it.each([
    "/.well-known/workflow",
    "/.well-known/workflowevil/v1/flow",
    "/.well-known/workflows/v1/flow",
    "/xwell-known/workflow/v1/flow",
    "/.well-known/other",
    "/events/.well-known/workflow/v1/flow",
    "/api/official-import/shadow",
    "/api/other",
    "/events/some-future-page.png",
    "/catalog",
  ])("keeps %s inside the application proxy", (pathname) => {
    expect(
      unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: pathname }),
    ).toBe(true);
  });
});

function request(pathname: string, authorization?: string): NextRequest {
  return new NextRequest(`https://stage-tracker.com${pathname}`, {
    headers: authorization === undefined ? {} : { authorization },
  });
}

async function cronThroughProxy(authorization?: string) {
  const incoming = request("/api/official-import/cron", authorization);
  const proxyResponse = await proxy(incoming);
  expect(proxyResponse.headers.get("location")).toBeNull();
  expect(proxyResponse.headers.get("x-middleware-next")).toBe("1");
  return GET(incoming);
}

describe("proxy and official-import Cron request boundary", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "production");
    mocks.getUser.mockClear();
    mocks.start.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("delivers a sessionless Cron request to route-level bearer rejection", async () => {
    const missing = await cronThroughProxy();
    const wrong = await cronThroughProxy("Bearer wrong");

    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "unauthorized" });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "unauthorized" });
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("delivers the correct bearer to the inert Cron execution path", async () => {
    const response = await cronThroughProxy(
      `Bearer ${mocks.secret.CRON_SECRET}`,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("keeps the route unavailable outside Production", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");

    expect(
      (await cronThroughProxy(`Bearer ${mocks.secret.CRON_SECRET}`)).status,
    ).toBe(404);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each([
    "/events",
    "/api/official-import/shadow",
    "/api/official-import/cron/child",
    "/api/other",
  ])("keeps %s behind user authentication", async (pathname) => {
    const response = await proxy(request(pathname));

    expect(response.headers.get("location")).toBe(
      "https://stage-tracker.com/sign-in",
    );
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });
});
