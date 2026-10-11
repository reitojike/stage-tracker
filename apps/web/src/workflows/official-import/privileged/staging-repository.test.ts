import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/data/database.types";
import type { TerminalFailureClue } from "../failure-clue";
import { createPrivilegedIngestionClient } from "./supabase";
vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ createPrivilegedIngestionClient: vi.fn() }));
const { createOfficialImportStagingRepository } =
  await import("./staging-repository");
const clue: TerminalFailureClue = {
  phase: "planning",
  reason: "validation",
  url: null,
};
function repositoryWithFetch(fetch: typeof globalThis.fetch) {
  vi.mocked(createPrivilegedIngestionClient).mockReturnValue(
    createClient<Database>("https://example.test", "public-test-key", {
      global: { fetch },
    }),
  );
  return createOfficialImportStagingRepository();
}
describe("terminal failure RPC compatibility", () => {
  it.each([undefined, clue])(
    "uses one authoritative request with optional clue %j",
    async (value) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        expect(new URL(String(input)).pathname).toBe(
          "/rest/v1/rpc/fail_official_import_run_attempt",
        );
        expect(JSON.parse(String(init?.body))).toEqual({
          p_run_id: "run",
          p_source_id: "source",
          p_attempt_token: "owner",
          p_failure_classification: "validation",
          ...(value === undefined
            ? {}
            : {
                p_failure_phase: "planning",
                p_failure_reason: "validation",
                p_failure_url: "",
              }),
        });
        expect(init?.signal).toBeUndefined();
        return Response.json("failed");
      });
      await expect(
        repositoryWithFetch(fetch).failRun(
          "run",
          "source",
          "owner",
          "validation",
          value,
        ),
      ).resolves.toBe("failed");
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["failed", "completed", "not_owner"])(
    "preserves transition %s",
    async (transition) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        Response.json(transition),
      );
      await expect(
        repositoryWithFetch(fetch).failRun(
          "run",
          "source",
          "owner",
          "validation",
          clue,
        ),
      ).resolves.toBe(transition);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { status: 500, code: "bad" },
    { status: 404, code: "PGRST202" },
  ])(
    "fails closed without fallback or raw provider text ($code)",
    async ({ status, code }) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        Response.json({ code, message: "RAW_RESPONSE_SENTINEL" }, { status }),
      );
      await expect(
        repositoryWithFetch(fetch).failRun(
          "run",
          "source",
          "owner",
          "validation",
          clue,
        ),
      ).rejects.toThrow("Failed to record official import run failure");
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("preserves transport failure without an added retry", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error("LOST_RESPONSE_SENTINEL");
    });
    await expect(
      repositoryWithFetch(fetch).failRun(
        "run",
        "source",
        "owner",
        "validation",
        clue,
      ),
    ).rejects.toThrow("Failed to record official import run failure");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
