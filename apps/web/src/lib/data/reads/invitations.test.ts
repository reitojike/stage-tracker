import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { userIdSchema } from "@stage-tracker/domain";
import type { Database } from "@/lib/data/database.types";
import { server } from "@/test/msw/server";
import { listMyReceivedInvitations } from "@/lib/data";

const SUPABASE_URL = "https://example-project.supabase.test";
const REST_URL = `${SUPABASE_URL}/rest/v1`;
const userId = userIdSchema.parse("11111111-1111-4111-8111-111111111111");

function createTestClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

afterEach(() => {
  server.resetHandlers();
});

/**
 * review finding 2 への回帰テスト: embed そのものが null な場合
 * （oracle どおり context unavailable として継続表示）と、embed は
 * 存在するが `mapOccurrenceRow`/`mapEventRow` の mapping に失敗する場合
 * （A10「読めない行を黙って間引かない」に従い `Result` を error にする）
 * を別ケースとして区別する（`./invitations.ts` の `mapInvitationRow`）。
 */
describe("listMyReceivedInvitations", () => {
  it("keeps the invitation row with context: null when the occurrence embed itself is null", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_invitations`, () =>
        HttpResponse.json(
          [
            {
              id: "22222222-2222-4222-8222-222222222222",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
              occurrence_id: "33333333-3333-4333-8333-333333333333",
              inviter_id: "44444444-4444-4444-8444-444444444444",
              invitee_id: userId,
              event_occurrences: null,
            },
          ],
          { status: 200, headers: { "content-range": "0-0/1" } },
        ),
      ),
    );

    const result = await listMyReceivedInvitations(createTestClient(), userId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toMatchObject({
        invitationId: "22222222-2222-4222-8222-222222222222",
        context: null,
      });
    }
  });

  it("surfaces a Result error (not a swallowed context: null) when the occurrence embed exists but fails to map", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_invitations`, () =>
        HttpResponse.json(
          [
            {
              id: "22222222-2222-4222-8222-222222222222",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
              occurrence_id: "33333333-3333-4333-8333-333333333333",
              inviter_id: "44444444-4444-4444-8444-444444444444",
              invitee_id: userId,
              event_occurrences: {
                id: "33333333-3333-4333-8333-333333333333",
                event_id: "55555555-5555-4555-8555-555555555555",
                // `starts_at` is a required, non-nullable column
                // (`../../../../../lib/data/mappers/eventRow.ts`); a
                // `null` here means schema/domain mapping fails even
                // though the embed itself resolved.
                starts_at: null,
                ends_at: null,
                doors_at: null,
                canceled_at: null,
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
                events: {
                  id: "55555555-5555-4555-8555-555555555555",
                  owner_id: "66666666-6666-4666-8666-666666666666",
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
          { status: 200, headers: { "content-range": "0-0/1" } },
        ),
      ),
    );

    const result = await listMyReceivedInvitations(createTestClient(), userId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
    }
  });

  it("pages through 1001 invitations without duplicating or omitting rows", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      occurrence_id: "33333333-3333-4333-8333-333333333333",
      inviter_id: "44444444-4444-4444-8444-444444444444",
      invitee_id: userId,
      event_occurrences: null,
    }));
    server.use(
      http.get(`${REST_URL}/occurrence_invitations`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("order")).toBe("id.asc");
        expect(url.searchParams.get("limit")).toBe("500");
        const idFilter = url.searchParams.get("id");
        const cursor = idFilter?.startsWith("gt.")
          ? idFilter.slice("gt.".length)
          : null;
        const remaining =
          cursor === null ? rows : rows.filter((row) => row.id > cursor);
        const page = remaining.slice(0, 500);
        return HttpResponse.json(page, {
          status: 200,
          headers: {
            "content-range": `0-${page.length - 1}/${remaining.length}`,
          },
        });
      }),
    );

    const result = await listMyReceivedInvitations(createTestClient(), userId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1001);
      expect(result.value.at(-1)?.invitationId).toBe(rows.at(-1)?.id);
      expect(
        new Set(result.value.map((invitation) => invitation.invitationId)).size,
      ).toBe(1001);
    }
  });
});
