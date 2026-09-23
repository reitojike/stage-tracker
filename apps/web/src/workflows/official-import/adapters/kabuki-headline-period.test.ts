import { describe, expect, it } from "vitest";
import { SourceParseFailure } from "../acquisition";
import { parseKabukiDetailedOccurrences } from "./kabuki-bito";
import { parseKabukiHeadlinePeriod } from "./kabuki-headline-period";

describe("verified Kabuki headline period", () => {
  it("expands standard parts and excludes full rest days and part-private dates", () => {
    const occurrences = parseKabukiHeadlinePeriod(
      "2026-12-01",
      "2026-12-24",
      "昼の部 午前10時30分～ 夜の部 午後4時～【休演】9日（水）、17日（木）【貸切】昼の部：12日（土）、19日（土）、20日（日）、夜の部：18日（金）",
    );
    expect(occurrences).toHaveLength(40);
    expect(occurrences.map((item) => item.startsAt)).not.toContain(
      "2026-12-18T16:00:00+09:00",
    );
  });

  it("allows slash separators only between completely parsed parts", () => {
    const occurrences = parseKabukiHeadlinePeriod(
      "2026-10-01",
      "2026-10-02",
      "昼の部 午前11時～ ／ 夜の部 午後4時～",
    );
    expect(occurrences).toHaveLength(4);
    expect(occurrences[1]?.startsAt).toBe("2026-10-01T16:00:00+09:00");
  });

  it("supports one unlabeled daily time and a fully recognized door note", () => {
    const occurrences = parseKabukiHeadlinePeriod(
      "2026-11-03",
      "2026-11-08",
      "午後1時～ ※開場は開演の1時間前を予定",
    );
    expect(occurrences).toHaveLength(6);
    expect(occurrences[0]?.startsAt).toBe("2026-11-03T13:00:00+09:00");
  });

  it("keeps the public part of a single-day private performance", () => {
    expect(
      parseKabukiHeadlinePeriod(
        "2026-11-01",
        "2026-11-01",
        "昼の部 午前11時～ 夜の部 午後4時～【貸切】昼の部：1日（日）",
      ).map((item) => item.startsAt),
    ).toEqual(["2026-11-01T16:00:00+09:00"]);
  });

  it("honors an explicit morning-only final day", () => {
    const occurrences = parseKabukiHeadlinePeriod(
      "2026-11-04",
      "2026-11-11",
      "昼の部 午前11時30分～ 夜の部 午後4時～ ※11日（水）は、午前の部のみ1回公演",
    );
    expect(occurrences).toHaveLength(15);
    expect(occurrences.map((item) => item.startsAt)).not.toContain(
      "2026-11-11T16:00:00+09:00",
    );
  });

  it("accepts a holiday weekday annotation only when it is fully recognized", () => {
    const occurrences = parseKabukiHeadlinePeriod(
      "2026-09-20",
      "2026-09-22",
      "昼の部 午前11時～ 夜の部 午後4時～【貸切】夜の部：21日（祝・月）",
    );
    expect(occurrences).toHaveLength(5);
    expect(occurrences.map((item) => item.startsAt)).not.toContain(
      "2026-09-21T16:00:00+09:00",
    );
  });

  it.each([
    ["2026-12-21", "2026-12-21", "21日（祝・月）"],
    ["2028-01-03", "2028-01-03", "3日（祝・月）"],
  ])("rejects an unverified holiday marker on %s", (startsOn, endsOn, day) => {
    expect(() =>
      parseKabukiHeadlinePeriod(startsOn, endsOn, `午前11時～【休演】${day}`),
    ).toThrow(SourceParseFailure);
  });

  it.each([
    "昼の部 午前11時～ 夜の部 午後4時～【休演】9日（木）",
    "昼の部 午前11時～ 夜の部 午後4時～【休演】日程詳細をご確認ください",
    "昼の部 午前11時～ 夜の部 午後4時～ ※台風のため3日の公演は中止",
    "昼の部 午前11時～ 夜の部 午後4時～ ※現地時間",
    "昼の部 午前11時～ ／ 夜の部 午後4時～ 2日は午後5時～",
    "昼の部 午前11時～ 夜の部 午後4時～【休演】2日（金・昼の部のみ休演）",
  ])("fails closed for unknown or inconsistent schedule text: %s", (text) => {
    expect(() =>
      parseKabukiHeadlinePeriod("2026-10-01", "2026-10-03", text),
    ).toThrow(SourceParseFailure);
  });

  it("does not turn a table-bearing page into a standard-time period", () => {
    expect(() =>
      parseKabukiDetailedOccurrences(
        "2026-10-01",
        "2026-10-02",
        "昼の部 午前11時～",
        '<table class="type-calendar"><tr><td>varying</td></tr></table>',
      ),
    ).toThrow(SourceParseFailure);
  });
});
