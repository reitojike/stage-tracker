import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { tokyoCalendarDateSchema } from "@stage-tracker/domain";
import { server } from "@/test/msw/server";
import {
  listCatalogGenres,
  listCatalogGroups,
  listCatalogVenues,
  listEventCatalogInRange,
} from "./catalog";

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

const range = {
  startsOn: tokyoCalendarDateSchema.parse("2026-03-01"),
  endsOn: tokyoCalendarDateSchema.parse("2026-03-31"),
};

describe("listEventCatalogInRange", () => {
  it("classifies a 0-row success as empty (ok with an empty array)", async () => {
    server.use(
      http.get(`${REST_URL}/events`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    const result = await listEventCatalogInRange(createTestClient(), range);

    expect(result).toEqual({ ok: true, value: [] });
  });

  it("maps a populated success, including a 0-occurrence event and its classification", async () => {
    server.use(
      http.get(`${REST_URL}/events`, () =>
        HttpResponse.json(
          [
            {
              id: "11111111-1111-4111-8111-111111111111",
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
              // Event range known, no occurrences announced yet - a valid
              // state (AGENTS.md "Event 開催期間 (Event range)").
              event_occurrences: [],
              genres: {
                id: "33333333-3333-4333-8333-333333333333",
                key: "takarazuka",
                display_name: "宝塚",
                sort_order: 1,
              },
              event_groups: [
                { group_id: "44444444-4444-4444-8444-444444444444" },
              ],
            },
          ],
          { status: 200 },
        ),
      ),
    );

    const result = await listEventCatalogInRange(createTestClient(), range);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      const entry = result.value[0];
      expect(entry?.occurrences).toEqual([]);
      expect(entry?.classification.genre?.key).toBe("takarazuka");
      expect(entry?.classification.groupIds).toEqual([
        "44444444-4444-4444-8444-444444444444",
      ]);
    }
  });

  it("maps an unclassified event (null genre, no groups) without inventing a classification", async () => {
    server.use(
      http.get(`${REST_URL}/events`, () =>
        HttpResponse.json(
          [
            {
              id: "11111111-1111-4111-8111-111111111111",
              owner_id: "22222222-2222-4222-8222-222222222222",
              title: "未分類公演",
              venue: null,
              source_url: null,
              memo: null,
              starts_on: "2026-03-05",
              ends_on: "2026-03-05",
              canceled_at: null,
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
              event_occurrences: [],
              genres: null,
              event_groups: [],
            },
          ],
          { status: 200 },
        ),
      ),
    );

    const result = await listEventCatalogInRange(createTestClient(), range);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]?.classification.genre).toBeNull();
      expect(result.value[0]?.classification.groupIds).toEqual([]);
    }
  });

  it("classifies a permission-denied response as unavailable (never empty)", async () => {
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

    const result = await listEventCatalogInRange(createTestClient(), range);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("permission-denied");
    }
  });
});

describe("listCatalogGenres / listCatalogGroups / listCatalogVenues", () => {
  it("reads the catalog-wide genre lookup", async () => {
    server.use(
      http.get(`${REST_URL}/genres`, () =>
        HttpResponse.json(
          [
            {
              id: "11111111-1111-4111-8111-111111111111",
              key: "takarazuka",
              display_name: "宝塚",
              sort_order: 1,
            },
            {
              id: "22222222-2222-4222-8222-222222222222",
              key: "kabuki",
              display_name: "歌舞伎",
              sort_order: 2,
            },
          ],
          { status: 200 },
        ),
      ),
    );

    const result = await listCatalogGenres(createTestClient());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((g) => g.key)).toEqual(["takarazuka", "kabuki"]);
    }
  });

  it("reads the catalog-wide group lookup", async () => {
    server.use(
      http.get(`${REST_URL}/groups`, () =>
        HttpResponse.json(
          [
            {
              id: "11111111-1111-4111-8111-111111111111",
              key: "hoshigumi",
              display_name: "星組",
            },
          ],
          { status: 200 },
        ),
      ),
    );

    const result = await listCatalogGroups(createTestClient());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
    }
  });

  it("de-duplicates venue values client-side (no DISTINCT in PostgREST)", async () => {
    server.use(
      http.get(`${REST_URL}/events`, () =>
        HttpResponse.json(
          [
            { venue: "東京宝塚劇場" },
            { venue: "東京宝塚劇場" },
            { venue: "南座" },
          ],
          { status: 200 },
        ),
      ),
    );

    const result = await listCatalogVenues(createTestClient());

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Locale collation order for Japanese strings isn't asserted here
      // (varies by ICU build) - only that duplicates are removed.
      expect(result.value).toHaveLength(2);
      expect(new Set(result.value)).toEqual(new Set(["南座", "東京宝塚劇場"]));
    }
  });

  it("classifies a failure response as failure for the venue read too", async () => {
    server.use(
      http.get(`${REST_URL}/events`, () =>
        HttpResponse.json(
          { message: "internal error", details: "", hint: "", code: "XX000" },
          { status: 500 },
        ),
      ),
    );

    const result = await listCatalogVenues(createTestClient());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
    }
  });
});
