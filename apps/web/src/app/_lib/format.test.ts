import { describe, expect, it } from "vitest";
import {\n  formatTokyoCalendarDateRangeJa,\n  formatTokyoDateTimeJa,\n  occurrenceTimeRangeLabel,\n} from "./format";

describe("occurrenceTimeRangeLabel", () => {
  it("shows a plain time range for a same-day occurrence", () => {
    expect(
      occurrenceTimeRangeLabel(
        "2026-09-10T02:00:00.000Z" as never, // 11:00 JST
        "2026-09-10T07:00:00.000Z" as never, // 16:00 JST
      ),
    ).toBe("11:00〜16:00");
  });

  it("shows the 終了時刻未定 label when endsAt is unset (AGENTS.md「公演日程」: nullable end time is a valid state)", () => {
    expect(
      occurrenceTimeRangeLabel("2026-09-10T02:00:00.000Z" as never, null),
    ).toBe("11:00〜（終了時刻未定）");
  });

  it("appends （翌日） when the end time falls exactly one Tokyo calendar day after the start", () => {
    expect(
      occurrenceTimeRangeLabel(
        "2026-09-10T14:00:00.000Z" as never, // 23:00 JST on 9/10
        "2026-09-10T16:00:00.000Z" as never, // 01:00 JST on 9/11
      ),
    ).toBe("23:00〜01:00（翌日）");
  });

  it("shows the actual end date instead of （翌日） when the end is 2+ Tokyo calendar days after the start (codex review 指摘: starts_at <= ends_at has no 24h cap - AGENTS.md「開場 / 開演 / 終演」)", () => {
    const label = occurrenceTimeRangeLabel(
      "2026-09-10T14:00:00.000Z" as never, // 23:00 JST on 9/10
      "2026-09-12T02:00:00.000Z" as never, // 11:00 JST on 9/12 (2 days later)
    );
    expect(label).toContain("23:00〜");
    expect(label).toContain("9月12日");
    expect(label).toContain("11:00");
    expect(label).not.toContain("翌日");
  });
});


describe("Tokyo date formatting", () => {
  it("formats a single-day and multi-day date range without raw ISO dates", () => {
    expect(
      formatTokyoCalendarDateRangeJa("2026-03-05" as never, "2026-03-05" as never),
    ).toBe("3月5日(木)");
    expect(
      formatTokyoCalendarDateRangeJa("2026-03-05" as never, "2026-03-06" as never),
    ).toBe("3月5日(木) 〜 3月6日(金)");
  });

  it("formats an instant using Asia/Tokyo date and time", () => {
    expect(formatTokyoDateTimeJa("2026-03-10T00:00:00.000Z" as never)).toBe(
      "3月10日(火) 09:00",
    );
  });
});
