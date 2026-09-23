import { describe, expect, it } from "vitest";
import {
  deriveOfficialImportApplyAttemptToken,
  deriveOfficialImportAttemptToken,
  deriveOfficialImportRunId,
  deriveOfficialImportScheduledRunId,
} from "./run-identity";

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

  it("reuses a scheduled run ID for duplicate deliveries of one Tokyo date", () => {
    const first = deriveOfficialImportScheduledRunId(
      "event.kabuki-bito.schedule",
      "2026-09-23",
    );
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(
      deriveOfficialImportScheduledRunId(
        "event.kabuki-bito.schedule",
        "2026-09-23",
      ),
    ).toBe(first);
    expect(
      deriveOfficialImportScheduledRunId(
        "event.kabuki-bito.schedule",
        "2026-09-24",
      ),
    ).not.toBe(first);
    expect(
      deriveOfficialImportScheduledRunId("event.cynhn.calendar", "2026-09-23"),
    ).not.toBe(first);
  });

  it("rejects malformed scheduled source and date identities", () => {
    expect(() =>
      deriveOfficialImportScheduledRunId("", "2026-09-23"),
    ).toThrow();
    expect(() =>
      deriveOfficialImportScheduledRunId("event.cynhn.calendar", "2026-02-30"),
    ).toThrow();
  });

  it("rejects a missing durable step identity", () => {
    expect(() => deriveOfficialImportRunId("")).toThrow(
      "Workflow step ID is required",
    );
  });

  it("derives a bounded token that is stable within and distinct across attempts", () => {
    const first = deriveOfficialImportAttemptToken("step-123", 1);
    expect(first).toBe(deriveOfficialImportAttemptToken("step-123", 1));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveOfficialImportAttemptToken("step-123", 2)).not.toBe(first);
    expect(deriveOfficialImportAttemptToken("other-step", 1)).not.toBe(first);
  });

  it("rejects invalid attempt identity inputs", () => {
    expect(() => deriveOfficialImportAttemptToken("", 1)).toThrow(
      "Workflow step ID is required",
    );
    expect(() => deriveOfficialImportAttemptToken("step-123", 0)).toThrow(
      "Workflow attempt must be a positive integer",
    );
  });

  it("keeps apply attempt tokens separate from shadow ingestion tokens", () => {
    const apply = deriveOfficialImportApplyAttemptToken("step-123", 1);
    expect(apply).toMatch(/^[0-9a-f]{64}$/);
    expect(apply).not.toBe(deriveOfficialImportAttemptToken("step-123", 1));
    expect(deriveOfficialImportApplyAttemptToken("step-123", 2)).not.toBe(
      apply,
    );
  });
});
