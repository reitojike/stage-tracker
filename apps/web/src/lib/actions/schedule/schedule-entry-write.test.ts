import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import type { UserId, PersonalScheduleEntryId } from "@stage-tracker/domain";
import {
  deletePersonalScheduleEntry,
  insertPersonalScheduleEntry,
  updatePersonalScheduleEntry,
  type ScheduleEntryWriteFields,
} from "./schedule-entry-write";

const SUPABASE_URL = "https://example-project.supabase.test";
const REST_URL = `${SUPABASE_URL}/rest/v1`;

function createTestClient(): SupabaseClient {
  return createClient(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const OWNER_ID = "22222222-2222-4222-8222-222222222222" as UserId;
const ENTRY_ID =
  "11111111-1111-4111-8111-111111111111" as PersonalScheduleEntryId;

const ROW_FIXTURE = {
  id: ENTRY_ID,
  owner_id: OWNER_ID,
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

const FIELDS: ScheduleEntryWriteFields = {
  title: "旅行",
  memo: null,
  blocking: true,
  temporal: {
    kind: "all-day",
    startsOn: "2026-03-05",
    endsOn: "2026-03-06",
  } as ScheduleEntryWriteFields["temporal"],
};

afterEach(() => {
  server.resetHandlers();
});

describe("insertPersonalScheduleEntry", () => {
  it("maps the inserted row back into a PersonalScheduleEntry", async () => {
    server.use(
      http.post(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json([ROW_FIXTURE], { status: 201 }),
      ),
    );

    const entry = await insertPersonalScheduleEntry(
      createTestClient(),
      OWNER_ID,
      FIELDS,
    );

    expect(entry.title).toBe("旅行");
    expect(entry.temporal).toEqual({
      kind: "all-day",
      startsOn: "2026-03-05",
      endsOn: "2026-03-06",
    });
  });

  it("classifies a 401 as an unauthenticated ActionError, not a thrown raw error", async () => {
    server.use(
      http.post(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json(
          { message: "JWT expired", details: "", hint: "", code: "PGRST301" },
          { status: 401 },
        ),
      ),
    );

    await expect(
      insertPersonalScheduleEntry(createTestClient(), OWNER_ID, FIELDS),
    ).rejects.toMatchObject({ kind: "unauthenticated" });
  });
});

describe("updatePersonalScheduleEntry", () => {
  it("maps the updated row back into a PersonalScheduleEntry", async () => {
    server.use(
      http.patch(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json([{ ...ROW_FIXTURE, title: "旅行（更新）" }], {
          status: 200,
        }),
      ),
    );

    const entry = await updatePersonalScheduleEntry(
      createTestClient(),
      ENTRY_ID,
      FIELDS,
    );
    expect(entry.title).toBe("旅行（更新）");
  });

  /**
   * 0 行更新を、存在しない entry と所有していない entry の両方に共通する
   * `not-found` へ分類する（`postgrest-error.ts` の doc comment、
   * product-rules.md の「存在しない/非公開の empty 一体化」を write 側でも
   * 踏襲する設計）。RLS の owner-only UPDATE policy はどちらのケースでも
   * 単に 0 行を対象にマッチさせ、PostgREST はそれでも 200 + 空配列を返す。
   */
  it("classifies a 0-row update response as not-found - covers both a nonexistent id and someone else's entry", async () => {
    server.use(
      http.patch(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    await expect(
      updatePersonalScheduleEntry(createTestClient(), ENTRY_ID, FIELDS),
    ).rejects.toMatchObject({ kind: "not-found" });
  });
});

describe("deletePersonalScheduleEntry", () => {
  it("resolves without throwing when exactly one row is deleted", async () => {
    server.use(
      http.delete(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json([{ id: ENTRY_ID }], { status: 200 }),
      ),
    );

    await expect(
      deletePersonalScheduleEntry(createTestClient(), ENTRY_ID),
    ).resolves.toBeUndefined();
  });

  it("classifies a 0-row delete response (nonexistent or not owned) as not-found", async () => {
    server.use(
      http.delete(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    await expect(
      deletePersonalScheduleEntry(createTestClient(), ENTRY_ID),
    ).rejects.toMatchObject({ kind: "not-found" });
  });

  it("classifies a 403 as permission-denied", async () => {
    server.use(
      http.delete(`${REST_URL}/personal_schedule_entries`, () =>
        HttpResponse.json(
          {
            message: "insufficient_privilege",
            details: "",
            hint: "",
            code: "42501",
          },
          { status: 403 },
        ),
      ),
    );

    await expect(
      deletePersonalScheduleEntry(createTestClient(), ENTRY_ID),
    ).rejects.toMatchObject({ kind: "permission-denied" });
  });
});
