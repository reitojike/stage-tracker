import { describe, expect, it } from "vitest";
import { tokyoCalendarDateSchema } from "@stage-tracker/domain";
import {
  addMonths,
  buildMonthGridDays,
  dayOfWeek,
  firstDayOfMonth,
  formatMonthParam,
  isRenderableMonth,
  lastDayOfMonth,
  parseDateParam,
  parseMonthParam,
  resolveCalendarMonthAndDate,
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

describe("resolveCalendarMonthAndDate", () => {
  const fallback = { year: 2026, month: 1 };

  it("derives the displayed month from `date` alone (no `month` given)", () => {
    expect(
      resolveCalendarMonthAndDate(undefined, "2026-05-10", fallback),
    ).toEqual({
      month: { year: 2026, month: 5 },
      selectedDate: "2026-05-10",
    });
  });

  it("lets a valid `date` win over a disagreeing `month`", () => {
    expect(
      resolveCalendarMonthAndDate("2026-01", "2026-05-10", fallback),
    ).toEqual({
      month: { year: 2026, month: 5 },
      selectedDate: "2026-05-10",
    });
  });

  it("falls back to `month` with no selected day when `date` is invalid", () => {
    expect(
      resolveCalendarMonthAndDate("2026-05", "2026-02-30", fallback),
    ).toEqual({
      month: { year: 2026, month: 5 },
      selectedDate: null,
    });
  });

  it("falls back to `fallback` with no selected day when both are missing/invalid", () => {
    expect(resolveCalendarMonthAndDate(undefined, undefined, fallback)).toEqual(
      {
        month: fallback,
        selectedDate: null,
      },
    );
    expect(
      resolveCalendarMonthAndDate("not-a-month", "not-a-date", fallback),
    ).toEqual({
      month: fallback,
      selectedDate: null,
    });
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

describe("境界年の月（PR #381 review）", () => {
  const fallback = { year: 2026, month: 1 };

  it("グリッドが表現できない月を含む date は無視して fallback する", () => {
    // 9999-12 のグリッドは 10000-01-06 まで伸びる。以前はここで
    // tokyoCalendarDateSchema が throw し、ページ全体が 500 になっていた。
    expect(
      resolveCalendarMonthAndDate(undefined, "9999-12-31", fallback),
    ).toEqual({ month: fallback, selectedDate: null });
  });

  it("同じ月を month param で渡してもカレンダーの解決では fallback する", () => {
    expect(resolveCalendarMonthAndDate("9999-12", undefined, fallback)).toEqual(
      {
        month: fallback,
        selectedDate: null,
      },
    );
  });

  // /catalog は firstDayOfMonth / lastDayOfMonth しか使わず grid を作らない。
  // grid 制約を parseMonthParam に置くと、その月の Event が参照不能になる。
  it("parseMonthParam 自体は grid 制約で有効な月を拒否しない", () => {
    expect(parseMonthParam("9999-12", fallback)).toEqual({
      year: 9999,
      month: 12,
    });
    expect(firstDayOfMonth({ year: 9999, month: 12 })).toBe("9999-12-01");
    expect(lastDayOfMonth({ year: 9999, month: 12 })).toBe("9999-12-31");
  });

  it("0-99 年を 1900+year に写さない（曜日計算を含む）", () => {
    // Date.UTC(1, 0, 1) は 1901-01-01。以前はこの写像により
    // ?date=0001-01-01 が 1900-12-30 起点のグリッドを描いていた。
    expect(isRenderableMonth({ year: 1, month: 1 })).toBe(true);

    // 0001-01-01 は月曜。したがってグリッドは前日の日曜 0000-12-31 から
    // 始まる。dayOfWeek が Date.UTC のままだと 1901 年の曜日で計算され、
    // 0000-12-30 起点になって 1 月 1 日が火曜列へずれる。
    expect(dayOfWeek("0001-01-01" as never)).toBe(1);
    expect(buildMonthGridDays({ year: 1, month: 1 })[0]).toBe("0000-12-31");
  });

  it("グリッド開始が負の年になる月は表現不能とみなす", () => {
    expect(isRenderableMonth({ year: 0, month: 1 })).toBe(false);
    expect(
      resolveCalendarMonthAndDate(undefined, "0000-01-01", fallback),
    ).toEqual({ month: fallback, selectedDate: null });
  });

  it("境界の内側は従来どおり通る", () => {
    expect(isRenderableMonth({ year: 9999, month: 11 })).toBe(true);
    expect(
      resolveCalendarMonthAndDate(undefined, "9999-11-30", fallback),
    ).toEqual({ month: { year: 9999, month: 11 }, selectedDate: "9999-11-30" });
  });
});
