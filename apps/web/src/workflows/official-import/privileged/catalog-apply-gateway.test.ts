import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/data/database.types";

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ createPrivilegedIngestionClient: vi.fn() }));

const { createOfficialImportCatalogGateway } =
  await import("./catalog-apply-gateway");

function unavailableClient() {
  return createClient<Database>("https://example.test", "public-test-key", {
    global: {
      fetch: async () =>
        Response.json(
          { code: "PGRST000", message: "database unavailable" },
          { status: 400 },
        ),
    },
  });
}

describe("reviewed catalog gateway failure classification", () => {
  it("keeps transient Event resolver reads retryable", async () => {
    const gateway = createOfficialImportCatalogGateway(unavailableClient());
    await expect(
      gateway.prepareEvent(
        {
          sourceKey: "official:example:event",
          title: "Example Event",
          startsOn: "2026-10-01",
          endsOn: "2026-10-01",
          occurrences: [{ startsAt: "2026-10-01T18:00:00+09:00" }],
        },
        "creator-id",
        null,
      ),
    ).rejects.toMatchObject({ classification: "unexpected" });
  });

  it("keeps transient Ticket resolver reads retryable", async () => {
    const gateway = createOfficialImportCatalogGateway(unavailableClient());
    await expect(
      gateway.prepareTicketOpportunity({
        eventSourceKey: "official:example:event",
        sourceKey: "official:example:ticket",
        displayName: "General sale",
        targetScope: "event_wide",
        milestones: [],
      }),
    ).rejects.toMatchObject({ classification: "unexpected" });
  });
});

describe("candidate-aware Kabuki Event gateway", () => {
  const reviewerId = "00000000-0000-4000-8000-000000000102";
  const proposal = {
    sourceKey: "kabuki-bito:978",
    title: "Reviewed Event",
    startsOn: "2026-10-01",
    endsOn: "2026-10-01",
    occurrences: [],
  };
  const context = {
    candidateId: "00000000-0000-4000-8000-000000000101",
    attemptToken: "a".repeat(64),
  };

  function harness(completion: unknown = "applied", status = 200) {
    const calls: { path: string; body: unknown }[] = [];
    const client = createClient<Database>(
      "https://example.test",
      "public-test-key",
      {
        global: {
          fetch: async (input, init) => {
            const url = new URL(
              input instanceof Request ? input.url : String(input),
            );
            if (url.pathname.includes("/rpc/")) {
              const body: unknown = JSON.parse(String(init?.body));
              calls.push({
                path: url.pathname,
                body,
              });
              return Response.json(completion, { status });
            }
            return Response.json(
              url.pathname.endsWith("/catalog_creators")
                ? [{ user_id: reviewerId }]
                : [],
            );
          },
        },
      },
    );
    return { gateway: createOfficialImportCatalogGateway(client), calls };
  }

  it("marks completion atomic and sends candidate context to the sole write RPC", async () => {
    const { gateway, calls } = harness();
    const plan = await gateway.prepareEvent(
      proposal,
      reviewerId,
      null,
      context,
    );
    expect(plan.candidateCompletion).toBe("atomic");
    await plan.apply();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe(
      "/rest/v1/rpc/apply_official_import_kabuki_event_candidate",
    );
    expect(calls[0]?.body).toMatchObject({
      p_candidate_id: context.candidateId,
      p_attempt_token: context.attemptToken,
      p_owner_id: reviewerId,
      p_source_key: proposal.sourceKey,
      p_expected_current: null,
      p_set_genre: false,
      p_set_groups: false,
    });
    const body = calls[0]?.body;
    if (body === null || typeof body !== "object")
      throw new Error("Expected an object RPC payload");
    expect(Object.keys(body)).toHaveLength(20);
  });

  it("retains the reviewed Event route without candidate context", async () => {
    const { gateway, calls } = harness();
    const plan = await gateway.prepareEvent(
      { ...proposal, sourceKey: "takarazuka:2027:example:tokyo" },
      reviewerId,
      null,
    );
    expect(plan.candidateCompletion).toBeUndefined();
    await plan.apply();
    expect(calls[0]?.path).toBe(
      "/rest/v1/rpc/apply_reviewed_import_event_plan",
    );
    expect(calls[0]?.body).not.toHaveProperty("p_candidate_id");
  });

  it.each(["queued", null, { status: "applied" }])(
    "fails when the atomic RPC returns an unconfirmed result %j",
    async (result) => {
      const { gateway, calls } = harness(result);
      const plan = await gateway.prepareEvent(
        proposal,
        reviewerId,
        null,
        context,
      );
      await expect(plan.apply()).rejects.toMatchObject({
        classification: "write_conflict",
      });
      expect(calls.map(({ path }) => path)).toEqual([
        "/rest/v1/rpc/apply_official_import_kabuki_event_candidate",
      ]);
    },
  );

  it.each([
    ["40001", "source_changed"],
    ["22023", "write_conflict"],
  ])(
    "classifies atomic refusal %s without a legacy write fallback",
    async (code, classification) => {
      const { gateway, calls } = harness(
        { code, message: "atomic refusal" },
        400,
      );
      const plan = await gateway.prepareEvent(
        proposal,
        reviewerId,
        null,
        context,
      );
      await expect(plan.apply()).rejects.toMatchObject({ classification });
      expect(calls.map(({ path }) => path)).toEqual([
        "/rest/v1/rpc/apply_official_import_kabuki_event_candidate",
      ]);
    },
  );
});
