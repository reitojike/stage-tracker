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

  it("keeps public performances on explicitly listed school-group days", () => {
    const occurrences = parseKabukiHeadlinePeriod(
      "2026-09-02",
      "2026-09-26",
      "昼の部 午前11時～ 夜の部 午後4時～〖休演〗9日（水）、18日（金）〖貸切〗※幕見席は営業 昼の部：25日（金） 夜の部：5日（土）、21日（祝・月） ※下記日程は学校団体様がいらっしゃいます 昼の部：2日（水）、4日（金）、16日（水）",
    );
    expect(occurrences).toHaveLength(43);
    expect(occurrences.map((item) => item.startsAt)).toContain(
      "2026-09-02T11:00:00+09:00",
    );
    expect(occurrences.map((item) => item.startsAt)).not.toContain(
      "2026-09-25T11:00:00+09:00",
    );
  });

  const octoberClosingNote =
    "終演予定時間：第一部 午後1時35分頃／第二部 午後5時05分頃／第三部 午後9時10分頃 ※終演予定時間は変更になる可能性があります";

  it("stages fully validated approximate closing times as occurrence ends", () => {
    const occurrences = parseKabukiHeadlinePeriod(
      "2026-10-02",
      "2026-10-20",
      `第一部 午前11時～ 第二部 午後2時30分～ 第三部 午後6時～〖休演〗9日（金） ※下記日程は学校団体様がいらっしゃいます 第一部：2日（金）、14日（水）、16日（金）、19日（月）、20日（火） 第二部：13日（火） ${octoberClosingNote}`,
    );
    expect(occurrences).toHaveLength(54);
    expect(occurrences[0]).toEqual({
      startsAt: "2026-10-02T11:00:00+09:00",
      endsAt: "2026-10-02T13:35:00+09:00",
    });
    expect(occurrences[1]?.endsAt).toBe("2026-10-02T17:05:00+09:00");
    expect(occurrences[2]?.endsAt).toBe("2026-10-02T21:10:00+09:00");
    expect(occurrences.map((item) => item.startsAt)).not.toContain(
      "2026-10-09T11:00:00+09:00",
    );
  });

  it.each([
    octoberClosingNote.replace("第一部 午後1時35分頃", "第一部 午後13時35分頃"),
    octoberClosingNote.replace("第一部 午後1時35分頃", "第一部 午後0時35分頃"),
    octoberClosingNote.replace("第三部 午後9時10分頃", "第三部 午後5時10分頃"),
    octoberClosingNote.replace("第二部 午後5時05分頃", "第二部 午後5時99分頃"),
    octoberClosingNote.replace("第二部", "昼の部"),
    octoberClosingNote.replace("第三部 午後9時10分頃", ""),
    `${octoberClosingNote} ※3日は中止`,
  ])("rejects inconsistent or extended closing-time notes: %s", (note) => {
    expect(() =>
      parseKabukiHeadlinePeriod(
        "2026-10-02",
        "2026-10-20",
        `第一部 午前11時～ 第二部 午後2時30分～ 第三部 午後6時～〖休演〗9日（金） ${note}`,
      ),
    ).toThrow(SourceParseFailure);
  });

  it.each([
    "昼の部：2日（木）",
    "昼の部：27日（日）",
    "午前の部：2日（水）",
    "昼の部：2日（水） 昼の部：4日（金）",
  ])("rejects inconsistent school-group dates or parts: %s", (dates) => {
    expect(() =>
      parseKabukiHeadlinePeriod(
        "2026-09-02",
        "2026-09-04",
        `昼の部 午前11時～ 夜の部 午後4時～ ※下記日程は学校団体様がいらっしゃいます ${dates}`,
      ),
    ).toThrow(SourceParseFailure);
  });

  it.each([
    "昼の部 午前11時～ 夜の部 午後4時～【休演】9日（木）",
    "昼の部 午前11時～ 夜の部 午後4時～【休演】日程詳細をご確認ください",
    "昼の部 午前11時～ 夜の部 午後4時～ ※台風のため3日の公演は中止",
    "昼の部 午前11時～ 夜の部 午後4時～ ※現地時間",
    "昼の部 午前11時～ ／ 夜の部 午後4時～ 2日は午後5時～",
    "昼の部 午前11時～ 夜の部 午後4時～【休演】2日（金・昼の部のみ休演）",
    "昼の部 午前13時～ 夜の部 午後4時～",
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
