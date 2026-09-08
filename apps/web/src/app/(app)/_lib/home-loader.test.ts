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

    expect(state.block.variant).toBe("populated");
    expect(state.optional).toEqual({ ok: true });
    if (state.block.variant === "populated") {
      expect(state.block.data).toHaveLength(1);
      expect(state.block.data[0]?.row.opportunityId).toBe(OPPORTUNITY_ID);
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

    expect(state).toEqual({
      block: { variant: "empty" },
      optional: { ok: true },
    });
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

    expect(state.block.variant).toBe("unavailable");
  });

  it("stays populated from the shared catalog even when the personal-state read fails, and reports the personal-state read's own failure separately (P4 read-level degradation)", async () => {
    // PR #381 review finding 1: `listTicketOpportunities` is required,
    // `listMyTicketOpportunityStates` is optional
    // (`classifyBlock2Optional`) - a failure fetching the caller's own
    // planning state must not hide the shared opportunity itself, only the
    // `myState` badge on it.
    //
    // PR #381 P4 follow-up review finding 2: `state.optional` must report
    // the personal-state read's real failure - `state.block.data[0].myState`
    // alone is `null`, indistinguishable from "no personal state exists for
    // this opportunity", so a caller relying only on `block` would silently
    // render this exactly like a real 0-row personal-state read.
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
        HttpResponse.json(
          { message: "boom", details: "", hint: "", code: "XX000" },
          { status: 500 },
        ),
      ),
    );

    const state = await loadHomeTicketDeadlines(
      createTestClient(),
      USER_ID,
      NOW,
    );

    expect(state.block.variant).toBe("populated");
    if (state.block.variant === "populated") {
      expect(state.block.data).toHaveLength(1);
      expect(state.block.data[0]?.row.opportunityId).toBe(OPPORTUNITY_ID);
      expect(state.block.data[0]?.row.myState).toBeNull();
    }
    expect(state.optional).toEqual({ ok: false, variant: "error" });
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

  it("reports partial (not populated, not empty) with personal schedule's real data when the participations read fails (P4 read-level degradation)", async () => {
    // PR #381 review finding 1: this test's own name previously asserted
    // the opposite of what it verified (`variant` was checked as
    // `"unavailable"`, i.e. the whole block hidden). `classifyMergedListBlock2`
    // fixes that: `listMyParticipations` failing alone must not hide the
    // items `listVisiblePersonalSchedule` still returns - the fixture below
    // uses a real (non-empty), not-yet-past schedule entry so this actually
    // exercises the "surviving read's data is kept" path, not just an empty
    // coincidence.
    //
    // PR #381 P4 follow-up review finding 1: the result is `"partial"`, not
    // `"populated"` - `populated`/`empty` are reserved for "both reads
    // actually succeeded"; a failed sibling read must remain visible via the
    // `a`/`b` `PartState`s even while the surviving data renders.
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(
          { message: "denied", details: "", hint: "", code: "42501" },
          { status: 403 },
        ),
      ),
      http.get(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json([
          {
            id: "77777777-7777-4777-8777-777777777777",
            owner_id: USER_ID,
            memo: null,
            is_all_day: true,
            starts_on: "2026-03-05",
            ends_on: "2026-03-06",
            starts_at: null,
            ends_at: null,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            title: "旅行",
            blocking: true,
          },
        ]),
      ),
    );

    const state = await loadHomeUpcomingSchedule(
      createTestClient(),
      USER_ID,
      NOW,
    );

    expect(state.variant).toBe("partial");
    if (state.variant === "partial") {
      expect(state.data).toHaveLength(1);
      expect(state.data[0]?.kind).toBe("schedule");
      if (state.data[0]?.kind === "schedule") {
        expect(state.data[0].entry.title).toBe("旅行");
      }
      expect(state.a).toEqual({ ok: false, variant: "unavailable" });
      expect(state.b).toEqual({ ok: true });
    }
  });

  /**
   * PR #381 P4 follow-up review finding 1 (this Task's core fix): "1 read
   * fails + the surviving read succeeds with 0 rows" must not be reported as
   * `"empty"` - that would be indistinguishable from "both reads genuinely
   * returned 0 rows", silently hiding a real, unresolved failure.
   */
  it("is partial, never empty, when participations fails and personal schedule alone succeeds with 0 rows", async () => {
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

    expect(state.variant).not.toBe("empty");
    expect(state).toEqual({
      variant: "partial",
      data: [],
      a: { ok: false, variant: "unavailable" },
      b: { ok: true },
    });
  });

  it("is unavailable when both participations and personal schedule fail", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(
          { message: "denied", details: "", hint: "", code: "42501" },
          { status: 403 },
        ),
      ),
      http.get(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json(
          { message: "boom", details: "", hint: "", code: "XX000" },
          { status: 500 },
        ),
      ),
    );

    const state = await loadHomeUpcomingSchedule(
      createTestClient(),
      USER_ID,
      NOW,
    );

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

    expect(ticketState.block.variant).toBe("error");
    expect(scheduleState.variant).toBe("populated");
  });
});
