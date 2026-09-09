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

  const TAKARAZUKA_GENRE_ID = "99999999-9999-4999-8999-999999999999";

  it("reads only the groups associated (via event_groups) with the given genre's events", async () => {
    server.use(
      http.get(`${REST_URL}/event_groups`, ({ request }) => {
        const url = new URL(request.url);
        // M8 で確定した v2 の不具合の regression test: genre でスコープした
        // query であることを確認する（旧実装は `groups` を genre 抜きで
        // 全件読んでいた）。
        expect(url.searchParams.get("events.genre_id")).toBe(
          `eq.${TAKARAZUKA_GENRE_ID}`,
        );
        return HttpResponse.json(
          [
            {
              groups: {
                id: "11111111-1111-4111-8111-111111111111",
                key: "hoshigumi",
                display_name: "星組",
              },
              events: { genre_id: TAKARAZUKA_GENRE_ID },
            },
          ],
          // `content-range` は `runPagedSupabaseSelect` が全ページ読み切った
          // ことを判定するために必須（`count: "exact"` を要求する query の
          // 応答は、この header が無いと supabase-js 側で `count: null` に
          // なる）。
          { status: 200, headers: { "content-range": "0-0/1" } },
        );
      }),
    );

    const result = await listCatalogGroups(
      createTestClient(),
      TAKARAZUKA_GENRE_ID,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.key).toBe("hoshigumi");
    }
  });

  it("de-duplicates venue values client-side, scoped to the given genre (no DISTINCT in PostgREST)", async () => {
    server.use(
      http.get(`${REST_URL}/events`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("genre_id")).toBe(
          `eq.${TAKARAZUKA_GENRE_ID}`,
        );
        return HttpResponse.json(
          [
            { venue: "東京宝塚劇場" },
            { venue: "東京宝塚劇場" },
            { venue: "南座" },
          ],
          { status: 200, headers: { "content-range": "0-2/3" } },
        );
      }),
    );

    const result = await listCatalogVenues(
      createTestClient(),
      TAKARAZUKA_GENRE_ID,
    );

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

    const result = await listCatalogVenues(
      createTestClient(),
      TAKARAZUKA_GENRE_ID,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
    }
  });

  /**
   * PR #402 review finding 1 の regression test: `event_groups` の該当行数が
   * PostgREST の `api.max_rows`（既定 1000、`PAGE_SIZE` の 500 と別軸）を
   * 超えると、`.range()` によるページングが無ければ後続 group が黙って
   * 欠落する。500 行ちょうどの1ページ目 + 1行の2ページ目、という実際の
   * HTTP request 2 回を経由させて、末尾の group が失われないことを確認する
   * （`paged-select.test.ts` は helper 自体の loop ロジックを検証済みだが、
   * ここでは実際の query の wiring - `Range` header・`content-range`
   * 応答の解釈まで含めて確認する）。
   */
  it("pages through more than PAGE_SIZE (500) event_groups rows without dropping the last group", async () => {
    let requestCount = 0;
    server.use(
      http.get(`${REST_URL}/event_groups`, ({ request }) => {
        requestCount += 1;
        const url = new URL(request.url);
        const offset = url.searchParams.get("offset");
        if (offset === "0") {
          const rows = Array.from({ length: 500 }, (_, i) => ({
            groups: {
              id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
              key: `group-${i}`,
              display_name: `Group ${i}`,
            },
            events: { genre_id: TAKARAZUKA_GENRE_ID },
          }));
          return HttpResponse.json(rows, {
            status: 200,
            headers: { "content-range": "0-499/501" },
          });
        }
        // 2ページ目 (500-999): 末尾の1行だけが残っている。
        return HttpResponse.json(
          [
            {
              groups: {
                id: "11111111-1111-4111-8111-111111111111",
                key: "last-group",
                display_name: "最後の組",
              },
              events: { genre_id: TAKARAZUKA_GENRE_ID },
            },
          ],
          { status: 200, headers: { "content-range": "500-500/501" } },
        );
      }),
    );

    const result = await listCatalogGroups(
      createTestClient(),
      TAKARAZUKA_GENRE_ID,
    );

    expect(requestCount).toBe(2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(501);
      expect(result.value.some((group) => group.key === "last-group")).toBe(
        true,
      );
    }
  });
});
