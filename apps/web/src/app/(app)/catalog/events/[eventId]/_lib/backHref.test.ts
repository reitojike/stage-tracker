import { describe, expect, it } from "vitest";
import { buildCatalogBackHref } from "./backHref";

describe("buildCatalogBackHref", () => {
  it("returns the plain /catalog path when no month/date are present", () => {
    expect(buildCatalogBackHref({})).toBe("/catalog");
  });

  it("preserves month and date query params", () => {
    expect(buildCatalogBackHref({ month: "2026-03", date: "2026-03-10" })).toBe(
      "/catalog?month=2026-03&date=2026-03-10",
    );
  });

  it("ignores an array value (multiple occurrences of the same param)", () => {
    expect(buildCatalogBackHref({ month: ["2026-03", "2026-04"] })).toBe(
      "/catalog",
    );
  });

  it("ignores an empty string value", () => {
    expect(buildCatalogBackHref({ month: "", date: "2026-03-10" })).toBe(
      "/catalog?date=2026-03-10",
    );
  });
});
