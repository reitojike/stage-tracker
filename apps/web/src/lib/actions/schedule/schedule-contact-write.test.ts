import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  personalScheduleEntryIdSchema,
  scheduleContactIdSchema,
  scheduleContactRequestIdSchema,
} from "@stage-tracker/domain";
import { server } from "@/test/msw/server";
import type { Database } from "@/lib/data/database.types";
import * as writes from "./schedule-contact-write";

const REST = "https://contact-write.supabase.test/rest/v1/rpc";
const CONTACT = scheduleContactIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
const ENTRY = personalScheduleEntryIdSchema.parse(
  "22222222-2222-4222-8222-222222222222",
);
const REQUEST = scheduleContactRequestIdSchema.parse(
  "33333333-3333-4333-8333-333333333333",
);
const client = () =>
  createClient<Database>("https://contact-write.supabase.test", "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const operations = [
  [
    "request_schedule_contact_by_email",
    (c: SupabaseClient<Database>) =>
      writes.requestScheduleContact(c, "b@example.test"),
    { p_recipient_email: "b@example.test" },
  ],
  [
    "cancel_schedule_contact_request_by_email",
    (c: SupabaseClient<Database>) =>
      writes.cancelScheduleContactRequest(c, "b@example.test"),
    { p_recipient_email: "b@example.test" },
  ],
  [
    "accept_schedule_contact_request",
    (c: SupabaseClient<Database>) =>
      writes.acceptScheduleContactRequest(c, REQUEST),
    { p_request_id: REQUEST },
  ],
  [
    "decline_schedule_contact_request",
    (c: SupabaseClient<Database>) =>
      writes.declineScheduleContactRequest(c, REQUEST),
    { p_request_id: REQUEST },
  ],
  [
    "set_schedule_contact_alias",
    (c: SupabaseClient<Database>) =>
      writes.setScheduleContactAlias(c, CONTACT, null),
    { p_contact_id: CONTACT, p_alias: "" },
  ],
  [
    "unlink_schedule_contact",
    (c: SupabaseClient<Database>) => writes.unlinkScheduleContact(c, CONTACT),
    { p_contact_id: CONTACT },
  ],
  [
    "share_schedule_entry_with_contact",
    (c: SupabaseClient<Database>) =>
      writes.shareScheduleEntryWithContact(c, ENTRY, CONTACT),
    { p_schedule_entry_id: ENTRY, p_contact_id: CONTACT },
  ],
] as const;
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});

describe("prepared schedule contact writes", () => {
  it.each(operations)(
    "%s stops before mutation while disabled",
    async (name, write) => {
      server.use(
        http.post(`${REST}/schedule_contact_registration_enabled`, () =>
          HttpResponse.json(false),
        ),
      );
      const mutation = vi.fn(() => new HttpResponse(null, { status: 204 }));
      server.use(http.post(`${REST}/${name}`, mutation));
      await expect(write(client())).rejects.toMatchObject({
        kind: "permission-denied",
      });
      expect(mutation).not.toHaveBeenCalled();
    },
  );
  it.each(operations)(
    "%s sends only its operation-specific input and discards private rows",
    async (name, write, args) => {
      server.use(
        http.post(`${REST}/schedule_contact_registration_enabled`, () =>
          HttpResponse.json(true),
        ),
        http.post(`${REST}/${name}`, async ({ request }) => {
          expect(await request.json()).toEqual(args);
          return HttpResponse.json({
            id: "private",
            recipient: "secret@example.test",
          });
        }),
      );
      await expect(write(client())).resolves.toBeUndefined();
    },
  );
  it.each([null, "true", {}])(
    "does not write for an unknown capability %j",
    async (value) => {
      server.use(
        http.post(`${REST}/schedule_contact_registration_enabled`, () =>
          HttpResponse.json(value),
        ),
      );
      await expect(
        writes.unlinkScheduleContact(client(), CONTACT),
      ).rejects.toMatchObject({ kind: "failure" });
    },
  );
  it.each([
    ["42501", 403, "permission-denied"],
    ["0A000", 400, "permission-denied"],
    ["22023", 400, "validation"],
    ["XX000", 500, "failure"],
    ["90010", 400, "failure"],
    ["PGRST301", 401, "unauthenticated"],
  ] as const)(
    "classifies %s using safe fixed copy",
    async (code, status, kind) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      server.use(
        http.post(`${REST}/schedule_contact_registration_enabled`, () =>
          HttpResponse.json(true),
        ),
        http.post(`${REST}/share_schedule_entry_with_contact`, () =>
          HttpResponse.json(
            {
              code,
              message: "secret@example.test",
              details: "private",
              hint: "private",
            },
            { status },
          ),
        ),
      );
      const result = await writes
        .shareScheduleEntryWithContact(client(), ENTRY, CONTACT)
        .catch((e: unknown) => e);
      expect(result).toMatchObject({ kind });
      expect(result).toHaveProperty(
        "message",
        expect.not.stringContaining("secret@example.test"),
      );
      expect(result).toHaveProperty(
        "message",
        expect.not.stringContaining("登録されていません"),
      );
      expect(JSON.stringify([result, log.mock.calls])).not.toContain(
        "secret@example.test",
      );
      expect(JSON.stringify(result)).not.toContain("登録されていません");
    },
  );
  it("preserves the caller-supplied generation across re-registration; never resolves by email or retries a stale id", async () => {
    const fresh = scheduleContactIdSchema.parse(
      "44444444-4444-4444-8444-444444444444",
    );
    const seen: unknown[] = [];
    server.use(
      http.post(`${REST}/schedule_contact_registration_enabled`, () =>
        HttpResponse.json(true),
      ),
      http.post(
        `${REST}/share_schedule_entry_with_contact`,
        async ({ request }) => {
          const args = await request.json();
          seen.push(args);
          return seen.length === 1
            ? HttpResponse.json(
                { code: "42501", message: "unavailable" },
                { status: 403 },
              )
            : HttpResponse.json({});
        },
      ),
    );
    await expect(
      writes.shareScheduleEntryWithContact(client(), ENTRY, CONTACT),
    ).rejects.toMatchObject({ kind: "permission-denied" });
    await writes.shareScheduleEntryWithContact(client(), ENTRY, fresh);
    expect(seen).toEqual([
      { p_schedule_entry_id: ENTRY, p_contact_id: CONTACT },
      { p_schedule_entry_id: ENTRY, p_contact_id: fresh },
    ]);
  });
  it("has one opaque acknowledgement for known, unknown, duplicate and reverse request/no-op responses", async () => {
    const results: unknown[] = [];
    server.use(
      http.post(`${REST}/schedule_contact_registration_enabled`, () =>
        HttpResponse.json(true),
      ),
      http.post(
        `${REST}/request_schedule_contact_by_email`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    for (const email of [
      "known@example.test",
      "unknown@example.test",
      "known@example.test",
      "reverse@example.test",
    ])
      results.push(await writes.requestScheduleContact(client(), email));
    expect(results).toEqual([undefined, undefined, undefined, undefined]);
  });
  it("sanitizes unexpected client exceptions before safe-action can log target details", async () => {
    server.use(
      http.post(`${REST}/schedule_contact_registration_enabled`, () =>
        HttpResponse.json(true),
      ),
    );
    const connection = client();
    const invoke = connection.rpc.bind(connection);
    vi.spyOn(connection, "rpc")
      .mockImplementationOnce(invoke)
      .mockImplementationOnce(() => {
        throw new Error("secret@example.test");
      });
    await expect(
      writes.unlinkScheduleContact(connection, CONTACT),
    ).rejects.toMatchObject({
      kind: "failure",
      message: expect.not.stringContaining("secret@example.test"),
    });
  });
});
