import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { userIdSchema } from "@stage-tracker/domain";
import { server } from "@/test/msw/server";
import {
  loadCalendarOccurrences,
  loadCalendarSchedule,
} from "./calendar-loader";

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
const GRID_START = "2026-02-22" as never;
const GRID_END = "2026-04-04" as never;

function eventRow() {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    owner_id: USER_ID,
    title: "テスト公演",
    venue: null,
    source_url: null,
    memo: null,
    starts_on: "2026-03-01",
    ends_on: "2026-03-31",
    canceled_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function occurrenceRow(startsAt: string) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    event_id: "22222222-2222-4222-8222-222222222222",
    starts_at: startsAt,
    ends_at: null,
    doors_at: null,
    canceled_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("loadCalendarOccurrences", () => {
  it("indexes an occurrence within the grid range by its Tokyo calendar date", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json([
          {
            id: "66666666-6666-4666-8666-666666666666",
            occurrence_id: "33333333-3333-4333-8333-333333333333",
            user_id: USER_ID,
            status: "attending",
            visibility: "private",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            event_occurrences: {
              ...occurrenceRow("2026-03-15T10:00:00Z"),
              events: eventRow(),
            },
          },
        ]),
      ),
    );

    const state = await loadCalendarOccurrences(
      createTestClient(),
      USER_ID,
      GRID_START,
      GRID_END,
    );

    expect(state.variant).toBe("populated");
    if (state.variant === "populated") {
      expect(state.data.byDate.get("2026-03-15" as never)).toHaveLength(1);
    }
  });

  it("excludes an occurrence outside the grid range", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json([
          {
            id: "66666666-6666-4666-8666-666666666666",
            occurrence_id: "33333333-3333-4333-8333-333333333333",
            user_id: USER_ID,
            status: "attending",
            visibility: "private",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            event_occurrences: {
              ...occurrenceRow("2026-01-01T10:00:00Z"),
              events: eventRow(),
            },
          },
        ]),
      ),
    );

    const state = await loadCalendarOccurrences(
      createTestClient(),
      USER_ID,
      GRID_START,
      GRID_END,
    );

    expect(state).toEqual({ variant: "empty" });
  });

  it("classifies a permission-denied response as unavailable", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(
          { message: "denied", details: "", hint: "", code: "42501" },
          { status: 403 },
        ),
      ),
    );

    const state = await loadCalendarOccurrences(
      createTestClient(),
      USER_ID,
      GRID_START,
      GRID_END,
    );

    expect(state.variant).toBe("unavailable");
  });
});

describe("loadCalendarSchedule", () => {
  it("indexes a multi-day all-day entry on every touched date within the grid", async () => {
    server.use(
      http.get(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json([
          {
            id: "77777777-7777-4777-8777-777777777777",
            owner_id: USER_ID,
            memo: null,
            is_all_day: true,
            starts_on: "2026-03-14",
            ends_on: "2026-03-16",
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

    const state = await loadCalendarSchedule(
      createTestClient(),
      GRID_START,
      GRID_END,
    );

    expect(state.variant).toBe("populated");
    if (state.variant === "populated") {
      expect(state.data.byDate.get("2026-03-14" as never)).toHaveLength(1);
      expect(state.data.byDate.get("2026-03-15" as never)).toHaveLength(1);
      expect(state.data.byDate.get("2026-03-16" as never)).toHaveLength(1);
      expect(state.data.items).toHaveLength(1);
    }
  });

  it("indexes known-end time-bounded entries through every touched Tokyo date", async () => {
    server.use(
      http.get(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json([
          {
            id: "77777777-7777-4777-8777-777777777777",
            owner_id: USER_ID,
            memo: null,
            is_all_day: false,
            starts_on: null,
            ends_on: null,
            starts_at: "2026-03-05T14:00:00Z",
            ends_at: "2026-03-06T00:00:00Z",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            title: "夜行予定",
            blocking: false,
          },
          {
            id: "88888888-8888-4888-8888-888888888888",
            owner_id: USER_ID,
            memo: null,
            is_all_day: false,
            starts_on: null,
            ends_on: null,
            starts_at: "2026-03-07T14:00:00Z",
            ends_at: null,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            title: "終了時刻未定",
            blocking: true,
          },
        ]),
      ),
    );

    const state = await loadCalendarSchedule(
      createTestClient(),
      GRID_START,
      GRID_END,
    );

    expect(state.variant).toBe("populated");
    if (state.variant === "populated") {
      expect(state.data.byDate.get("2026-03-05" as never)).toHaveLength(1);
      expect(state.data.byDate.get("2026-03-06" as never)).toHaveLength(1);
      expect(state.data.byDate.get("2026-03-07" as never)).toHaveLength(1);
      expect(state.data.items).toHaveLength(2);
    }
  });

  it("classifies a failure response as error", async () => {
    server.use(
      http.get(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json(
          { message: "boom", details: "", hint: "", code: "XX000" },
          { status: 500 },
        ),
      ),
    );

    const state = await loadCalendarSchedule(
      createTestClient(),
      GRID_START,
      GRID_END,
    );

    expect(state.variant).toBe("error");
  });
});

describe("calendar's 2 blocks are independent (P4)", () => {
  it("keeps 個人の予定 populated when 参加予定's read fails, and vice versa", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(
          { message: "boom", details: "", hint: "", code: "XX000" },
          { status: 500 },
        ),
      ),
      http.get(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json([
          {
            id: "77777777-7777-4777-8777-777777777777",
            owner_id: USER_ID,
            memo: null,
            is_all_day: true,
            starts_on: "2026-03-14",
            ends_on: "2026-03-14",
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

    const client = createTestClient();
    const [occurrenceState, scheduleState] = await Promise.all([
      loadCalendarOccurrences(client, USER_ID, GRID_START, GRID_END),
      loadCalendarSchedule(client, GRID_START, GRID_END),
    ]);

    expect(occurrenceState.variant).toBe("error");
    expect(scheduleState.variant).toBe("populated");
  });
});
