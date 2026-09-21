import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import type { Database } from "@/lib/data/database.types";
import {
  decodeNotificationCursor,
  encodeNotificationCursor,
  hasUnreadNotifications,
  listMyNotifications,
  NOTIFICATION_PAGE_SIZE,
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

function createTestClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, "anon-key", {
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
  it("preserves sub-millisecond precision in notification cursors", () => {
    const cursor = {
      createdAt: "2026-09-17T00:00:00.123456Z",
      id: notificationIdA,
    };

    expect(decodeNotificationCursor(encodeNotificationCursor(cursor))).toEqual(
      cursor,
    );
  });

  it("uses an explicit bounded newest-first window with an id tie-breaker", async () => {
    let sourceRequestCount = 0;
    server.use(
      http.get(`${REST_URL}/notifications`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("limit")).toBe(
          String(NOTIFICATION_PAGE_SIZE + 1),
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
      value: {
        items: [
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
        nextCursor: null,
        hasPrevious: false,
      },
    });
    expect(sourceRequestCount).toBe(1);
  });

  it("uses a bounded composite cursor without duplicates or skips across a same-timestamp boundary", async () => {
    const createdAt = "2026-09-17T00:00:00.000Z";
    const ids = Array.from(
      { length: NOTIFICATION_PAGE_SIZE + 1 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(NOTIFICATION_PAGE_SIZE + 1 - index).padStart(12, "0")}`,
    );
    let notificationRequestCount = 0;
    server.use(
      http.get(`${REST_URL}/notifications`, ({ request }) => {
        const url = new URL(request.url);
        notificationRequestCount += 1;
        expect(url.searchParams.get("limit")).toBe(
          String(NOTIFICATION_PAGE_SIZE + 1),
        );
        expect(url.searchParams.get("order")).toBe("created_at.desc,id.desc");
        if (notificationRequestCount === 1) {
          expect(url.searchParams.has("or")).toBe(false);
          return HttpResponse.json(
            ids.map((id) => notificationRow(id, sourceIdA, createdAt)),
          );
        }

        const cursorFilter = url.searchParams.get("or") ?? "";
        expect(cursorFilter).toContain(`created_at.lt.${createdAt}`);
        const cursorId = ids[NOTIFICATION_PAGE_SIZE - 1];
        const olderId = ids[NOTIFICATION_PAGE_SIZE];
        if (cursorId === undefined || olderId === undefined) {
          throw new Error("notification cursor fixture is incomplete");
        }
        expect(cursorFilter).toContain(
          `created_at.eq.${createdAt},id.lt.${cursorId}`,
        );
        return HttpResponse.json([
          notificationRow(olderId, sourceIdA, createdAt),
        ]);
      }),
      http.get(`${REST_URL}/occurrence_invitations`, () =>
        HttpResponse.json([]),
      ),
    );

    const first = await listMyNotifications(createTestClient());
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.value.items).toHaveLength(NOTIFICATION_PAGE_SIZE);
    expect(new Set(first.value.items.map(({ id }) => id)).size).toBe(
      NOTIFICATION_PAGE_SIZE,
    );
    expect(first.value.nextCursor).toEqual({
      createdAt,
      id: ids[NOTIFICATION_PAGE_SIZE - 1],
    });

    const second = await listMyNotifications(
      createTestClient(),
      first.value.nextCursor,
    );
    expect(second).toEqual({
      ok: true,
      value: {
        items: [
          {
            id: ids[NOTIFICATION_PAGE_SIZE],
            kind: "invitation_received",
            sourceId: sourceIdA,
            createdAt,
            readAt: null,
            source: { status: "resolved" },
          },
        ],
        nextCursor: null,
        hasPrevious: false,
      },
    });
    expect(
      first.value.items.some((item) => item.id === ids[NOTIFICATION_PAGE_SIZE]),
    ).toBe(false);
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
      expect(result.value.items[0]?.source).toEqual({
        status: "active",
        invitationId: sourceIdA,
        occurrenceId,
        inviterId,
      });
      expect(result.value.items[1]?.source).toEqual({ status: "resolved" });
    }
    expect(sourceRequestCount).toBe(1);
  });

  it("reads a bounded previous window with a stable snapshot", async () => {
    const ids = Array.from(
      { length: NOTIFICATION_PAGE_SIZE + 1 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    const before = {
      createdAt: "2026-09-17T00:00:00.000Z",
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    };
    const snapshot = {
      createdAt: "2026-09-17T00:01:00.000Z",
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    };
    server.use(
      http.get(`${REST_URL}/notifications`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("order")).toBe("created_at.asc,id.asc");
        expect(url.searchParams.get("limit")).toBe(
          String(NOTIFICATION_PAGE_SIZE + 1),
        );
        expect(
          url.searchParams.getAll("or").map((value) => value.slice(1, -1)),
        ).toEqual(
          expect.arrayContaining([
            `created_at.gt.${before.createdAt},and(created_at.eq.${before.createdAt},id.gt.${before.id})`,
            `created_at.lt.${snapshot.createdAt},and(created_at.eq.${snapshot.createdAt},id.lte.${snapshot.id})`,
          ]),
        );
        return HttpResponse.json(
          ids.map((id) => notificationRow(id, sourceIdA, before.createdAt)),
        );
      }),
      http.get(`${REST_URL}/occurrence_invitations`, () =>
        HttpResponse.json([]),
      ),
    );

    const result = await listMyNotifications(createTestClient(), null, {
      before,
      snapshot,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(NOTIFICATION_PAGE_SIZE);
      expect(result.value.items[0]?.id).toBe(ids[NOTIFICATION_PAGE_SIZE - 1]);
      expect(result.value.items.at(-1)?.id).toBe(ids[0]);
      expect(result.value.nextCursor).toEqual({
        createdAt: before.createdAt,
        id: ids[0],
      });
      expect(result.value.hasPrevious).toBe(true);
    }
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

    expect(result).toEqual({
      ok: true,
      value: { items: [], nextCursor: null, hasPrevious: false },
    });
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
