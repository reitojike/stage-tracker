import { createClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/msw/server";
import type { Database } from "../database.types";
import {
  getScheduleContactRegistrationEnabled,
  listReceivedScheduleContactRequests,
  listScheduleContacts,
} from "./scheduleContact";

const REST = "https://contact-read.supabase.test/rest/v1/rpc";
const ID = "11111111-1111-4111-8111-111111111111";
const client = () =>
  createClient<Database>("https://contact-read.supabase.test", "anon-key", {
    auth: { autoRefreshToken: false, persistSession: false },
  });
const gate = (value: boolean | null | string | object | number) =>
  server.use(
    http.post(`${REST}/schedule_contact_registration_enabled`, () =>
      HttpResponse.json(value),
    ),
  );
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});

describe("schedule contact reads", () => {
  it.each([false, null, "true", {}, 1])(
    "fails closed for capability %j without listing data",
    async (value) => {
      gate(value);
      const list = vi.fn(() => HttpResponse.json([]));
      server.use(
        http.post(`${REST}/list_schedule_contacts`, list),
        http.post(`${REST}/list_received_schedule_contact_requests`, list),
      );
      expect((await listScheduleContacts(client())).ok).toBe(false);
      expect((await listReceivedScheduleContactRequests(client())).ok).toBe(
        false,
      );
      expect(list).not.toHaveBeenCalled();
    },
  );
  it("retains false as a known capability value rather than a fetch failure", async () => {
    gate(false);
    expect(await getScheduleContactRegistrationEnabled(client())).toEqual({
      ok: true,
      value: false,
    });
  });
  it("maps caller-bounded projections including a null alias and genuine empty incoming list", async () => {
    gate(true);
    server.use(
      http.post(`${REST}/list_schedule_contacts`, async ({ request }) => {
        expect(await request.json()).toEqual({});
        return HttpResponse.json([
          {
            contact_id: ID,
            counterpart_email: "b@example.test",
            own_alias: null,
            accepted_at: "2026-10-16T00:00:00+00:00",
          },
        ]);
      }),
      http.post(`${REST}/list_received_schedule_contact_requests`, () =>
        HttpResponse.json([]),
      ),
    );
    expect(await listScheduleContacts(client())).toEqual({
      ok: true,
      value: [
        {
          contactId: ID,
          counterpartEmail: "b@example.test",
          ownAlias: null,
          acceptedAt: "2026-10-16T00:00:00.000Z",
        },
      ],
    });
    expect(await listReceivedScheduleContactRequests(client())).toEqual({
      ok: true,
      value: [],
    });
  });
  it("maps only received request fields and does not expose internal sender ids", async () => {
    gate(true);
    server.use(
      http.post(`${REST}/list_received_schedule_contact_requests`, () =>
        HttpResponse.json([
          {
            request_id: ID,
            requester_email: "a@example.test",
            requested_at: "2026-10-16T00:00:00Z",
            requester_id: "private",
          },
        ]),
      ),
    );
    expect(await listReceivedScheduleContactRequests(client())).toEqual({
      ok: true,
      value: [
        {
          requestId: ID,
          requesterEmail: "a@example.test",
          requestedAt: "2026-10-16T00:00:00.000Z",
        },
      ],
    });
  });
  it.each([
    null,
    {},
    [null],
    [{ contact_id: "bad", counterpart_email: "secret@example.test" }],
  ])(
    "rejects malformed contact payload %j without turning it into empty",
    async (value) => {
      gate(true);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      server.use(
        http.post(`${REST}/list_schedule_contacts`, () =>
          HttpResponse.json(value),
        ),
      );
      expect(await listScheduleContacts(client())).toMatchObject({
        ok: false,
        error: { kind: "failure" },
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        "secret@example.test",
      );
    },
  );
  it.each([
    ["0A000", 400, "permission-denied"],
    ["42501", 403, "permission-denied"],
    ["PGRST301", 401, "unauthenticated"],
    ["XX000", 500, "failure"],
  ] as const)(
    "classifies %s without raw details",
    async (code, status, kind) => {
      gate(true);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      server.use(
        http.post(`${REST}/list_schedule_contacts`, () =>
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
      const result = await listScheduleContacts(client());
      expect(result).toMatchObject({ ok: false, error: { kind } });
      expect(JSON.stringify([result, log.mock.calls])).not.toContain(
        "secret@example.test",
      );
    },
  );
  it("returns a safe failure on network errors", async () => {
    gate(true);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    server.use(
      http.post(`${REST}/list_schedule_contacts`, () => HttpResponse.error()),
    );
    expect(await listScheduleContacts(client())).toMatchObject({
      ok: false,
      error: { kind: "failure" },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret@example.test");
  });
});
