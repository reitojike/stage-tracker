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
    }
  });
});
