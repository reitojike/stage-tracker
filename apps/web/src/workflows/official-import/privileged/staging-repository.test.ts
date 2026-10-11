import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/data/database.types";
import type { OfficialImportFailureObservation } from "../failure-observation";
import { createPrivilegedIngestionClient } from "./supabase";

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ createPrivilegedIngestionClient: vi.fn() }));
const { createOfficialImportStagingRepository } =
  await import("./staging-repository");

const observation: OfficialImportFailureObservation = {
  phase: "acquisition",
  reasonCode: "source_fetch",
  canonicalUrl: null,
  officialExternalId: null,
  acquiredDraftCount: null,
  validatedCandidateCount: 0,
  heldPageCount: 0,
};

function repositoryWithFetch(fetch: typeof globalThis.fetch) {
  vi.mocked(createPrivilegedIngestionClient).mockReturnValue(
    createClient<Database>("https://example.test", "public-test-key", {
      global: { fetch },
    }),
  );
  return createOfficialImportStagingRepository();
}

describe("failure observation persistence", () => {
  it.each([true, false])(
    "preserves the owned RPC result %s with an exact compact payload",
    async (result) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        expect(new URL(String(input)).pathname).toBe(
          "/rest/v1/rpc/record_owned_official_import_failure_observation",
        );
        expect(JSON.parse(String(init?.body))).toEqual({
          p_run_id: "run",
          p_source_id: "source",
          p_attempt_token: "owner",
          p_phase: "acquisition",
          p_reason_code: "source_fetch",
          p_validated_candidate_count: 0,
          p_held_page_count: 0,
        });
        expect(init?.signal).toBeDefined();
        return Response.json(result);
      });
      await expect(
        repositoryWithFetch(fetch).recordFailureObservation(
          "run",
          "source",
          "owner",
          observation,
        ),
      ).resolves.toBe(result);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { status: 500, code: "bad" },
    { status: 404, code: "PGRST202" },
  ])(
    "does not retain provider or missing-schema error text ($code)",
    async ({ status, code }) => {
      const repository = repositoryWithFetch(async () =>
        Response.json({ code, message: "RAW_RESPONSE_SENTINEL" }, { status }),
      );
      await expect(
        repository.recordFailureObservation(
          "run",
          "source",
          "owner",
          observation,
        ),
      ).rejects.toThrow("Failed to record official import failure observation");
    },
  );

  it("bounds a stalled diagnostic request without retrying it", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) reject(signal.reason);
          else
            signal?.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
        }),
    );
    await expect(
      repositoryWithFetch(fetch).recordFailureObservation(
        "run",
        "source",
        "owner",
        observation,
      ),
    ).rejects.toThrow("Failed to record official import failure observation");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
