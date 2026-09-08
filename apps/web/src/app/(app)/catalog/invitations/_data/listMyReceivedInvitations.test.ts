import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { listMyReceivedInvitations } from "./listMyReceivedInvitations";

const SUPABASE_URL = "https://example-project.supabase.test";
const REST_URL = `${SUPABASE_URL}/rest/v1`;
const userId = "11111111-1111-4111-8111-111111111111";

function createTestClient(): SupabaseClient {
  return createClient(SUPABASE_URL, "anon-key", {
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
 * を別ケースとして区別する（`./listMyReceivedInvitations.ts` の
 * `mapInvitationRow`）。
 */
describe("listMyReceivedInvitations", () => {
  it("keeps the invitation row with context: null when the occurrence embed itself is null", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_invitations`, () =>
        HttpResponse.json(
          [
            {
              id: "22222222-2222-4222-8222-222222222222",
              occurrence_id: "33333333-3333-4333-8333-333333333333",
              inviter_id: "44444444-4444-4444-8444-444444444444",
              invitee_id: userId,
              event_occurrences: null,
            },
          ],
          { status: 200 },
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
          { status: 200 },
        ),
      ),
    );

    const result = await listMyReceivedInvitations(createTestClient(), userId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
    }
  });
});
