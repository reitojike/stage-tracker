import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { userIdSchema } from "@stage-tracker/domain";
import { server } from "@/test/msw/server";
import { resolveScreenNow } from "@/app/_lib/now";
import { loadTicketsTimeline } from "./tickets-loader";

const SUPABASE_URL = "https://example-project.supabase.test";
const REST_URL = `${SUPABASE_URL}/rest/v1`;

function createTestClient(): SupabaseClient {
  return createClient(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

afterEach(() => {
  server.resetHandlers();
});

const USER_ID = userIdSchema.parse("11111111-1111-4111-8111-111111111111");
const NOW = resolveScreenNow(Date.parse("2026-03-01T00:00:00Z"));

describe("loadTicketsTimeline", () => {
  it("is empty when both reads succeed with 0 rows", async () => {
    server.use(
      http.get(`${REST_URL}/ticket_opportunities`, () => HttpResponse.json([])),
      http.get(`${REST_URL}/user_ticket_opportunity_states`, () =>
        HttpResponse.json([]),
      ),
    );

    const state = await loadTicketsTimeline(createTestClient(), USER_ID, NOW);

    expect(state).toEqual({
      block: { variant: "empty" },
      optional: { ok: true },
    });
  });

  it("groups a populated timeline by month", async () => {
    server.use(
      http.get(`${REST_URL}/ticket_opportunities`, () =>
        HttpResponse.json([
          {
            id: "44444444-4444-4444-8444-444444444444",
            event_id: "22222222-2222-4222-8222-222222222222",
            target_scope: "event_wide",
            display_name: "一般発売",
            source_key: "src-1",
            source_url: null,
            memo: null,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            events: { canceled_at: null },
            ticket_opportunity_target_occurrences: [],
            ticket_opportunity_milestones: [
              {
                id: "55555555-5555-4555-8555-555555555555",
                opportunity_id: "44444444-4444-4444-8444-444444444444",
                milestone_type: "sale_start",
                temporal_precision: "datetime",
                date_value: null,
                at: "2026-03-10T10:00:00Z",
                starts_at: null,
                ends_at: null,
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
              },
            ],
          },
        ]),
      ),
      http.get(`${REST_URL}/user_ticket_opportunity_states`, () =>
        HttpResponse.json([
          {
            id: "88888888-8888-4888-8888-888888888888",
            user_id: USER_ID,
            opportunity_id: "44444444-4444-4444-8444-444444444444",
            status: "planned",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ]),
      ),
    );

    const state = await loadTicketsTimeline(createTestClient(), USER_ID, NOW);

    expect(state.block.variant).toBe("populated");
    expect(state.optional).toEqual({ ok: true });
    if (state.block.variant === "populated") {
      expect(state.block.data.groups).toHaveLength(1);
      expect(state.block.data.groups[0]?.monthKey).toBe("2026-03");
      expect(state.block.data.groups[0]?.rows[0]?.myState).toBe("planned");
    }
  });

  it("carries effective cancellation from the shared read to timeline rows", async () => {
    server.use(
      http.get(`${REST_URL}/ticket_opportunities`, () =>
        HttpResponse.json([
          {
            id: "44444444-4444-4444-8444-444444444444",
            event_id: "22222222-2222-4222-8222-222222222222",
            target_scope: "event_wide",
            display_name: "一般発売",
            source_key: "src-1",
            source_url: null,
            memo: null,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            events: { canceled_at: "2026-01-01T00:00:00Z" },
            ticket_opportunity_target_occurrences: [],
            ticket_opportunity_milestones: [
              {
                id: "55555555-5555-4555-8555-555555555555",
                opportunity_id: "44444444-4444-4444-8444-444444444444",
                milestone_type: "sale_start",
                temporal_precision: "datetime",
                date_value: null,
                at: "2026-03-10T10:00:00Z",
                starts_at: null,
                ends_at: null,
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
              },
            ],
          },
        ]),
      ),
      http.get(`${REST_URL}/user_ticket_opportunity_states`, () =>
        HttpResponse.json([
          {
            id: "88888888-8888-4888-8888-888888888888",
            user_id: USER_ID,
            opportunity_id: "44444444-4444-4444-8444-444444444444",
            status: "applied",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ]),
      ),
    );

    const state = await loadTicketsTimeline(createTestClient(), USER_ID, NOW);

    expect(state.block.variant).toBe("populated");
    if (state.block.variant === "populated") {
      expect(state.block.data.groups[0]?.rows[0]?.isEffectivelyCanceled).toBe(
        true,
      );
      expect(state.block.data.groups[0]?.rows[0]?.myState).toBe("applied");
    }
  });

  it("is unavailable when the shared catalog read is permission-denied", async () => {
    server.use(
      http.get(`${REST_URL}/ticket_opportunities`, () =>
        HttpResponse.json(
          { message: "denied", details: "", hint: "", code: "42501" },
          { status: 403 },
        ),
      ),
      http.get(`${REST_URL}/user_ticket_opportunity_states`, () =>
        HttpResponse.json([]),
      ),
    );

    const state = await loadTicketsTimeline(createTestClient(), USER_ID, NOW);

    expect(state.block.variant).toBe("unavailable");
  });

  it("stays populated from the shared timeline even when the personal-state read fails, and reports the personal-state read's own failure separately (P4 read-level degradation)", async () => {
    // PR #381 review finding 1: `listTicketOpportunities` is required,
    // `listMyTicketOpportunityStates` is optional (`classifyBlock2Optional`,
    // same shape as home's "申し込み期限" block) - the shared timeline must
    // still render (with no trustworthy `myState` per row) when only the
    // personal-state read fails.
    //
    // PR #381 P4 follow-up review finding 2: `state.optional` must expose
    // that failure separately from `state.block` - every row's `myState` is
    // `null` either way, so a caller reading only `block` cannot tell "no
    // personal state exists" apart from "the personal-state read failed",
    // and `TicketsView` needs that distinction to render "不明" instead of
    // silently omitting the badge.
    server.use(
      http.get(`${REST_URL}/ticket_opportunities`, () =>
        HttpResponse.json([
          {
            id: "44444444-4444-4444-8444-444444444444",
            event_id: "22222222-2222-4222-8222-222222222222",
            target_scope: "event_wide",
            display_name: "一般発売",
            source_key: "src-1",
            source_url: null,
            memo: null,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            events: { canceled_at: null },
            ticket_opportunity_target_occurrences: [],
            ticket_opportunity_milestones: [
              {
                id: "55555555-5555-4555-8555-555555555555",
                opportunity_id: "44444444-4444-4444-8444-444444444444",
                milestone_type: "sale_start",
                temporal_precision: "datetime",
                date_value: null,
                at: "2026-03-10T10:00:00Z",
                starts_at: null,
                ends_at: null,
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
              },
            ],
          },
        ]),
      ),
      http.get(`${REST_URL}/user_ticket_opportunity_states`, () =>
        HttpResponse.json(
          { message: "boom", details: "", hint: "", code: "XX000" },
          { status: 500 },
        ),
      ),
    );

    const state = await loadTicketsTimeline(createTestClient(), USER_ID, NOW);

    expect(state.block.variant).toBe("populated");
    if (state.block.variant === "populated") {
      expect(state.block.data.groups).toHaveLength(1);
      expect(state.block.data.groups[0]?.rows[0]?.myState).toBeNull();
    }
    expect(state.optional).toEqual({ ok: false, variant: "error" });
  });
});
