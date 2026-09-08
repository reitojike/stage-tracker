import { describe, expect, it } from "vitest";
import { readScheduleEntryFormData } from "./ScheduleEntryFields";

function formDataFrom(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    fd.set(key, value);
  }
  return fd;
}

describe("readScheduleEntryFormData", () => {
  it("reads a checked blocking checkbox as true", () => {
    const result = readScheduleEntryFormData(
      formDataFrom({ title: "旅行", blocking: "on", temporalMode: "all-day" }),
    );
    expect(result.blocking).toBe(true);
  });

  it("reads an absent blocking checkbox as false (unchecked checkboxes are omitted from FormData)", () => {
    const result = readScheduleEntryFormData(
      formDataFrom({ title: "旅行", temporalMode: "all-day" }),
    );
    expect(result.blocking).toBe(false);
  });

  it("normalizes an empty optional field to undefined, not an empty string", () => {
    const result = readScheduleEntryFormData(
      formDataFrom({ title: "旅行", temporalMode: "all-day", memo: "" }),
    );
    expect(result.memo).toBeUndefined();
  });

  it("defaults an unrecognized temporalMode to all-day rather than passing it through", () => {
    const result = readScheduleEntryFormData(
      formDataFrom({ title: "旅行", temporalMode: "bogus" }),
    );
    expect(result.temporalMode).toBe("all-day");
  });

  it("preserves time-bounded fields", () => {
    const result = readScheduleEntryFormData(
      formDataFrom({
        title: "仕事",
        temporalMode: "time-bounded",
        timeBoundedStartsAt: "2026-03-10T09:00",
        timeBoundedEndsAt: "2026-03-10T18:00",
      }),
    );
    expect(result.timeBoundedStartsAt).toBe("2026-03-10T09:00");
    expect(result.timeBoundedEndsAt).toBe("2026-03-10T18:00");
  });
});
