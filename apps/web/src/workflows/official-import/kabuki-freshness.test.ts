import { describe, expect, it } from "vitest";
import { isKabukiFreshnessRefusal } from "./kabuki-freshness";

const MARKER = "stage_tracker.kabuki_freshness_refused.v1";

describe("isKabukiFreshnessRefusal", () => {
  it("recognizes only the exact reserved code and details", () => {
    expect(
      isKabukiFreshnessRefusal({
        code: "40001",
        details: MARKER,
        message: "anything",
        hint: null,
      }),
    ).toBe(true);
  });

  it.each([
    ["an ordinary serialization conflict", { code: "40001", details: null }],
    ["an unknown detail", { code: "40001", details: "other.detail" }],
    ["a marker suffix", { code: "40001", details: `${MARKER}.extra` }],
    ["a marker prefix", { code: "40001", details: `x${MARKER}` }],
    ["a case-folded marker", { code: "40001", details: MARKER.toUpperCase() }],
    ["a padded marker", { code: "40001", details: ` ${MARKER} ` }],
    ["a marker only in the message", { code: "40001", message: MARKER }],
    ["a marker under another code", { code: "40P01", details: MARKER }],
    ["a numeric code", { code: 40001, details: MARKER }],
    ["an authorization error", { code: "42501", details: MARKER }],
    ["a transport error", { code: "", details: "", message: "fetch failed" }],
    ["a thrown Error", new Error(MARKER)],
    ["null", null],
    ["a string", MARKER],
  ])("rejects %s", (_label, error) => {
    expect(isKabukiFreshnessRefusal(error)).toBe(false);
  });
});
