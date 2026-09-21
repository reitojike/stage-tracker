import { describe, expect, it } from "vitest";
import { instantSchema } from "@stage-tracker/domain";
import { occurrenceTimeRangeLabel } from "./format";

describe("occurrenceTimeRangeLabel", () => {
  it("shows a plain time range for a same-day occurrence", () => {
    expect(
      occurrenceTimeRangeLabel(
        instantSchema.parse("2026-09-10T02:00:00.000Z"), // 11:00 JST
        instantSchema.parse("2026-09-10T07:00:00.000Z"), // 16:00 JST
      ),
    ).toBe("11:00〜16:00");
  });

  it("shows the 終了時刻未定 label when endsAt is unset (an unset end time is valid)", () => {
    expect(
      occurrenceTimeRangeLabel(
        instantSchema.parse("2026-09-10T02:00:00.000Z"),
        null,
      ),
    ).toBe("11:00〜（終了時刻未定）");
  });

  it("appends （翌日） when the end time falls exactly one Tokyo calendar day after the start", () => {
    expect(
      occurrenceTimeRangeLabel(
        instantSchema.parse("2026-09-10T14:00:00.000Z"), // 23:00 JST on 9/10
        instantSchema.parse("2026-09-10T16:00:00.000Z"), // 01:00 JST on 9/11
      ),
    ).toBe("23:00〜01:00（翌日）");
  });

  it("shows the actual end date instead of （翌日） when the end is 2+ Tokyo calendar days after the start (starts_at <= ends_at has no 24h cap)", () => {
    const label = occurrenceTimeRangeLabel(
      instantSchema.parse("2026-09-10T14:00:00.000Z"), // 23:00 JST on 9/10
      instantSchema.parse("2026-09-12T02:00:00.000Z"), // 11:00 JST on 9/12 (2 days later)
    );
    expect(label).toContain("23:00〜");
    expect(label).toContain("9月12日");
    expect(label).toContain("11:00");
    expect(label).not.toContain("翌日");
  });
});
