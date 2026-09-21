import { describe, expect, it } from "vitest";
import { instantSchema, tokyoCalendarDateSchema } from "@stage-tracker/domain";
import {
  dayOfWeek,
  formatTokyoCalendarDateJa,
  formatTokyoCalendarDateRangeJa,
  formatTokyoCalendarDateWithYearJa,
  formatTokyoDateTimeJa,
  formatTokyoTime,
  weekdayLabelJa,
} from "./tokyo-format";

describe("Tokyo shared formatting", () => {
  it("formats Tokyo wall-clock time as HH:MM", () => {
    expect(
      formatTokyoTime(instantSchema.parse("2026-03-10T00:05:00.000Z")),
    ).toBe("09:05");
  });

  it("formats a Tokyo calendar date and its weekday", () => {
    const date = tokyoCalendarDateSchema.parse("2026-03-05");
    expect(dayOfWeek(date)).toBe(4);
    expect(weekdayLabelJa(date)).toBe("木");
    expect(formatTokyoCalendarDateJa(date)).toBe("3月5日(木)");
  });

  it("formats a Tokyo calendar date with year", () => {
    expect(
      formatTokyoCalendarDateWithYearJa(
        tokyoCalendarDateSchema.parse("2026-03-05"),
      ),
    ).toBe("2026年3月5日(木)");
  });

  it("formats same-day and multi-day date ranges", () => {
    const startsOn = tokyoCalendarDateSchema.parse("2026-03-05");
    expect(formatTokyoCalendarDateRangeJa(startsOn, startsOn)).toBe(
      "3月5日(木)",
    );
    expect(
      formatTokyoCalendarDateRangeJa(
        startsOn,
        tokyoCalendarDateSchema.parse("2026-03-06"),
      ),
    ).toBe("3月5日(木) 〜 3月6日(金)");
  });

  it("formats a Tokyo date and time from one instant", () => {
    expect(
      formatTokyoDateTimeJa(instantSchema.parse("2026-03-10T00:00:00.000Z")),
    ).toBe("3月10日(火) 09:00");
  });
});
