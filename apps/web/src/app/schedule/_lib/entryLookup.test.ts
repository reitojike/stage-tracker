import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import type { PersonalScheduleEntryId } from "@stage-tracker/domain";
import { findVisibleScheduleEntry } from "./entryLookup";

const SUPABASE_URL = "https://example-project.supabase.test";
const REST_URL = `${SUPABASE_URL}/rest/v1`;

function createTestClient(): SupabaseClient {
  return createClient(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const VISIBLE_ID =
  "11111111-1111-4111-8111-111111111111" as PersonalScheduleEntryId;
const OTHER_ID =
  "99999999-9999-4999-8999-999999999999" as PersonalScheduleEntryId;

const VISIBLE_ROW = {
  id: VISIBLE_ID,
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
};

afterEach(() => {
  server.resetHandlers();
});

describe("findVisibleScheduleEntry", () => {
  it("returns the entry when it is present in the visible list", async () => {
    server.use(
      http.get(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json([VISIBLE_ROW], { status: 200 }),
      ),
    );

    const result = await findVisibleScheduleEntry(
      createTestClient(),
      VISIBLE_ID,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value?.id).toBe(VISIBLE_ID);
    }
  });

  /**
   * 存在しない entryId と、存在するが自分に見えない（非公開）entryId は
   * どちらもこの一覧に現れず、同一の `ok: true, value: null` に畳み込まれる
   * - `/schedule/[entryId]` はこれを StatePanel の `empty` として表示する
   * （oracle-routes-ui.md §2 の意図的な一体化）。
   */
  it("returns null (not an error) when the requested id is not in the visible list", async () => {
    server.use(
      http.get(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json([VISIBLE_ROW], { status: 200 }),
      ),
    );

    const result = await findVisibleScheduleEntry(createTestClient(), OTHER_ID);
    expect(result).toEqual({ ok: true, value: null });
  });

  it("propagates a read failure as-is (never collapses into null/empty)", async () => {
    server.use(
      http.get(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json(
          { message: "internal error", details: "", hint: "", code: "XX000" },
          { status: 500 },
        ),
      ),
    );

    const result = await findVisibleScheduleEntry(
      createTestClient(),
      VISIBLE_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
    }
  });
});
