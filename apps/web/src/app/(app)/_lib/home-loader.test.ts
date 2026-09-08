import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { userIdSchema } from "@stage-tracker/domain";
import { server } from "@/test/msw/server";
import { resolveScreenNow } from "@/app/_lib/now";
import {
  loadHomeTicketDeadlines,
  loadHomeUpcomingSchedule,
} from "./home-loader";

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
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const OCCURRENCE_ID = "33333333-3333-4333-8333-333333333333";
const OPPORTUNITY_ID = "44444444-4444-4444-8444-444444444444";

// "now" fixed well before every fixture's dates below, so nothing here is
// ever accidentally treated as already past.
const NOW = resolveScreenNow(Date.parse("2026-03-01T00:00:00Z"));

function eventRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: EVENT_ID,
    owner_id: USER_ID,
    title: "テスト公演",
    venue: null,
    source_url: null,
    memo: null,
    starts_on: "2026-03-10",
    ends_on: "2026-03-20",
    canceled_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function occurrenceRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: OCCURRENCE_ID,
    event_id: EVENT_ID,
    starts_at: "2026-03-15T10:00:00Z",
    ends_at: null,
    doors_at: null,
    canceled_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("loadHomeTicketDeadlines", () => {
  it("is populated when both the shared opportunities and personal state reads succeed", async () => {
    server.use(
      http.get(`${REST_URL}/ticket_opportunities`, () =>
        HttpResponse.json([
          {
            id: OPPORTUNITY_ID,
            event_id: EVENT_ID,
            target_scope: "event_wide",
            display_name: "一般発売",
            source_key: "src-1",
            source_url: null,
            memo: null,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            ticket_opportunity_target_occurrences: [],
            ticket_opportunity_milestones: [
              {
                id: "55555555-5555-4555-8555-555555555555",
                opportunity_id: OPPORTUNITY_ID,
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
        HttpResponse.json([]),
      ),
    );

    const state = await loadHomeTicketDeadlines(
      createTestClient(),
      USER_ID,
      NOW,
    );

    expect(state.variant).toBe("populated");
    if (state.variant === "populated") {
      expect(state.data).toHaveLength(1);
      expect(state.data[0]?.row.opportunityId).toBe(OPPORTUNITY_ID);
    }
  });

  it("is empty when both reads succeed with 0 rows", async () => {
    server.use(
      http.get(`${REST_URL}/ticket_opportunities`, () => HttpResponse.json([])),
      http.get(`${REST_URL}/user_ticket_opportunity_states`, () =>
        HttpResponse.json([]),
      ),
    );

    const state = await loadHomeTicketDeadlines(
      createTestClient(),
      USER_ID,
      NOW,
    );

    expect(state).toEqual({ variant: "empty" });
  });

  it("is unavailable when the shared catalog read is permission-denied, independent of the personal-state read", async () => {
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

    const state = await loadHomeTicketDeadlines(
      createTestClient(),
      USER_ID,
      NOW,
    );

    expect(state.variant).toBe("unavailable");
  });
});

describe("loadHomeUpcomingSchedule", () => {
  it("is populated when both participations and personal schedule succeed", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json([
          {
            id: "66666666-6666-4666-8666-666666666666",
            occurrence_id: OCCURRENCE_ID,
            user_id: USER_ID,
            status: "attending",
            visibility: "private",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            event_occurrences: { ...occurrenceRow(), events: eventRow() },
          },
        ]),
      ),
      http.get(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json([]),
      ),
    );

    const state = await loadHomeUpcomingSchedule(
      createTestClient(),
      USER_ID,
      NOW,
    );

    expect(state.variant).toBe("populated");
    if (state.variant === "populated") {
      expect(state.data).toHaveLength(1);
      expect(state.data[0]?.kind).toBe("occurrence");
    }
  });

  it("stays populated from personal schedule even when the participations read fails (P4 independent degradation)", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(
          { message: "denied", details: "", hint: "", code: "42501" },
          { status: 403 },
        ),
      ),
      http.get(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json([]),
      ),
    );

    const state = await loadHomeUpcomingSchedule(
      createTestClient(),
      USER_ID,
      NOW,
    );

    // The whole block is one unit backed by 2 reads (§ this file's own
    // module docstring), but the point under test here is that a failure in
    // THIS block never touches the other, sibling block
    // (loadHomeTicketDeadlines) - covered together in
    // `apps/web/src/app/(app)/page.test.tsx`-equivalent coverage at the
    // HomeView level, since that is where the 2 blocks are actually
    // independent of each other.
    expect(state.variant).toBe("unavailable");
  });

  it("excludes an occurrence whose startsAt has already passed", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json([
          {
            id: "66666666-6666-4666-8666-666666666666",
            occurrence_id: OCCURRENCE_ID,
            user_id: USER_ID,
            status: "attending",
            visibility: "private",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            event_occurrences: {
              ...occurrenceRow({ starts_at: "2026-01-01T00:00:00Z" }),
              events: eventRow(),
            },
          },
        ]),
      ),
      http.get(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json([]),
      ),
    );

    const state = await loadHomeUpcomingSchedule(
      createTestClient(),
      USER_ID,
      NOW,
    );

    expect(state).toEqual({ variant: "empty" });
  });
});

describe("home's 2 blocks are independent (P4)", () => {
  it("keeps 直近の予定 populated when 申し込み期限's own reads fail, and vice versa", async () => {
    server.use(
      // 申し込み期限 block: shared catalog read fails outright.
      http.get(`${REST_URL}/ticket_opportunities`, () =>
        HttpResponse.json(
          { message: "boom", details: "", hint: "", code: "XX000" },
          { status: 500 },
        ),
      ),
      http.get(`${REST_URL}/user_ticket_opportunity_states`, () =>
        HttpResponse.json([]),
      ),
      // 直近の予定 block: both of its reads succeed with real data.
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json([
          {
            id: "66666666-6666-4666-8666-666666666666",
            occurrence_id: OCCURRENCE_ID,
            user_id: USER_ID,
            status: "attending",
            visibility: "private",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            event_occurrences: { ...occurrenceRow(), events: eventRow() },
          },
        ]),
      ),
      http.get(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json([]),
      ),
    );

    const client = createTestClient();
    const [ticketState, scheduleState] = await Promise.all([
      loadHomeTicketDeadlines(client, USER_ID, NOW),
      loadHomeUpcomingSchedule(client, USER_ID, NOW),
    ]);

    expect(ticketState.variant).toBe("error");
    expect(scheduleState.variant).toBe("populated");
  });
});
