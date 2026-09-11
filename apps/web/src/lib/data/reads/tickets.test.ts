import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { userIdSchema } from "@stage-tracker/domain";
import { server } from "@/test/msw/server";
import {
  buildTicketOpportunityAggregates,
  listMyTicketOpportunityStates,
  listTicketOpportunities,
} from "./tickets";

const SUPABASE_URL = "https://example-project.supabase.test";
const REST_URL = `${SUPABASE_URL}/rest/v1`;
const userId = userIdSchema.parse("11111111-1111-4111-8111-111111111111");

function createTestClient(): SupabaseClient {
  return createClient(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

afterEach(() => {
  server.resetHandlers();
});

const opportunityId = "22222222-2222-4222-8222-222222222222";
const eventId = "33333333-3333-4333-8333-333333333333";

function opportunityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: opportunityId,
    event_id: eventId,
    target_scope: "event_wide",
    display_name: "FC先行",
    source_key: "fc-presale-1",
    source_url: null,
    memo: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    events: { canceled_at: null },
    ticket_opportunity_target_occurrences: [],
    ticket_opportunity_milestones: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        opportunity_id: opportunityId,
        milestone_type: "application_close",
        temporal_precision: "date",
        date_value: "2026-02-01",
        at: null,
        starts_at: null,
        ends_at: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ],
    ...overrides,
  };
}

/**
 * `listTicketOpportunities`（shared catalog）と
 * `listMyTicketOpportunityStates`（personal, own only）は
 * `docs/v2/decisions.md` P4「read ごとに独立して劣化」に従い意図的に
 * 分離している（`./tickets.ts` の docstring）。ここではその独立性を、
 * 片方が失敗しても他方の分類結果に影響しないことで検証する。
 */
describe("listTicketOpportunities (shared catalog)", () => {
  it("classifies a 0-row success as empty", async () => {
    server.use(
      http.get(`${REST_URL}/ticket_opportunities`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    const result = await listTicketOpportunities(createTestClient());

    expect(result).toEqual({ ok: true, value: [] });
  });

  it("maps a populated success into TicketOpportunityDetail with its milestones", async () => {
    server.use(
      http.get(`${REST_URL}/ticket_opportunities`, () =>
        HttpResponse.json([opportunityRow()], { status: 200 }),
      ),
    );

    const result = await listTicketOpportunities(createTestClient());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(
        result.value[0]?.opportunityWithTargets.opportunity.displayName,
      ).toBe("FC先行");
      expect(result.value[0]?.milestones).toHaveLength(1);
    }
  });

  it("maps parent and selected-target cancellation facts through the canonical classification", async () => {
    const canceledOccurrenceId = "66666666-6666-4666-8666-666666666666";
    server.use(
      http.get(`${REST_URL}/ticket_opportunities`, () =>
        HttpResponse.json([
          opportunityRow({
            events: { canceled_at: "2026-01-01T00:00:00Z" },
            target_scope: "selected_occurrences",
            ticket_opportunity_target_occurrences: [
              {
                occurrence_id: canceledOccurrenceId,
                event_occurrences: { canceled_at: null },
              },
            ],
          }),
        ]),
      ),
    );

    const result = await listTicketOpportunities(createTestClient());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]?.isEffectivelyCanceled).toBe(true);
      expect(result.value[0]?.cancellationScope.eventCanceled).toBe(true);
    }
  });

  it("does not classify a selected opportunity as canceled when target resolution is partial", async () => {
    const canceledOccurrenceId =
      "66666666-6666-4666-8666-666666666666";
    const unresolvedOccurrenceId = "77777777-7777-4777-8777-777777777777";
    server.use(
      http.get(`${REST_URL}/ticket_opportunities`, () =>
        HttpResponse.json([
          opportunityRow({
            target_scope: "selected_occurrences",
            ticket_opportunity_target_occurrences: [
              {
                occurrence_id: canceledOccurrenceId,
                event_occurrences: { canceled_at: "2026-01-01T00:00:00Z" },
              },
              {
                occurrence_id: unresolvedOccurrenceId,
                event_occurrences: null,
              },
            ],
          }),
        ]),
      ),
    );

    const result = await listTicketOpportunities(createTestClient());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]?.isEffectivelyCanceled).toBe(false);
      expect(result.value[0]?.cancellationScope).toMatchObject({
        targetOccurrenceIdCount: 2,
        resolvedTargetOccurrences: [
          { canceledAt: "2026-01-01T00:00:00.000Z" },
        ],
      });
    }
  });

  it("classifies a permission-denied response as unavailable, independent of the personal-state read", async () => {
    server.use(
      http.get(`${REST_URL}/ticket_opportunities`, () =>
        HttpResponse.json(
          {
            message: "permission denied",
            details: "",
            hint: "",
            code: "42501",
          },
          { status: 403 },
        ),
      ),
    );

    const result = await listTicketOpportunities(createTestClient());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("permission-denied");
    }
  });
});

describe("listMyTicketOpportunityStates (personal, own only)", () => {
  it("classifies a 0-row success as empty (not registered as a planning target)", async () => {
    server.use(
      http.get(`${REST_URL}/user_ticket_opportunity_states`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    const result = await listMyTicketOpportunityStates(
      createTestClient(),
      userId,
    );

    expect(result).toEqual({ ok: true, value: [] });
  });

  it("maps a populated success", async () => {
    server.use(
      http.get(`${REST_URL}/user_ticket_opportunity_states`, () =>
        HttpResponse.json(
          [
            {
              id: "55555555-5555-4555-8555-555555555555",
              user_id: userId,
              opportunity_id: opportunityId,
              status: "planned",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
          { status: 200 },
        ),
      ),
    );

    const result = await listMyTicketOpportunityStates(
      createTestClient(),
      userId,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]?.status).toBe("planned");
    }
  });

  it("classifies an unauthenticated response as unavailable, independent of the shared catalog read", async () => {
    server.use(
      http.get(`${REST_URL}/user_ticket_opportunity_states`, () =>
        HttpResponse.json(
          { message: "JWT expired", details: "", hint: "", code: "PGRST301" },
          { status: 401 },
        ),
      ),
    );

    const result = await listMyTicketOpportunityStates(
      createTestClient(),
      userId,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unauthenticated");
    }
  });
});

describe("buildTicketOpportunityAggregates", () => {
  it("joins each opportunity with the caller's own state (null when not registered)", async () => {
    server.use(
      http.get(`${REST_URL}/ticket_opportunities`, () =>
        HttpResponse.json([opportunityRow()], { status: 200 }),
      ),
      http.get(`${REST_URL}/user_ticket_opportunity_states`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    const opportunities = await listTicketOpportunities(createTestClient());
    const myStates = await listMyTicketOpportunityStates(
      createTestClient(),
      userId,
    );
    expect(opportunities.ok && myStates.ok).toBe(true);
    if (opportunities.ok && myStates.ok) {
      const aggregates = buildTicketOpportunityAggregates(
        opportunities.value,
        myStates.value,
      );
      expect(aggregates).toHaveLength(1);
      expect(aggregates[0]?.myState).toBeNull();
      expect(aggregates[0]?.milestones).toHaveLength(1);
      // PR #381 review finding 2: the aggregate must not drop the source
      // Opportunity's own `displayName` - without it, two Opportunities
      // due on the same day are indistinguishable once reduced to
      // "milestone type + date" (see the dedicated test below).
      expect(aggregates[0]?.displayName).toBe("FC先行");
    }
  });

  it("carries each opportunity's own displayName into its aggregate, disambiguating two opportunities that would otherwise collapse to the same milestone type + date (PR #381 review finding 2)", async () => {
    const otherOpportunityId = "66666666-6666-4666-8666-666666666666";
    server.use(
      http.get(`${REST_URL}/ticket_opportunities`, () =>
        HttpResponse.json(
          [
            opportunityRow(),
            opportunityRow({
              id: otherOpportunityId,
              display_name: "一般発売",
            }),
          ],
          { status: 200 },
        ),
      ),
      http.get(`${REST_URL}/user_ticket_opportunity_states`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    const opportunities = await listTicketOpportunities(createTestClient());
    const myStates = await listMyTicketOpportunityStates(
      createTestClient(),
      userId,
    );
    expect(opportunities.ok && myStates.ok).toBe(true);
    if (opportunities.ok && myStates.ok) {
      const aggregates = buildTicketOpportunityAggregates(
        opportunities.value,
        myStates.value,
      );
      expect(aggregates).toHaveLength(2);
      expect(aggregates.map((aggregate) => aggregate.displayName)).toEqual([
        "FC先行",
        "一般発売",
      ]);
      // Both opportunities still resolve to the same eventId here (this
      // fixture doesn't vary event_id) - eventId alone is exactly the
      // "cannot tell them apart" case the review finding names;
      // displayName is what makes the two rows distinguishable.
      expect(
        new Set(aggregates.map((aggregate) => aggregate.eventId)).size,
      ).toBe(1);
    }
  });
});
