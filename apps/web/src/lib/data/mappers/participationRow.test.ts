import { describe, expect, it } from "vitest";
import { mapParticipationRow, type ParticipationRow } from "./participationRow";

function baseRow(overrides: Partial<ParticipationRow> = {}): ParticipationRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    occurrence_id: "22222222-2222-4222-8222-222222222222",
    user_id: "33333333-3333-4333-8333-333333333333",
    status: "attending",
    visibility: "private",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("mapParticipationRow", () => {
  it("maps a well-formed attending row", () => {
    const result = mapParticipationRow(baseRow());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("attending");
      expect(result.value.visibility).toBe("private");
    }
  });

  it("maps a well-formed considering/public row", () => {
    const result = mapParticipationRow(
      baseRow({ status: "considering", visibility: "public" }),
    );
    expect(result.ok).toBe(true);
  });

  it("returns an error (never throws) for a status outside the MVP vocabulary", () => {
    // not_attending must never be persisted (AGENTS.md "Participation") -
    // a row claiming it is a data-layer anomaly, not RLS-related.
    const result = mapParticipationRow(baseRow({ status: "not_attending" }));
    expect(result.ok).toBe(false);
  });
});
