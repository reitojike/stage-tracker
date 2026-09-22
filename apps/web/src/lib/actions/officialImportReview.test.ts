import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/data/database.types";
import { server } from "@/test/msw/server";
import { reviewOfficialImportCandidate } from "./officialImportReview";

const CANDIDATE_ID = "11111111-1111-4111-8111-111111111111";
const SUPABASE_URL = "https://example-project.supabase.test";
const RPC_URL = `${SUPABASE_URL}/rest/v1/rpc/review_official_import_candidate`;

function createTestClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

afterEach(() => server.resetHandlers());

describe("reviewOfficialImportCandidate", () => {
  it("sends only the candidate id and bounded decision to the narrow RPC", async () => {
    let requestBody: unknown;
    server.use(
      http.post(RPC_URL, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ review_status: "approved" });
      }),
    );

    await expect(
      reviewOfficialImportCandidate(createTestClient(), {
        candidateId: CANDIDATE_ID,
        decision: "approved",
      }),
    ).resolves.toEqual({ ok: true, value: { reviewStatus: "approved" } });
    expect(requestBody).toEqual({
      p_candidate_id: CANDIDATE_ID,
      p_review_status: "approved",
    });
  });

  it.each([
    ["42501", "permission-denied"],
    ["22023", "validation"],
    ["XX000", "failure"],
  ] as const)("classifies SQLSTATE %s as %s", async (code, kind) => {
    server.use(
      http.post(RPC_URL, () =>
        HttpResponse.json(
          {
            code,
            message: "private database detail",
            details: null,
            hint: null,
          },
          { status: 400 },
        ),
      ),
    );

    const result = await reviewOfficialImportCandidate(createTestClient(), {
      candidateId: CANDIDATE_ID,
      decision: "rejected",
    });
    expect(result).toMatchObject({ ok: false, error: { kind } });
    if (!result.ok) {
      expect(result.error.message).not.toContain("private database detail");
    }
  });
});
