import { describe, expect, it } from "vitest";
import {
  personalScheduleEntrySchema,
  instantSchema,
  tokyoCalendarDateSchema,
  userIdSchema,
} from "@stage-tracker/domain";
import type { PersonalScheduleEntry } from "@stage-tracker/domain";
import { toScheduleEntryDefaultValues } from "./scheduleEntryDefaultValues";

function entry(
  overrides: Partial<PersonalScheduleEntry> = {},
): PersonalScheduleEntry {
  return personalScheduleEntrySchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    ownerId: userIdSchema.parse("22222222-2222-4222-8222-222222222222"),
    title: "旅行",
    memo: null,
    blocking: true,
    temporal: {
      kind: "all-day",
      startsOn: tokyoCalendarDateSchema.parse("2026-03-05"),
      endsOn: tokyoCalendarDateSchema.parse("2026-03-06"),
    },
    createdAt: instantSchema.parse("2026-01-01T00:00:00.000Z"),
    updatedAt: instantSchema.parse("2026-01-01T00:00:00.000Z"),
    ...overrides,
  });
}

describe("toScheduleEntryDefaultValues", () => {
  it("maps an all-day entry's startsOn/endsOn through unchanged", () => {
    const result = toScheduleEntryDefaultValues(entry());
    expect(result).toMatchObject({
      title: "旅行",
      blocking: true,
      temporalMode: "all-day",
      allDayStartsOn: "2026-03-05",
      allDayEndsOn: "2026-03-06",
    });
  });

  it("converts a time-bounded entry's startsAt/endsAt (UTC) into Asia/Tokyo datetime-local values", () => {
    const result = toScheduleEntryDefaultValues(
      entry({
        temporal: {
          kind: "time-bounded",
          startsAt: instantSchema.parse("2026-03-10T00:00:00.000Z"),
          endsAt: instantSchema.parse("2026-03-10T09:00:00.000Z"),
        },
      }),
    );
    expect(result.temporalMode).toBe("time-bounded");
    // 00:00 UTC = 09:00 Asia/Tokyo.
    expect(result.timeBoundedStartsAt).toBe("2026-03-10T09:00");
    expect(result.timeBoundedEndsAt).toBe("2026-03-10T18:00");
  });

  it("leaves timeBoundedEndsAt undefined when endsAt is null (unknown end time)", () => {
    const result = toScheduleEntryDefaultValues(
      entry({
        temporal: {
          kind: "time-bounded",
          startsAt: instantSchema.parse("2026-03-10T00:00:00.000Z"),
          endsAt: null,
        },
      }),
    );
    expect(result.timeBoundedEndsAt).toBeUndefined();
  });

  it("maps a null memo to undefined (not the literal string 'null')", () => {
    const result = toScheduleEntryDefaultValues(entry({ memo: null }));
    expect(result.memo).toBeUndefined();
  });
});
