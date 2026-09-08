import { describe, expect, it } from "vitest";
import { instantSchema } from "@stage-tracker/domain";
import { instantToDateTimeLocalValue } from "./instantFormat";

describe("instantToDateTimeLocalValue", () => {
  it("returns an empty string for null", () => {
    expect(instantToDateTimeLocalValue(null)).toBe("");
  });

  it("formats an instant as an Asia/Tokyo datetime-local value", () => {
    const instant = instantSchema.parse("2026-05-10T09:30:00Z");
    // UTC 09:30 -> Asia/Tokyo 18:30
    expect(instantToDateTimeLocalValue(instant)).toBe("2026-05-10T18:30");
  });
});
