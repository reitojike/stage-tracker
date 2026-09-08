import { describe, expect, it } from "vitest";
import { tokyoCalendarDateSchema } from "@stage-tracker/domain";
import {
  addMonths,
  buildMonthGridDays,
  dayOfWeek,
  firstDayOfMonth,
  formatMonthParam,
  lastDayOfMonth,
  parseDateParam,
  parseMonthParam,
  tokyoYearMonthOf,
} from "./calendar-grid";

describe("parseMonthParam", () => {
  it("parses a valid YYYY-MM value", () => {
    expect(parseMonthParam("2026-03", { year: 2026, month: 1 })).toEqual({
      year: 2026,
      month: 3,
    });
  });

  it("falls back on a missing value", () => {
    expect(parseMonthParam(undefined, { year: 2026, month: 1 })).toEqual({
      year: 2026,
      month: 1,
    });
  });

  it("falls back on a malformed value (never throws)", () => {
    expect(parseMonthParam("not-a-month", { year: 2026, month: 1 })).toEqual({
      year: 2026,
      month: 1,
    });
  });

  it("falls back on an out-of-range month", () => {
    expect(parseMonthParam("2026-13", { year: 2026, month: 1 })).toEqual({
      year: 2026,
      month: 1,
    });
  });
});

describe("parseDateParam", () => {
  it("parses a valid date", () => {
    expect(parseDateParam("2026-03-05")).toBe("2026-03-05");
  });

  it("returns null for a missing/malformed value", () => {
    expect(parseDateParam(undefined)).toBeNull();
    expect(parseDateParam("2026-02-30")).toBeNull();
  });
});

describe("firstDayOfMonth / lastDayOfMonth / addMonths", () => {
  it("computes the first and last day of a month", () => {
    expect(firstDayOfMonth({ year: 2026, month: 3 })).toBe("2026-03-01");
    expect(lastDayOfMonth({ year: 2026, month: 3 })).toBe("2026-03-31");
  });

  it("handles February in a leap year", () => {
    expect(lastDayOfMonth({ year: 2028, month: 2 })).toBe("2028-02-29");
  });

  it("rolls December -> January across a year boundary", () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({
      year: 2027,
      month: 1,
    });
  });

  it("rolls January -> December when going backwards across a year boundary", () => {
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
    });
  });
});

describe("tokyoYearMonthOf", () => {
  it("extracts the year/month from a TokyoCalendarDate", () => {
    expect(
      tokyoYearMonthOf(tokyoCalendarDateSchema.parse("2026-03-05")),
    ).toEqual({
      year: 2026,
      month: 3,
    });
  });
});

describe("formatMonthParam", () => {
  it("zero-pads the month", () => {
    expect(formatMonthParam({ year: 2026, month: 3 })).toBe("2026-03");
  });
});

describe("buildMonthGridDays", () => {
  it("returns a multiple of 7 days that fully covers the month", () => {
    const days = buildMonthGridDays({ year: 2026, month: 3 });
    expect(days.length % 7).toBe(0);
    expect(days).toContain("2026-03-01");
    expect(days).toContain("2026-03-31");
  });

  it("starts on a Sunday and ends on a Saturday", () => {
    const days = buildMonthGridDays({ year: 2026, month: 3 });
    expect(dayOfWeek(days[0]!)).toBe(0);
    expect(dayOfWeek(days[days.length - 1]!)).toBe(6);
  });

  it("includes leading/trailing days from adjacent months when the month doesn't start/end on a week boundary", () => {
    // 2026-03-01 is a Sunday, so this month's grid should have no leading
    // days from February and 4 trailing days from April to fill the last
    // week (31 days = 4 weeks and 3 days after a Sunday-aligned start).
    const days = buildMonthGridDays({ year: 2026, month: 3 });
    expect(days[0]).toBe("2026-03-01");
    expect(days[days.length - 1]).toBe("2026-04-04");
  });
});
