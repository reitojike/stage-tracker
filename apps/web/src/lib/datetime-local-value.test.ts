import { describe, expect, it } from "vitest";
import { instantSchema } from "@stage-tracker/domain";
import { instantToDateTimeLocalValue } from "./datetime-local-value";

describe("instantToDateTimeLocalValue", () => {
  it.each([
    ["2026-05-10T09:30:00Z", "2026-05-10T18:30"],
    ["2026-03-10T15:04:59.999Z", "2026-03-11T00:04"],
    ["2026-12-31T15:00:00Z", "2027-01-01T00:00"],
  ])("formats %s as %s in Tokyo with seconds omitted", (instant, expected) => {
    expect(instantToDateTimeLocalValue(instantSchema.parse(instant))).toBe(
      expected,
    );
  });
});
