import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import {
  personalScheduleEntryIdSchema,
  scheduleShareIdSchema,
  userIdSchema,
} from "@stage-tracker/domain";
import type { Database } from "../database.types";
import {
  getOwnScheduleShareId,
  listScheduleShareRecipientEmails,
} from "./scheduleShare";

const SUPABASE_URL = "https://example-project.supabase.test";
const REST_URL = `${SUPABASE_URL}/rest/v1`;

function createTestClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const ENTRY_ID = personalScheduleEntryIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
const SHARE_ID = scheduleShareIdSchema.parse(
  "55555555-5555-4555-8555-555555555555",
);
const OTHER_SHARE_ID = scheduleShareIdSchema.parse(
  "66666666-6666-4666-8666-666666666666",
);
const CALLER_ID = userIdSchema.parse("33333333-3333-4333-8333-333333333333");
const OTHER_RECIPIENT_ID = userIdSchema.parse(
  "44444444-4444-4444-8444-444444444444",
);

afterEach(() => {
  server.resetHandlers();
});

describe("getOwnScheduleShareId", () => {
  it("returns the caller's own share id", async () => {
    server.use(
      http.get(`${REST_URL}/personal_schedule_shares`, () =>
        HttpResponse.json([{ id: SHARE_ID }], { status: 200 }),
      ),
    );

    await expect(
      getOwnScheduleShareId(createTestClient(), ENTRY_ID, CALLER_ID),
    ).resolves.toEqual({ ok: true, value: SHARE_ID });
  });

  it("bounds the lookup to both entry and caller recipient", async () => {
    let capturedUrl: URL | undefined;
    server.use(
      http.get(`${REST_URL}/personal_schedule_shares`, ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json([{ id: SHARE_ID }], { status: 200 });
      }),
    );

    await getOwnScheduleShareId(createTestClient(), ENTRY_ID, CALLER_ID);

    expect(capturedUrl?.searchParams.get("schedule_entry_id")).toBe(
      `eq.${ENTRY_ID}`,
    );
    expect(capturedUrl?.searchParams.get("shared_with_user_id")).toBe(
      `eq.${CALLER_ID}`,
    );
  });

  it("does not resolve another recipient's relation", async () => {
    server.use(
      http.get(`${REST_URL}/personal_schedule_shares`, ({ request }) => {
        const url = new URL(request.url);
        const entryFilter = url.searchParams.get("schedule_entry_id");
        const userFilter = url.searchParams.get("shared_with_user_id");
        const row = { id: OTHER_SHARE_ID, sharedWith: OTHER_RECIPIENT_ID };
        const matches =
          entryFilter === `eq.${ENTRY_ID}` &&
          userFilter === `eq.${row.sharedWith}`;
        return HttpResponse.json(matches ? [{ id: row.id }] : [], {
          status: 200,
        });
      }),
    );

    await expect(
      getOwnScheduleShareId(createTestClient(), ENTRY_ID, CALLER_ID),
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("returns a typed read failure for a malformed relation", async () => {
    server.use(
      http.get(`${REST_URL}/personal_schedule_shares`, () =>
        HttpResponse.json([{ id: "not-a-uuid" }], { status: 200 }),
      ),
    );

    const result = await getOwnScheduleShareId(
      createTestClient(),
      ENTRY_ID,
      CALLER_ID,
    );
    expect(result).toMatchObject({ ok: false, error: { kind: "failure" } });
  });
});

describe("listScheduleShareRecipientEmails", () => {
  it("maps the owner-bounded RPC projection", async () => {
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

    await expect(
      listScheduleShareRecipientEmails(createTestClient(), ENTRY_ID),
    ).resolves.toEqual({
      ok: true,
      value: [
        {
          shareId: SHARE_ID,
          recipientEmail: "friend@example.test",
          sharedAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
  });

  it("returns permission-denied for the existing owner-only RPC rejection", async () => {
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

    const result = await listScheduleShareRecipientEmails(
      createTestClient(),
      ENTRY_ID,
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "permission-denied",
        message: "この情報を見る権限がありません。",
      },
    });
  });
});
