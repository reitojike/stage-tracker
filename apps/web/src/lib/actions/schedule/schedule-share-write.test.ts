import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import type {
  PersonalScheduleEntryId,
  ScheduleShareId,
} from "@stage-tracker/domain";
import {
  addScheduleShareByEmail,
  findOwnScheduleShareId,
  listScheduleShareRecipientEmails,
  removeScheduleShare,
} from "./schedule-share-write";

const SUPABASE_URL = "https://example-project.supabase.test";
const REST_URL = `${SUPABASE_URL}/rest/v1`;

function createTestClient(): SupabaseClient {
  return createClient(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const ENTRY_ID =
  "11111111-1111-4111-8111-111111111111" as PersonalScheduleEntryId;
const SHARE_ID = "55555555-5555-4555-8555-555555555555" as ScheduleShareId;

afterEach(() => {
  server.resetHandlers();
});

describe("addScheduleShareByEmail", () => {
  it("resolves without throwing on a successful RPC call", async () => {
    server.use(
      http.post(`${REST_URL}/rpc/share_schedule_entry_by_email`, () =>
        HttpResponse.json(
          {
            id: SHARE_ID,
            schedule_entry_id: ENTRY_ID,
            shared_with_user_id: "22222222-2222-4222-8222-222222222222",
            created_at: "2026-01-01T00:00:00Z",
          },
          { status: 200 },
        ),
      ),
    );

    await expect(
      addScheduleShareByEmail(
        createTestClient(),
        ENTRY_ID,
        "friend@example.test",
      ),
    ).resolves.toBeUndefined();
  });

  /**
   * 未登録 email・自己共有・owner以外からの呼び出しはすべて同一の P0001
   * として返る（`postgrest-error.ts` の doc comment）。ここでは
   * message 文字列の中身では分岐せず（A8）、code (`P0001`) だけで
   * `validation` へ分類されることを検証する - 具体的な message の文言は
   * 表示用にそのまま透過するだけであることも合わせて確認する。
   */
  it("classifies a P0001 business-rule rejection as validation, quoting the raw message for display without branching on it", async () => {
    server.use(
      http.post(`${REST_URL}/rpc/share_schedule_entry_by_email`, () =>
        HttpResponse.json(
          {
            code: "P0001",
            message: "recipient email is not a registered account",
            details: "",
            hint: "",
          },
          { status: 400 },
        ),
      ),
    );

    await expect(
      addScheduleShareByEmail(
        createTestClient(),
        ENTRY_ID,
        "nobody@example.test",
      ),
    ).rejects.toMatchObject({
      kind: "validation",
      message: expect.stringContaining(
        "recipient email is not a registered account",
      ),
    });
  });

  it("classifies a 401 as unauthenticated", async () => {
    server.use(
      http.post(`${REST_URL}/rpc/share_schedule_entry_by_email`, () =>
        HttpResponse.json(
          { message: "JWT expired", details: "", hint: "", code: "PGRST301" },
          { status: 401 },
        ),
      ),
    );

    await expect(
      addScheduleShareByEmail(
        createTestClient(),
        ENTRY_ID,
        "friend@example.test",
      ),
    ).rejects.toMatchObject({ kind: "unauthenticated" });
  });
});

describe("removeScheduleShare", () => {
  it("resolves when exactly one share row is deleted (owner-remove and self-leave share this same call)", async () => {
    server.use(
      http.delete(`${REST_URL}/personal_schedule_shares`, () =>
        HttpResponse.json([{ id: SHARE_ID }], { status: 200 }),
      ),
    );

    await expect(
      removeScheduleShare(createTestClient(), SHARE_ID),
    ).resolves.toBeUndefined();
  });

  it("classifies a 0-row delete as not-found", async () => {
    server.use(
      http.delete(`${REST_URL}/personal_schedule_shares`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    await expect(
      removeScheduleShare(createTestClient(), SHARE_ID),
    ).rejects.toMatchObject({
      kind: "not-found",
    });
  });
});

describe("findOwnScheduleShareId", () => {
  it("returns the caller's own share id when RLS returns exactly their row", async () => {
    server.use(
      http.get(`${REST_URL}/personal_schedule_shares`, () =>
        HttpResponse.json([{ id: SHARE_ID }], { status: 200 }),
      ),
    );

    await expect(
      findOwnScheduleShareId(createTestClient(), ENTRY_ID),
    ).resolves.toBe(SHARE_ID);
  });

  it("returns null when the caller has no share row for this entry (not a recipient)", async () => {
    server.use(
      http.get(`${REST_URL}/personal_schedule_shares`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    await expect(
      findOwnScheduleShareId(createTestClient(), ENTRY_ID),
    ).resolves.toBeNull();
  });
});

describe("listScheduleShareRecipientEmails", () => {
  it("maps the RPC rows into ScheduleShareRecipient values", async () => {
    server.use(
      http.post(`${REST_URL}/rpc/list_schedule_share_recipient_emails`, () =>
        HttpResponse.json(
          [
            {
              share_id: SHARE_ID,
              recipient_email: "friend@example.test",
              shared_at: "2026-01-01T00:00:00Z",
            },
          ],
          { status: 200 },
        ),
      ),
    );

    const result = await listScheduleShareRecipientEmails(
      createTestClient(),
      ENTRY_ID,
    );
    expect(result).toEqual([
      {
        shareId: SHARE_ID,
        recipientEmail: "friend@example.test",
        sharedAt: "2026-01-01T00:00:00Z",
      },
    ]);
  });

  it("classifies a P0001 (non-owner caller) rejection as permission-denied", async () => {
    server.use(
      http.post(`${REST_URL}/rpc/list_schedule_share_recipient_emails`, () =>
        HttpResponse.json(
          {
            code: "P0001",
            message: "only the schedule entry owner can view recipient emails",
            details: "",
            hint: "",
          },
          { status: 400 },
        ),
      ),
    );

    await expect(
      listScheduleShareRecipientEmails(createTestClient(), ENTRY_ID),
    ).rejects.toMatchObject({ kind: "permission-denied" });
  });
});
