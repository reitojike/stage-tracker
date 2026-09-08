import { describe, expect, it } from "vitest";
import { toScheduleEntryFieldErrorMap } from "./scheduleValidationErrors";

describe("toScheduleEntryFieldErrorMap", () => {
  it("flattens next-safe-action's nested validation error shape to field -> first message", () => {
    const result = toScheduleEntryFieldErrorMap({
      title: { _errors: ["件名を入力してください。"] },
      allDayEndsOn: { _errors: ["endsOn must be on or after startsOn."] },
    });
    expect(result).toEqual({
      title: "件名を入力してください。",
      allDayEndsOn: "endsOn must be on or after startsOn.",
    });
  });

  it("returns an empty map for undefined (no validation errors)", () => {
    expect(toScheduleEntryFieldErrorMap(undefined)).toEqual({});
  });

  it("ignores unknown fields and malformed nodes without throwing", () => {
    expect(
      toScheduleEntryFieldErrorMap({
        unknownField: { _errors: ["should be ignored"] },
        title: "not an object",
        memo: { _errors: [] },
      }),
    ).toEqual({});
  });
});
