import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { listVisiblePersonalSchedule } from "./personalSchedule";

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

/**
 * `listVisiblePersonalSchedule` は明示的な owner/share フィルタを持たず、
 * RLS の可視範囲（owner本人 OR 自分宛の share）にそのまま委ねる設計
 * （`./personalSchedule.ts` の docstring）。ここではその設計どおり、
 * 成功+0行/成功+複数行（all-day と time-bounded の両形状）/権限拒否/
 * 一般失敗の4パターンを検証する。
 */
describe("listVisiblePersonalSchedule", () => {
  it("classifies a 0-row success as empty (ok with an empty array)", async () => {
    server.use(
      http.get(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    const result = await listVisiblePersonalSchedule(createTestClient());

    expect(result).toEqual({ ok: true, value: [] });
  });

  it("maps both all-day and time-bounded rows into their discriminated temporal shapes", async () => {
    server.use(
      http.get(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json(
          [
            {
              id: "11111111-1111-4111-8111-111111111111",
              owner_id: "22222222-2222-4222-8222-222222222222",
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
            {
              id: "33333333-3333-4333-8333-333333333333",
              owner_id: "22222222-2222-4222-8222-222222222222",
              memo: null,
              is_all_day: false,
              starts_on: null,
              ends_on: null,
              starts_at: "2026-03-10T09:00:00Z",
              ends_at: "2026-03-10T18:00:00Z",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
              title: "仕事",
              blocking: false,
            },
          ],
          { status: 200 },
        ),
      ),
    );

    const result = await listVisiblePersonalSchedule(createTestClient());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]?.temporal.kind).toBe("all-day");
      expect(result.value[1]?.temporal.kind).toBe("time-bounded");
      expect(result.value[1]?.blocking).toBe(false);
    }
  });

  it("classifies an unauthenticated response as unavailable (never empty)", async () => {
    server.use(
      http.get(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json(
          { message: "JWT expired", details: "", hint: "", code: "PGRST301" },
          { status: 401 },
        ),
      ),
    );

    const result = await listVisiblePersonalSchedule(createTestClient());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unauthenticated");
    }
  });

  it("classifies a 500 response as failure (never empty)", async () => {
    server.use(
      http.get(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json(
          { message: "internal error", details: "", hint: "", code: "XX000" },
          { status: 500 },
        ),
      ),
    );

    const result = await listVisiblePersonalSchedule(createTestClient());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
    }
  });
});
