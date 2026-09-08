import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { eventIdSchema } from "@stage-tracker/domain";
import { server } from "@/test/msw/server";
import { getEventWithOccurrences } from "./getEventDetail";

const SUPABASE_URL = "https://example-project.supabase.test";
const REST_URL = `${SUPABASE_URL}/rest/v1`;

const eventId = eventIdSchema.parse("11111111-1111-4111-8111-111111111111");
const ownerId = "22222222-2222-4222-8222-222222222222";

function createTestClient(): SupabaseClient {
  return createClient(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

afterEach(() => {
  server.resetHandlers();
});

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: eventId,
    owner_id: ownerId,
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

describe("getEventWithOccurrences", () => {
  it("classifies a genuine 0-row response (no matching event) as ok with an empty array", async () => {
    // `events` は `using (true)` の shared catalog - 0件は必ず「本当に
    // 存在しない」であり、権限起因の unavailable がここに化けることはない。
    // 呼び出し元はこれを `classifyListReadResult` へ渡し、`empty` として
    // 「指定された公演が見つかりません」を表示できる。
    server.use(
      http.get(`${REST_URL}/events`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    const result = await getEventWithOccurrences(createTestClient(), eventId);

    expect(result).toEqual({ ok: true, value: [] });
  });

  it("maps a populated response, including a 0-occurrence event (a valid state)", async () => {
    server.use(
      http.get(`${REST_URL}/events`, () =>
        HttpResponse.json([eventRow()], { status: 200 }),
      ),
    );

    const result = await getEventWithOccurrences(createTestClient(), eventId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.event.title).toBe("宝塚公演");
      expect(result.value[0]?.occurrences).toEqual([]);
    }
  });

  it("sorts occurrences ascending by startsAt regardless of row order", async () => {
    server.use(
      http.get(`${REST_URL}/events`, () =>
        HttpResponse.json(
          [
            eventRow({
              event_occurrences: [
                {
                  id: "33333333-3333-4333-8333-333333333333",
                  event_id: eventId,
                  doors_at: null,
                  starts_at: "2026-03-10T10:00:00Z",
                  ends_at: null,
                  canceled_at: null,
                  created_at: "2026-01-01T00:00:00Z",
                  updated_at: "2026-01-01T00:00:00Z",
                },
                {
                  id: "44444444-4444-4444-8444-444444444444",
                  event_id: eventId,
                  doors_at: null,
                  starts_at: "2026-03-05T10:00:00Z",
                  ends_at: null,
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
      const occurrences = result.value[0]?.occurrences ?? [];
      expect(occurrences.map((o) => o.id)).toEqual([
        "44444444-4444-4444-8444-444444444444",
        "33333333-3333-4333-8333-333333333333",
      ]);
    }
  });

  it("classifies a permission-denied response as unavailable", async () => {
    server.use(
      http.get(`${REST_URL}/events`, () =>
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

    const result = await getEventWithOccurrences(createTestClient(), eventId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("permission-denied");
    }
  });
});
