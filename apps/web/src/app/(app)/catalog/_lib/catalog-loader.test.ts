import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { tokyoCalendarDateSchema } from "@stage-tracker/domain";
import { server } from "@/test/msw/server";
import { loadCatalogEvents, loadCatalogFilterOptions } from "./catalog-loader";

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

const RANGE = {
  startsOn: tokyoCalendarDateSchema.parse("2026-03-01"),
  endsOn: tokyoCalendarDateSchema.parse("2026-03-31"),
};

describe("loadCatalogEvents", () => {
  it("is empty on a 0-row success", async () => {
    server.use(http.get(`${REST_URL}/events`, () => HttpResponse.json([])));

    const state = await loadCatalogEvents(createTestClient(), RANGE);

    expect(state).toEqual({ variant: "empty" });
  });

  it("is unavailable on a permission-denied response", async () => {
    server.use(
      http.get(`${REST_URL}/events`, () =>
        HttpResponse.json(
          { message: "denied", details: "", hint: "", code: "42501" },
          { status: 403 },
        ),
      ),
    );

    const state = await loadCatalogEvents(createTestClient(), RANGE);

    expect(state.variant).toBe("unavailable");
  });
});

describe("loadCatalogFilterOptions", () => {
  it("succeeds when the genre lookup and every genre's own facet lookup succeed", async () => {
    server.use(
      http.get(`${REST_URL}/genres`, () =>
        HttpResponse.json([
          { id: "11111111-1111-4111-8111-111111111111", key: "takarazuka", display_name: "宝塚", sort_order: 1 },
          { id: "22222222-2222-4222-8222-222222222222", key: "kabuki", display_name: "歌舞伎", sort_order: 2 },
        ]),
      ),
      // takarazuka's facet is group (event_groups), kabuki's is venue (events).
      http.get(`${REST_URL}/event_groups`, () => HttpResponse.json([])),
      http.get(`${REST_URL}/events`, () => HttpResponse.json([])),
    );

    const result = await loadCatalogFilterOptions(createTestClient());

    expect(result.ok).toBe(true);
  });

  it("fails when the genre lookup itself fails", async () => {
    server.use(
      http.get(`${REST_URL}/genres`, () =>
        HttpResponse.json(
          { message: "boom", details: "", hint: "", code: "XX000" },
          { status: 500 },
        ),
      ),
    );

    const result = await loadCatalogFilterOptions(createTestClient());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.variant).toBe("error");
    }
  });

  it("fails when a genre's own facet lookup fails (M8 fix: facet reads are now genre-scoped, not a single flat lookup)", async () => {
    server.use(
      http.get(`${REST_URL}/genres`, () =>
        HttpResponse.json([
          { id: "22222222-2222-4222-8222-222222222222", key: "kabuki", display_name: "歌舞伎", sort_order: 1 },
        ]),
      ),
      http.get(`${REST_URL}/events`, () =>
        HttpResponse.json(
          { message: "boom", details: "", hint: "", code: "XX000" },
          { status: 500 },
        ),
      ),
    );

    const result = await loadCatalogFilterOptions(createTestClient());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.variant).toBe("error");
    }
  });
});

describe("catalog's list and filter reads degrade independently", () => {
  it("keeps the event list populated even when the filter option chain fails", async () => {
    server.use(
      http.get(`${REST_URL}/events`, ({ request }) => {
        const url = new URL(request.url);
        // `listCatalogVenues` also queries `events` (just `venue`, scoped by
        // `genre_id`), so distinguish it from `listEventCatalogInRange`'s
        // richer select.
        if (url.searchParams.get("select")?.includes("event_occurrences")) {
          return HttpResponse.json([
            {
              id: "11111111-1111-4111-8111-111111111111",
              owner_id: "22222222-2222-4222-8222-222222222222",
              title: "テスト公演",
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
          ]);
        }
        return HttpResponse.json(
          { message: "boom", details: "", hint: "", code: "XX000" },
          { status: 500 },
        );
      }),
      // kabuki's active facet is venue, so this exercises the failing
      // `events` (venue) branch above, not the group (event_groups) one.
      http.get(`${REST_URL}/genres`, () =>
        HttpResponse.json([
          { id: "22222222-2222-4222-8222-222222222222", key: "kabuki", display_name: "歌舞伎", sort_order: 1 },
        ]),
      ),
    );

    const client = createTestClient();
    const [eventsState, filterOptions] = await Promise.all([
      loadCatalogEvents(client, RANGE),
      loadCatalogFilterOptions(client),
    ]);

    expect(eventsState.variant).toBe("populated");
    expect(filterOptions.ok).toBe(false);
  });
});
