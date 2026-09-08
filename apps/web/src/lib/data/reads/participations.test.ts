import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { userIdSchema } from "@stage-tracker/domain";
import { server } from "@/test/msw/server";
import { listMyParticipations } from "./participations";

const SUPABASE_URL = "https://example-project.supabase.test";
const REST_URL = `${SUPABASE_URL}/rest/v1`;
const userId = userIdSchema.parse("11111111-1111-4111-8111-111111111111");

function createTestClient(): SupabaseClient {
  return createClient(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

afterEach(() => {
  server.resetHandlers();
});

/**
 * `listMyParticipations` の read boundary を実際の HTTP 応答形状で検証
 * する。この read は `user_id = auth.uid()` という明示フィルタが RLS の
 * 「本人の行」条件と完全一致するため、成功+0行は常に「本当に0件」——
 * unavailable が empty へ化ける余地が無い、というこの Task の設計判断
 * （`./participations.ts` の docstring）を、実際の empty/populated/
 * unavailable/error の4パターンで裏付ける。
 */
describe("listMyParticipations", () => {
  it("classifies a 0-row success as empty (ok with an empty array)", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    const result = await listMyParticipations(createTestClient(), userId);

    expect(result).toEqual({ ok: true, value: [] });
  });

  it("maps a populated success into ParticipationWithOccurrence, joining the embedded occurrence/event", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(
          [
            {
              id: "22222222-2222-4222-8222-222222222222",
              occurrence_id: "33333333-3333-4333-8333-333333333333",
              user_id: userId,
              status: "attending",
              visibility: "private",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
              event_occurrences: {
                id: "33333333-3333-4333-8333-333333333333",
                event_id: "44444444-4444-4444-8444-444444444444",
                starts_at: "2026-03-05T10:00:00Z",
                ends_at: null,
                doors_at: null,
                canceled_at: null,
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
                events: {
                  id: "44444444-4444-4444-8444-444444444444",
                  owner_id: "55555555-5555-4555-8555-555555555555",
                  title: "テスト興行",
                  venue: null,
                  source_url: null,
                  memo: null,
                  starts_on: "2026-03-01",
                  ends_on: "2026-03-10",
                  canceled_at: null,
                  created_at: "2026-01-01T00:00:00Z",
                  updated_at: "2026-01-01T00:00:00Z",
                },
              },
            },
          ],
          { status: 200 },
        ),
      ),
    );

    const result = await listMyParticipations(createTestClient(), userId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toMatchObject({
        participation: { status: "attending" },
        occurrence: { id: "33333333-3333-4333-8333-333333333333" },
        event: { title: "テスト興行" },
      });
    }
  });

  it("classifies a permission-denied response as unavailable (never empty)", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(
          {
            message: "permission denied",
            details: "",
            hint: "",
            code: "42501",
          },
          { status: 403 },
        ),
      ),
    );

    const result = await listMyParticipations(createTestClient(), userId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("permission-denied");
    }
  });

  it("classifies a 500 response as failure (never empty)", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(
          { message: "internal error", details: "", hint: "", code: "XX000" },
          { status: 500 },
        ),
      ),
    );

    const result = await listMyParticipations(createTestClient(), userId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
    }
  });
});
