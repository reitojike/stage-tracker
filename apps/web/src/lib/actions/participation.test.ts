import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { occurrenceIdSchema, userIdSchema } from "@stage-tracker/domain";
import { server } from "@/test/msw/server";
import { setParticipationChoice } from "./participation";

const SUPABASE_URL = "https://example-project.supabase.test";
const REST_URL = `${SUPABASE_URL}/rest/v1`;

const occurrenceId = occurrenceIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
const userId = userIdSchema.parse("22222222-2222-4222-8222-222222222222");

function createTestClient(): SupabaseClient {
  return createClient(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

afterEach(() => {
  server.resetHandlers();
});

describe("setParticipationChoice", () => {
  it("withdraw: DELETEs the caller's own row and never SELECTs first", async () => {
    server.use(
      http.delete(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(null, { status: 204 }),
      ),
    );

    const result = await setParticipationChoice(createTestClient(), {
      occurrenceId,
      userId,
      choice: "withdraw",
    });

    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("create: INSERTs when no existing row is found (never uses upsert)", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
      http.post(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(null, { status: 201 }),
      ),
    );

    const result = await setParticipationChoice(createTestClient(), {
      occurrenceId,
      userId,
      choice: "attending",
    });

    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("update: PATCHes only `status` on the existing row when one is found", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json([{ id: "row-1", status: "considering" }], {
          status: 200,
        }),
      ),
      http.patch(
        `${REST_URL}/occurrence_participations`,
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          expect(body).toEqual({ status: "attending" });
          return HttpResponse.json(null, { status: 204 });
        },
      ),
    );

    const result = await setParticipationChoice(createTestClient(), {
      occurrenceId,
      userId,
      choice: "attending",
    });

    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("is a no-op (no write) when the existing row already has the requested status", async () => {
    let writeAttempted = false;
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json([{ id: "row-1", status: "attending" }], {
          status: 200,
        }),
      ),
      http.patch(`${REST_URL}/occurrence_participations`, () => {
        writeAttempted = true;
        return HttpResponse.json(null, { status: 204 });
      }),
      http.post(`${REST_URL}/occurrence_participations`, () => {
        writeAttempted = true;
        return HttpResponse.json(null, { status: 201 });
      }),
    );

    const result = await setParticipationChoice(createTestClient(), {
      occurrenceId,
      userId,
      choice: "attending",
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(writeAttempted).toBe(false);
  });

  it("classifies a 90002 (effectively-canceled) rejection via SQLSTATE, not message matching", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
      http.post(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(
          {
            message: "some unrelated wording that must not be pattern-matched",
            details: "",
            hint: "",
            code: "90002",
          },
          { status: 400 },
        ),
      ),
    );

    const result = await setParticipationChoice(createTestClient(), {
      occurrenceId,
      userId,
      choice: "considering",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("occurrence-canceled");
    }
  });

  it("falls back to UPDATE when a concurrent INSERT races and loses (23505)", async () => {
    let selectCallCount = 0;
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () => {
        selectCallCount += 1;
        // First select (pre-insert check): no row yet. Second select
        // (post-conflict refetch): the concurrent writer's row now exists.
        if (selectCallCount === 1) {
          return HttpResponse.json([], { status: 200 });
        }
        return HttpResponse.json([{ id: "raced-row" }], { status: 200 });
      }),
      http.post(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(
          {
            message: "duplicate key value violates unique constraint",
            details: "",
            hint: "",
            code: "23505",
          },
          { status: 409 },
        ),
      ),
      http.patch(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(null, { status: 204 }),
      ),
    );

    const result = await setParticipationChoice(createTestClient(), {
      occurrenceId,
      userId,
      choice: "attending",
    });

    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("classifies an unrelated failure as the generic `failure` kind", async () => {
    server.use(
      http.delete(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(
          { message: "internal error", details: "", hint: "", code: "XX000" },
          { status: 500 },
        ),
      ),
    );

    const result = await setParticipationChoice(createTestClient(), {
      occurrenceId,
      userId,
      choice: "withdraw",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
    }
  });
});
