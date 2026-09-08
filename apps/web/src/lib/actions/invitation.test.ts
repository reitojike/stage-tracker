import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { occurrenceIdSchema, userIdSchema } from "@stage-tracker/domain";
import { server } from "@/test/msw/server";
import { inviteToOccurrenceByEmail } from "./invitation";

const SUPABASE_URL = "https://example-project.supabase.test";
const REST_URL = `${SUPABASE_URL}/rest/v1`;

const occurrenceId = occurrenceIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
const inviterUserId = userIdSchema.parse(
  "22222222-2222-4222-8222-222222222222",
);

function createTestClient(): SupabaseClient {
  return createClient(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

afterEach(() => {
  server.resetHandlers();
});

/**
 * Common "happy path" pre-check handlers: inviter is `attending`, occurrence
 * is not canceled. Individual tests layer additional handlers with
 * `server.use(...)`.
 */
function mockEligibleInviter() {
  server.use(
    http.get(`${REST_URL}/occurrence_participations`, () =>
      HttpResponse.json([{ status: "attending" }], { status: 200 }),
    ),
    http.post(`${REST_URL}/rpc/event_occurrence_is_effectively_canceled`, () =>
      HttpResponse.json(false, { status: 200 }),
    ),
  );
}

describe("inviteToOccurrenceByEmail — opacity", () => {
  /**
   * The core of AGENTS.md's "Invitation" opacity requirement and
   * `docs/v2/decisions.md`'s "踏んではいけない地雷": the inviter must not be
   * able to tell which of the 3 invitee-state branches
   * (no row / considering / attending) the DB actually took. Since this
   * module never reads the invitee's participation at all — the RPC
   * (`invite_to_occurrence_by_email`) always returns void regardless of
   * which branch it took server-side — the only way to exercise "3
   * branches, 1 result" at this layer is to confirm that a bare successful
   * RPC response (the uniform shape the DB always produces) always maps to
   * the exact same `Result` value, with no room for a branch-dependent
   * field to have been attached.
   *
   * `toEqual` here is deliberately an *exact* structural match (not just
   * "the value is truthy"): this is what would have caught PR #372's
   * regression (Codex finding) where a `writePlan` field derived from the
   * invitee's private state was accidentally attached to the object
   * returned to the inviter.
   */
  it("always returns the exact same literal outcome, regardless of the RPC call site or invocation", async () => {
    mockEligibleInviter();
    server.use(
      http.post(`${REST_URL}/rpc/invite_to_occurrence_by_email`, () =>
        HttpResponse.json(null, { status: 200 }),
      ),
    );

    const results = await Promise.all([
      inviteToOccurrenceByEmail(createTestClient(), {
        occurrenceId,
        inviterUserId,
        inviterEmail: "inviter@example.test",
        inviteeEmail: "invitee-a@example.test",
      }),
      inviteToOccurrenceByEmail(createTestClient(), {
        occurrenceId,
        inviterUserId,
        inviterEmail: "inviter@example.test",
        inviteeEmail: "invitee-b@example.test",
      }),
      inviteToOccurrenceByEmail(createTestClient(), {
        occurrenceId,
        inviterUserId,
        inviterEmail: "inviter@example.test",
        inviteeEmail: "invitee-c@example.test",
      }),
    ]);

    for (const result of results) {
      expect(result).toEqual({ ok: true, value: "invite-sent" });
    }
  });

  it("never queries anything about the invitee (no email/user lookup performed by this module)", async () => {
    // `server.listen({ onUnhandledRequest: "error" })` (src/test/setup.ts)
    // fails this test outright if `inviteToOccurrenceByEmail` makes any
    // request beyond the ones mocked here — in particular, no generic
    // `email -> user_id` lookup (forbidden by AGENTS.md "Authenticated-user
    // targeting"), since the RPC does that resolution entirely server-side.
    mockEligibleInviter();
    server.use(
      http.post(`${REST_URL}/rpc/invite_to_occurrence_by_email`, () =>
        HttpResponse.json(null, { status: 200 }),
      ),
    );

    const result = await inviteToOccurrenceByEmail(createTestClient(), {
      occurrenceId,
      inviterUserId,
      inviterEmail: "inviter@example.test",
      inviteeEmail: "invitee@example.test",
    });

    expect(result).toEqual({ ok: true, value: "invite-sent" });
  });
});

describe("inviteToOccurrenceByEmail — inviter-side rejections", () => {
  it("rejects a self-invite (own email) before ever calling the RPC", async () => {
    let rpcCalled = false;
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json([{ status: "attending" }], { status: 200 }),
      ),
      http.post(
        `${REST_URL}/rpc/event_occurrence_is_effectively_canceled`,
        () => HttpResponse.json(false, { status: 200 }),
      ),
      http.post(`${REST_URL}/rpc/invite_to_occurrence_by_email`, () => {
        rpcCalled = true;
        return HttpResponse.json(null, { status: 200 });
      }),
    );

    const result = await inviteToOccurrenceByEmail(createTestClient(), {
      occurrenceId,
      inviterUserId,
      inviterEmail: "me@example.test",
      inviteeEmail: "me@example.test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
    }
    expect(rpcCalled).toBe(false);
  });

  it("rejects when the occurrence is effectively canceled", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json([{ status: "attending" }], { status: 200 }),
      ),
      http.post(
        `${REST_URL}/rpc/event_occurrence_is_effectively_canceled`,
        () => HttpResponse.json(true, { status: 200 }),
      ),
    );

    const result = await inviteToOccurrenceByEmail(createTestClient(), {
      occurrenceId,
      inviterUserId,
      inviterEmail: "inviter@example.test",
      inviteeEmail: "invitee@example.test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("occurrence-canceled");
    }
  });

  it("rejects when the inviter is not attending (considering does not qualify)", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json([{ status: "considering" }], { status: 200 }),
      ),
      http.post(
        `${REST_URL}/rpc/event_occurrence_is_effectively_canceled`,
        () => HttpResponse.json(false, { status: 200 }),
      ),
    );

    const result = await inviteToOccurrenceByEmail(createTestClient(), {
      occurrenceId,
      inviterUserId,
      inviterEmail: "inviter@example.test",
      inviteeEmail: "invitee@example.test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("permission-denied");
    }
  });

  it("classifies a 90002 raised by the RPC itself (post pre-check race) via SQLSTATE", async () => {
    mockEligibleInviter();
    server.use(
      http.post(`${REST_URL}/rpc/invite_to_occurrence_by_email`, () =>
        HttpResponse.json(
          {
            message: "irrelevant wording",
            details: "",
            hint: "",
            code: "90002",
          },
          { status: 400 },
        ),
      ),
    );

    const result = await inviteToOccurrenceByEmail(createTestClient(), {
      occurrenceId,
      inviterUserId,
      inviterEmail: "inviter@example.test",
      inviteeEmail: "invitee@example.test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("occurrence-canceled");
    }
  });

  it("classifies any other RPC-level rejection as a single opaque failure (no message matching)", async () => {
    mockEligibleInviter();
    server.use(
      http.post(`${REST_URL}/rpc/invite_to_occurrence_by_email`, () =>
        HttpResponse.json(
          {
            message: "cannot invite yourself",
            details: "",
            hint: "",
            code: "P0001",
          },
          { status: 400 },
        ),
      ),
    );

    const result = await inviteToOccurrenceByEmail(createTestClient(), {
      occurrenceId,
      inviterUserId,
      inviterEmail: "inviter@example.test",
      inviteeEmail: "invitee@example.test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
      expect(result.error.message).not.toMatch(/yourself/i);
    }
  });
});
