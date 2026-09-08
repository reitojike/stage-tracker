import { describe, expect, it } from "vitest";
import {
  mapPersonalScheduleEntryRow,
  type PersonalScheduleEntryRow,
} from "./scheduleEntryRow";

function baseRow(
  overrides: Partial<PersonalScheduleEntryRow> = {},
): PersonalScheduleEntryRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    owner_id: "22222222-2222-4222-8222-222222222222",
    memo: null,
    is_all_day: false,
    starts_on: null,
    ends_on: null,
    starts_at: "2026-03-05T10:00:00Z",
    ends_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    title: "有給",
    blocking: true,
    ...overrides,
  };
}

describe("mapPersonalScheduleEntryRow", () => {
  it("maps a time-bounded row to the time-bounded temporal shape", () => {
    const result = mapPersonalScheduleEntryRow(baseRow());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.temporal).toEqual({
        kind: "time-bounded",
        startsAt: "2026-03-05T10:00:00.000Z",
        endsAt: null,
      });
    }
  });

  it("maps an all-day row to the all-day temporal shape", () => {
    const result = mapPersonalScheduleEntryRow(
      baseRow({
        is_all_day: true,
        starts_on: "2026-03-05",
        ends_on: "2026-03-06",
        starts_at: null,
        ends_at: null,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.temporal).toEqual({
        kind: "all-day",
        startsOn: "2026-03-05",
        endsOn: "2026-03-06",
      });
    }
  });

  it("returns an error (never throws) when is_all_day=true but starts_on/ends_on are missing", () => {
    const result = mapPersonalScheduleEntryRow(
      baseRow({
        is_all_day: true,
        starts_on: null,
        ends_on: null,
        starts_at: null,
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("returns an error (never throws) when is_all_day=false but starts_at is missing", () => {
    const result = mapPersonalScheduleEntryRow(
      baseRow({ is_all_day: false, starts_at: null }),
    );
    expect(result.ok).toBe(false);
  });

  it("preserves the independent blocking flag regardless of temporal shape", () => {
    const result = mapPersonalScheduleEntryRow(baseRow({ blocking: false }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.blocking).toBe(false);
    }
  });
});
