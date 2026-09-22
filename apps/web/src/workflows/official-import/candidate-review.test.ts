import { describe, expect, it } from "vitest";
import { deriveOfficialImportCandidateReviewStatus } from "./candidate-review";

describe("deriveOfficialImportCandidateReviewStatus", () => {
  it.each([
    ["ambiguous", "not_used"],
    ["matched", "ambiguous"],
    ["matched", "low_confidence"],
  ] as const)(
    "blocks deterministic=%s semantic=%s before publication",
    (deterministicMatchStatus, semanticMatchStatus) => {
      expect(
        deriveOfficialImportCandidateReviewStatus({
          deterministicMatchStatus,
          semanticMatchStatus,
        }),
      ).toBe("blocked_for_identity_review");
    },
  );

  it("keeps non-ambiguous match evidence pending", () => {
    expect(
      deriveOfficialImportCandidateReviewStatus({
        deterministicMatchStatus: "unmatched",
        semanticMatchStatus: "not_used",
      }),
    ).toBe("pending");
  });
});
