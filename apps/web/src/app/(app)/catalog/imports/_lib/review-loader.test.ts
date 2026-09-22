import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/data/database.types";
import { server } from "@/test/msw/server";
import { loadOfficialImportReviewQueue } from "./review-loader";

vi.mock("server-only", () => ({}));

const SUPABASE_URL = "https://example-project.supabase.test";
const REST_URL = `${SUPABASE_URL}/rest/v1`;

function createTestClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function candidateRow(index: number, currentEvent: object | null = null) {
  const suffix = String(index).padStart(12, "0");
  return {
    id: `00000000-0000-4000-8000-${suffix}`,
    candidate_kind: "event",
    source_id: "event.test",
    canonical_url: `https://example.test/events/${index}`,
    observed_at: "2026-09-23T00:00:00Z",
    official_external_id: `event-${index}`,
    proposal_version: "event.v1",
    proposal: {
      sourceKey: `test:${index}`,
      title: `候補 ${index}`,
      venue: null,
      memo: null,
      sourceUrl: `https://example.test/events/${index}`,
      startsOn: "2026-10-01",
      endsOn: "2026-10-01",
      occurrences: [],
    },
    evidence_locator: { rowLabel: `候補 ${index}` },
    plan_summary: {
      version: "event_plan.v1",
      action: currentEvent === null ? "create" : "update",
      detailsChanged: currentEvent !== null,
      rangeChanged: false,
      newOccurrenceCount: 0,
      endsAtFixCount: 0,
      doorsAtFixCount: 0,
      keptOccurrenceCount: 0,
      genreChanged: false,
      groupsChanged: false,
    },
    deterministic_match_status: currentEvent === null ? "unmatched" : "matched",
    semantic_match_status: "not_used",
    resolved_event_id:
      currentEvent === null ? null : "11111111-1111-4111-8111-111111111111",
    resolved_ticket_opportunity_id: null,
    jev_decision_evidence: null,
    review_status: "pending",
    official_import_runs: { status: "completed" },
    current_event: currentEvent,
    current_ticket_opportunity: null,
  };
}

afterEach(() => server.resetHandlers());

describe("loadOfficialImportReviewQueue", () => {
  it("keyset-pages a queue larger than one API page without skipping candidates", async () => {
    const rows = Array.from({ length: 501 }, (_, index) =>
      candidateRow(index + 1),
    );
    let requestCount = 0;
    server.use(
      http.get(`${REST_URL}/official_import_candidates`, ({ request }) => {
        requestCount += 1;
        const url = new URL(request.url);
        expect(url.searchParams.get("order")).toBe("id.asc");
        expect(url.searchParams.get("limit")).toBe("500");
        const idFilter = url.searchParams.get("id");
        const cursor = idFilter?.startsWith("gt.")
          ? idFilter.slice("gt.".length)
          : null;
        const remaining =
          cursor === null ? rows : rows.filter((row) => row.id > cursor);
        const page = remaining.slice(0, 500);
        return HttpResponse.json(page, {
          headers: {
            "content-range": `0-${page.length - 1}/${remaining.length}`,
          },
        });
      }),
    );

    const result = await loadOfficialImportReviewQueue(createTestClient());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(501);
      expect(new Set(result.value.map((candidate) => candidate.id)).size).toBe(
        501,
      );
    }
    expect(requestCount).toBe(2);
  });

  it("loads current occurrence values separately for an update review", async () => {
    const eventId = "11111111-1111-4111-8111-111111111111";
    server.use(
      http.get(`${REST_URL}/official_import_candidates`, () =>
        HttpResponse.json(
          [
            candidateRow(1, {
              id: eventId,
              source_key: "test:existing",
              title: "現在の公演",
              venue: "現在の会場",
              memo: null,
              source_url: null,
              starts_on: "2026-10-01",
              ends_on: "2026-10-01",
            }),
          ],
          { headers: { "content-range": "0-0/1" } },
        ),
      ),
      http.get(`${REST_URL}/event_occurrences`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("event_id")).toContain(eventId);
        expect(url.searchParams.get("canceled_at")).toBe("is.null");
        return HttpResponse.json(
          [
            {
              id: "22222222-2222-4222-8222-222222222222",
              event_id: eventId,
              doors_at: "2026-10-01T00:30:00Z",
              starts_at: "2026-10-01T01:00:00Z",
              ends_at: "2026-10-01T03:30:00Z",
            },
          ],
          { headers: { "content-range": "0-0/1" } },
        );
      }),
    );

    const result = await loadOfficialImportReviewQueue(createTestClient());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]?.currentEvent?.occurrences).toEqual([
        {
          id: "22222222-2222-4222-8222-222222222222",
          doorsAt: "2026-10-01T00:30:00Z",
          startsAt: "2026-10-01T01:00:00Z",
          endsAt: "2026-10-01T03:30:00Z",
        },
      ]);
    }
  });
});
