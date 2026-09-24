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
    apply_status: "not_started",
    failure_classification: null,
    active_apply_lease_expires_at: null,
    official_import_runs: { status: "completed" },
    current_event: currentEvent,
    current_ticket_opportunity: null,
  };
}

function ticketCandidateRow() {
  const ticketId = "33333333-3333-4333-8333-333333333333";
  return {
    id: "00000000-0000-4000-8000-000000000001",
    candidate_kind: "ticket_opportunity",
    source_id: "ticket.test",
    canonical_url: "https://example.test/tickets/1",
    observed_at: "2026-09-23T00:00:00Z",
    official_external_id: "ticket-1",
    proposal_version: "ticket_opportunity.v1",
    proposal: {
      eventSourceKey: "test:event",
      sourceKey: "test:ticket",
      displayName: "提案販売情報",
      sourceUrl: "https://example.test/tickets/1",
      memo: null,
      targetScope: "selected_occurrences",
      targetOccurrences: ["2026-10-02T01:00:00Z"],
      milestones: [],
    },
    evidence_locator: { rowLabel: "販売情報" },
    plan_summary: {
      version: "ticket_opportunity_plan.v1",
      action: "update",
      eventChanged: false,
      detailsChanged: false,
      occurrencesChanged: true,
      milestonesChanged: true,
      targetOccurrenceCount: 1,
      milestoneCount: 1,
    },
    deterministic_match_status: "matched",
    semantic_match_status: "not_used",
    resolved_event_id: null,
    resolved_ticket_opportunity_id: ticketId,
    jev_decision_evidence: null,
    review_status: "pending",
    apply_status: "not_started",
    failure_classification: null,
    active_apply_lease_expires_at: null,
    official_import_runs: { status: "completed" },
    current_event: null,
    current_ticket_opportunity: {
      id: ticketId,
      event_id: "11111111-1111-4111-8111-111111111111",
      source_key: "test:ticket",
      display_name: "現在の販売情報",
      source_url: "https://example.test/tickets/1",
      memo: null,
      target_scope: "selected_occurrences",
      current_event: {
        id: "11111111-1111-4111-8111-111111111111",
        source_key: "test:old-event",
        title: "現在の対象公演",
      },
    },
  };
}

afterEach(() => server.resetHandlers());

describe("loadOfficialImportReviewQueue", () => {
  it("blocks legacy pending Jev-dependent Event and Ticket candidates in the review UI", async () => {
    const matchedEvent = {
      ...candidateRow(1),
      deterministic_match_status: "unresolved",
      semantic_match_status: "matched",
    };
    const unmatchedEvent = {
      ...candidateRow(2),
      deterministic_match_status: "unresolved",
      semantic_match_status: "unmatched",
    };
    const matchedTicket = {
      ...ticketCandidateRow(),
      id: "00000000-0000-4000-8000-000000000003",
      semantic_match_status: "matched",
      resolved_ticket_opportunity_id: null,
      current_ticket_opportunity: null,
    };
    server.use(
      http.get(`${REST_URL}/official_import_candidates`, () =>
        HttpResponse.json([matchedEvent, unmatchedEvent, matchedTicket], {
          headers: { "content-range": "0-2/3" },
        }),
      ),
    );

    const result = await loadOfficialImportReviewQueue(createTestClient());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
      for (const candidate of result.value) {
        expect(candidate.reviewStatus).toBe("blocked_for_identity_review");
        expect(candidate.blockedReason).toContain("Jevの照合結果だけでは");
      }
    }
  });

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
      expect(result.value[0]?.plan.hasChanges).toBe(true);
    }
  });

  it("does not mistake an unchanged Event action with a group update for a no-op", async () => {
    const row = candidateRow(1);
    server.use(
      http.get(`${REST_URL}/official_import_candidates`, () =>
        HttpResponse.json(
          [
            {
              ...row,
              plan_summary: {
                ...row.plan_summary,
                action: "unchanged",
                groupsChanged: true,
              },
            },
          ],
          { headers: { "content-range": "0-0/1" } },
        ),
      ),
    );

    const result = await loadOfficialImportReviewQueue(createTestClient());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]?.plan).toEqual({
        action: "unchanged",
        hasChanges: true,
        changes: ["グループを更新"],
      });
    }
  });

  it("loads current ticket details only for opportunities in the review queue", async () => {
    const ticketId = "33333333-3333-4333-8333-333333333333";
    let unscopedParentReads = 0;
    server.use(
      http.get(`${REST_URL}/official_import_candidates`, () =>
        HttpResponse.json([ticketCandidateRow()], {
          headers: { "content-range": "0-0/1" },
        }),
      ),
      http.get(
        `${REST_URL}/ticket_opportunity_target_occurrences`,
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("opportunity_id")).toContain(ticketId);
          return HttpResponse.json(
            [
              {
                opportunity_id: ticketId,
                occurrence_id: "22222222-2222-4222-8222-222222222222",
                event_occurrences: { starts_at: "2026-10-01T01:00:00Z" },
              },
            ],
            { headers: { "content-range": "0-0/1" } },
          );
        },
      ),
      http.get(`${REST_URL}/ticket_opportunity_milestones`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("opportunity_id")).toContain(ticketId);
        return HttpResponse.json(
          [
            {
              id: "44444444-4444-4444-8444-444444444444",
              opportunity_id: ticketId,
              milestone_type: "sale_start",
              temporal_precision: "datetime",
              date_value: null,
              at: "2026-09-01T01:00:00Z",
              starts_at: null,
              ends_at: null,
              created_at: "2026-08-01T00:00:00Z",
              updated_at: "2026-08-01T00:00:00Z",
            },
          ],
          { headers: { "content-range": "0-0/1" } },
        );
      }),
      http.get(`${REST_URL}/ticket_opportunities`, () => {
        unscopedParentReads += 1;
        return HttpResponse.json([], {
          headers: { "content-range": "*/0" },
        });
      }),
    );

    const result = await loadOfficialImportReviewQueue(createTestClient());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]?.currentTicketOpportunity).toMatchObject({
        currentEvent: {
          id: "11111111-1111-4111-8111-111111111111",
          sourceKey: "test:old-event",
          title: "現在の対象公演",
        },
        targetOccurrences: ["2026-10-01T01:00:00Z"],
        milestones: [
          {
            type: "sale_start",
            precision: "datetime",
            at: "2026-09-01T01:00:00.000Z",
          },
        ],
      });
    }
    expect(unscopedParentReads).toBe(0);
  });
});
