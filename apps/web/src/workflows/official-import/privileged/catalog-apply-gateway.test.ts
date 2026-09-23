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
