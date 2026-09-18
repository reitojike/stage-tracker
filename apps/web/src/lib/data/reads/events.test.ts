import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { eventIdSchema } from "@stage-tracker/domain";
import type { Database } from "../database.types";
import { server } from "@/test/msw/server";
import { getEventWithOccurrences } from "./events";

const SUPABASE_URL = "https://example-project.supabase.test";
const REST_URL = `${SUPABASE_URL}/rest/v1`;
const eventId = eventIdSchema.parse("11111111-1111-4111-8111-111111111111");

function createTestClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: eventId,
    owner_id: "22222222-2222-4222-8222-222222222222",
    title: "宝塚公演",
    venue: "東京宝塚劇場",
    source_url: null,
    memo: null,
    starts_on: "2026-03-05",
    ends_on: "2026-03-20",
    canceled_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    event_occurrences: [],
    ...overrides,
  };
}

afterEach(() => {
  server.resetHandlers();
});

describe("getEventWithOccurrences", () => {
  it("maps a valid event with zero occurrences", async () => {
    server.use(
      http.get(`${REST_URL}/events`, () =>
        HttpResponse.json([eventRow()], { status: 200 }),
      ),
    );

    const result = await getEventWithOccurrences(createTestClient(), eventId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]?.event.title).toBe("宝塚公演");
      expect(result.value[0]?.occurrences).toEqual([]);
    }
  });

  it("returns an empty successful result when the event is not found", async () => {
    server.use(
      http.get(`${REST_URL}/events`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    await expect(
      getEventWithOccurrences(createTestClient(), eventId),
    ).resolves.toEqual({
      ok: true,
      value: [],
    });
  });

  it("sorts occurrences chronologically after domain mapping", async () => {
    server.use(
      http.get(`${REST_URL}/events`, () =>
        HttpResponse.json(
          [
            eventRow({
              event_occurrences: [
                {
                  id: "33333333-3333-4333-8333-333333333333",
                  event_id: eventId,
                  starts_at: "2026-03-10T10:00:00Z",
                  ends_at: null,
                  doors_at: null,
                  canceled_at: null,
                  created_at: "2026-01-01T00:00:00Z",
                  updated_at: "2026-01-01T00:00:00Z",
                },
                {
                  id: "44444444-4444-4444-8444-444444444444",
                  event_id: eventId,
                  starts_at: "2026-03-05T10:00:00Z",
                  ends_at: null,
                  doors_at: null,
                  canceled_at: null,
                  created_at: "2026-01-01T00:00:00Z",
                  updated_at: "2026-01-01T00:00:00Z",
                },
              ],
            }),
          ],
          { status: 200 },
        ),
      ),
    );

    const result = await getEventWithOccurrences(createTestClient(), eventId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.value[0]?.occurrences.map((occurrence) => occurrence.id),
      ).toEqual([
        "44444444-4444-4444-8444-444444444444",
        "33333333-3333-4333-8333-333333333333",
      ]);
    }
  });

  it("returns failure when a mapped row is malformed", async () => {
    server.use(
      http.get(`${REST_URL}/events`, () =>
        HttpResponse.json([eventRow({ title: null })], { status: 200 }),
      ),
    );

    const result = await getEventWithOccurrences(createTestClient(), eventId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
    }
  });

  it("returns failure when the query fails", async () => {
    server.use(
      http.get(`${REST_URL}/events`, () =>
        HttpResponse.json(
          { code: "PGRST000", message: "database unavailable" },
          { status: 500 },
        ),
      ),
    );

    const result = await getEventWithOccurrences(createTestClient(), eventId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
    }
  });
});
