import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/data/database.types";

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ createPrivilegedIngestionClient: vi.fn() }));

const { createOfficialImportApplyRepository } =
  await import("./apply-repository");
const candidateId = "00000000-0000-4000-8000-000000000101";
const attemptToken = "a".repeat(64);

function harness(response: () => Response) {
  const calls: { path: string; body: unknown }[] = [];
  const client = createClient<Database>(
    "https://example.test",
    "public-test-key",
    {
      global: {
        fetch: async (input, init) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
          );
          const body: unknown = JSON.parse(String(init?.body));
          calls.push({
            path: url.pathname,
            body,
          });
          return response();
        },
      },
    },
  );
  return { repository: createOfficialImportApplyRepository(client), calls };
}

describe("official import candidate claim", () => {
  it("keeps claim 40001 retryable without reading an unowned candidate", async () => {
    const { repository, calls } = harness(() =>
      Response.json(
        { code: "40001", message: "untrusted database detail" },
        { status: 400 },
      ),
    );
    await expect(
      repository.prepareCandidate(candidateId, attemptToken),
    ).rejects.toThrow("Failed to claim official import candidate apply");
    expect(calls).toEqual([
      {
        path: "/rest/v1/rpc/claim_official_import_candidate_apply",
        body: {
          p_candidate_id: candidateId,
          p_attempt_token: attemptToken,
          p_lease_seconds: 300,
        },
      },
    ]);
  });

  it.each(["busy", "applied", "not_approved"] as const)(
    "preserves the existing %s claim outcome",
    async (status) => {
      const { repository, calls } = harness(() => Response.json(status));
      await expect(
        repository.prepareCandidate(candidateId, attemptToken),
      ).resolves.toEqual({ status });
      expect(calls).toHaveLength(1);
    },
  );

  it("keeps other claim errors retryable without exposing database detail", async () => {
    const { repository, calls } = harness(() =>
      Response.json(
        { code: "PGRST000", message: "untrusted database detail" },
        { status: 400 },
      ),
    );
    await expect(
      repository.prepareCandidate(candidateId, attemptToken),
    ).rejects.toThrow("Failed to claim official import candidate apply");
    expect(calls).toHaveLength(1);
  });
});
