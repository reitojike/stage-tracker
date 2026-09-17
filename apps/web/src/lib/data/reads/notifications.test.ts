import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import {
  hasUnreadNotifications,
  listMyNotifications,
  NOTIFICATION_FIRST_PAGE_SIZE,
} from "./notifications";

const SUPABASE_URL = "https://example-project.supabase.test";
const REST_URL = `${SUPABASE_URL}/rest/v1`;
const notificationIdA = "11111111-1111-4111-8111-111111111111";
const notificationIdB = "22222222-2222-4222-8222-222222222222";
const sourceIdA = "33333333-3333-4333-8333-333333333333";
const sourceIdB = "44444444-4444-4444-8444-444444444444";
const occurrenceId = "55555555-5555-4555-8555-555555555555";
const inviterId = "66666666-6666-4666-8666-666666666666";
const inviteeId = "77777777-7777-4777-8777-777777777777";

function createTestClient(): SupabaseClient {
  return createClient(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function notificationRow(
  id: string,
  sourceId: string,
  createdAt: string,
  readAt: string | null = null,
) {
  return {
    id,
    kind: "invitation_received",
    source_id: sourceId,
    created_at: createdAt,
    read_at: readAt,
  };
}

function sourceRow(id: string) {
  return {
    id,
    occurrence_id: occurrenceId,
    inviter_id: inviterId,
    invitee_id: inviteeId,
  };
}

afterEach(() => {
  server.resetHandlers();
});

describe("listMyNotifications", () => {
  it("uses an explicit bounded newest-first window with an id tie-breaker", async () => {
    let sourceRequestCount = 0;
    server.use(
      http.get(`${REST_URL}/notifications`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("limit")).toBe(
          String(NOTIFICATION_FIRST_PAGE_SIZE),
        );
        expect(url.searchParams.get("order")).toBe("created_at.desc,id.desc");
        expect(url.searchParams.has("offset")).toBe(false);
        expect(url.searchParams.has("recipient_id")).toBe(false);
        return HttpResponse.json([
          notificationRow(
            notificationIdB,
            sourceIdB,
            "2026-09-17T00:00:00.000Z",
          ),
          notificationRow(
            notificationIdA,
            sourceIdA,
            "2026-09-17T00:00:00.000Z",
            "2026-09-17T00:01:00.000Z",
          ),
        ]);
      }),
      http.get(`${REST_URL}/occurrence_invitations`, () => {
        sourceRequestCount += 1;
        return HttpResponse.json([]);
      }),
    );

    const result = await listMyNotifications(createTestClient());

    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: notificationIdB,
          kind: "invitation_received",
          sourceId: sourceIdB,
          createdAt: "2026-09-17T00:00:00.000Z",
          readAt: null,
          source: { status: "resolved" },
        },
        {
          id: notificationIdA,
          kind: "invitation_received",
          sourceId: sourceIdA,
          createdAt: "2026-09-17T00:00:00.000Z",
          readAt: "2026-09-17T00:01:00.000Z",
          source: { status: "resolved" },
        },
      ],
    });
    expect(sourceRequestCount).toBe(1);
  });

  it("batch-resolves multiple invitation sources in one query and keeps absent rows resolved", async () => {
    let sourceRequestCount = 0;
    server.use(
      http.get(`${REST_URL}/notifications`, () =>
        HttpResponse.json([
          notificationRow(
            notificationIdA,
            sourceIdA,
            "2026-09-17T00:00:00.000Z",
          ),
          notificationRow(
            notificationIdB,
            sourceIdB,
            "2026-09-16T00:00:00.000Z",
          ),
        ]),
      ),
      http.get(`${REST_URL}/occurrence_invitations`, ({ request }) => {
        sourceRequestCount += 1;
        const url = new URL(request.url);
        expect(url.searchParams.get("id")).toContain("in.(");
        return HttpResponse.json([sourceRow(sourceIdA)]);
      }),
    );

    const result = await listMyNotifications(createTestClient());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]?.source).toEqual({
        status: "active",
        invitationId: sourceIdA,
        occurrenceId,
        inviterId,
      });
      expect(result.value[1]?.source).toEqual({ status: "resolved" });
    }
    expect(sourceRequestCount).toBe(1);
  });

  it("keeps a notification query failure distinct from an empty success", async () => {
    server.use(
      http.get(`${REST_URL}/notifications`, () =>
        HttpResponse.json(
          {
            message: "database unavailable",
            details: "",
            hint: "",
            code: "XX000",
          },
          { status: 500 },
        ),
      ),
    );

    const result = await listMyNotifications(createTestClient());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.phase).toBe("notification-list");
      expect(result.error.kind).toBe("failure");
    }
  });

  it("keeps a source-resolution failure distinct from source absence", async () => {
    server.use(
      http.get(`${REST_URL}/notifications`, () =>
        HttpResponse.json([
          notificationRow(
            notificationIdA,
            sourceIdA,
            "2026-09-17T00:00:00.000Z",
          ),
        ]),
      ),
      http.get(`${REST_URL}/occurrence_invitations`, () =>
        HttpResponse.json(
          {
            message: "source database unavailable",
            details: "",
            hint: "",
            code: "XX000",
          },
          { status: 500 },
        ),
      ),
    );

    const result = await listMyNotifications(createTestClient());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.phase).toBe("source-resolution");
      expect(result.error.kind).toBe("failure");
    }
  });

  it("returns an empty success without issuing a source query", async () => {
    let sourceRequestCount = 0;
    server.use(
      http.get(`${REST_URL}/notifications`, () => HttpResponse.json([])),
      http.get(`${REST_URL}/occurrence_invitations`, () => {
        sourceRequestCount += 1;
        return HttpResponse.json([]);
      }),
    );

    const result = await listMyNotifications(createTestClient());

    expect(result).toEqual({ ok: true, value: [] });
    expect(sourceRequestCount).toBe(0);
  });
});

describe("hasUnreadNotifications", () => {
  it("returns true when one RLS-visible unread row exists and asks only for existence", async () => {
    server.use(
      http.get(`${REST_URL}/notifications`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("select")).toBe("id");
        expect(url.searchParams.get("read_at")).toBe("is.null");
        expect(url.searchParams.get("limit")).toBe("1");
        expect(url.searchParams.has("count")).toBe(false);
        return HttpResponse.json([{ id: notificationIdA }]);
      }),
    );

    await expect(hasUnreadNotifications(createTestClient())).resolves.toEqual({
      ok: true,
      value: true,
    });
  });

  it("returns false for all-read, empty, or other-recipient rows filtered by RLS", async () => {
    server.use(
      http.get(`${REST_URL}/notifications`, () => HttpResponse.json([])),
    );

    await expect(hasUnreadNotifications(createTestClient())).resolves.toEqual({
      ok: true,
      value: false,
    });
  });

  it("does not turn an unread query failure into false", async () => {
    server.use(
      http.get(`${REST_URL}/notifications`, () =>
        HttpResponse.json(
          {
            message: "unread query failed",
            details: "",
            hint: "",
            code: "XX000",
          },
          { status: 500 },
        ),
      ),
    );

    const result = await hasUnreadNotifications(createTestClient());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
    }
  });
});
