import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/data/database.types";
import { server } from "@/test/msw/server";
import {
  loadLatestKabukiHeldPageReport,
  loadLatestShochikuTicketHeldPageReport,
  loadLatestShochikuTicketRun,
} from "./held-page-loader";

vi.mock("server-only", () => ({}));

const REST_URL = "https://example-project.supabase.test/rest/v1";
const RUN_ID = "00000000-0000-4000-8000-000000000001";

function client(): SupabaseClient<Database> {
  return createClient<Database>(
    "https://example-project.supabase.test",
    "anon-key",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

describe("latest Kabuki held-page report", () => {
  it("reads compact held identities from the latest completed run", async () => {
    server.use(
      http.get(`${REST_URL}/official_import_runs`, ({ request }) => {
        const query = new URL(request.url).searchParams;
        expect(query.get("source_id")).toBe("eq.event.kabuki-bito.schedule");
        expect(query.get("status")).toBe("eq.completed");
        return HttpResponse.json([
          { id: RUN_ID, started_at: "2026-09-24T00:00:00.123456+00:00" },
        ]);
      }),
      http.get(`${REST_URL}/official_import_held_pages`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("run_id")).toBe(
          `eq.${RUN_ID}`,
        );
        return HttpResponse.json([
          {
            canonical_url:
              "https://www.kabuki-bito.jp/theaters/other/play/1000",
            official_external_id: "1000",
            title: "保留公演",
            starts_on: "2026-10-01",
            ends_on: "2026-10-02",
            reason_code: "published_end_missing",
          },
        ]);
      }),
    );
    const result = await loadLatestKabukiHeldPageReport(client());
    expect(result).toMatchObject({
      ok: true,
      value: {
        runId: RUN_ID,
        startedAt: "2026-09-24T00:00:00.123456+00:00",
        pages: [
          { officialExternalId: "1000", reasonCode: "published_end_missing" },
        ],
      },
    });
  });

  it("does not turn a failed read into an empty report", async () => {
    server.use(
      http.get(`${REST_URL}/official_import_runs`, () =>
        HttpResponse.json(
          { code: "42501", message: "private database detail" },
          { status: 403 },
        ),
      ),
    );
    await expect(
      loadLatestKabukiHeldPageReport(client()),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: "permission-denied" },
    });
  });
});

describe("latest ticket held-page report", () => {
  it("shows the latest failed ticket run rather than treating it as no history", async () => {
    server.use(
      http.get(`${REST_URL}/official_import_runs`, ({ request }) => {
        const query = new URL(request.url).searchParams;
        expect(query.get("source_id")).toBe("eq.ticket.shochiku.schedule");
        expect(query.has("status")).toBe(false);
        return HttpResponse.json([
          { started_at: "2026-09-25T03:38:20+00:00", status: "failed" },
        ]);
      }),
    );
    await expect(loadLatestShochikuTicketRun(client())).resolves.toMatchObject({
      ok: true,
      value: { status: "failed" },
    });
  });

  it("reads only the ticket source's latest completed run", async () => {
    server.use(
      http.get(`${REST_URL}/official_import_runs`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("source_id")).toBe(
          "eq.ticket.shochiku.schedule",
        );
        return HttpResponse.json([
          { id: RUN_ID, started_at: "2026-09-25T00:00:00.000+00:00" },
        ]);
      }),
      http.get(`${REST_URL}/official_import_held_pages`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("source_id")).toBe(
          "eq.ticket.shochiku.schedule",
        );
        return HttpResponse.json([]);
      }),
    );
    await expect(
      loadLatestShochikuTicketHeldPageReport(client()),
    ).resolves.toMatchObject({ ok: true, value: { pages: [] } });
  });
});
