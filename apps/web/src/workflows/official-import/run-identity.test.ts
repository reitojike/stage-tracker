import { describe, expect, it } from "vitest";
import { deriveOfficialImportRunId } from "./run-identity";

describe("deriveOfficialImportRunId", () => {
  it("returns the same UUID for retries of the same durable step", () => {
    const first = deriveOfficialImportRunId("step_01K5P3");
    expect(deriveOfficialImportRunId("step_01K5P3")).toBe(first);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("keeps distinct durable steps on distinct staging runs", () => {
    expect(deriveOfficialImportRunId("step-a")).not.toBe(
      deriveOfficialImportRunId("step-b"),
    );
  });

  it("rejects a missing durable step identity", () => {
    expect(() => deriveOfficialImportRunId("")).toThrow(
      "Workflow step ID is required",
    );
  });
});
