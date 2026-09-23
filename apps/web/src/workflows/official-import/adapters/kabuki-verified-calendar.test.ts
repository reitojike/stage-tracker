import { describe, expect, it } from "vitest";
import { SourceParseFailure } from "../acquisition";
import { parseKabukiDetailedOccurrences } from "./kabuki-bito";

const HEADLINE =
  "第一部 午前11時～ 第二部 午後4時～ 〖休演〗日程詳細をご確認ください";
const NORMAL = [
  ["11：00", "16：00"],
  ["11：00", "-"],
  ["貸切", "16：00"],
];

function calendarHtml(
  mobile: readonly (readonly string[])[] = NORMAL,
  desktop: readonly (readonly string[])[] = mobile,
): string {
  const labels = ["第一部", "第二部"];
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const days = ["木", "金", "土"];
  const mobileRows = mobile
    .map(
      (parts, index) =>
        `<tr><th>${index + 1}<br />（${days[index]}）</th>${parts.map((part) => `<td>${part}</td>`).join("")}</tr>`,
    )
    .join("");
  const desktopDates = ["", "", "", "", "1", "2", "3"]
    .map((day) => `<td>${day}</td>`)
    .join("");
  const desktopTimes = [
    ...Array.from({ length: 4 }, () => "<td></td>"),
    ...desktop.map(
      (parts) =>
        `<td>${parts.map((part) => `<span class="span">${part}</span>`).join("")}</td>`,
    ),
  ].join("");
  return `<section id="schedule">
    <h3>日程詳細</h3>
    <h4 class="view-pc">2026年10月</h4>
    <table class="type-calendar view-pc">
      <tr class="type-day"><th rowspan="2"></th>${weekdays.map((day) => `<th>${day}</th>`).join("")}</tr>
      <tr class="type-day">${desktopDates}</tr>
      <tr><td>${labels.map((label) => `<span class="span">${label}</span>`).join("")}</td>${desktopTimes}</tr>
    </table>
    <h4 class="view-sp">2026年10月</h4>
    <table class="type-calendar view-sp">
      <tr><th></th>${labels.map((label) => `<th>${label}</th>`).join("")}</tr>
      ${mobileRows}
    </table>
  </section>`;
}

function parse(html = calendarHtml(), headline = HEADLINE) {
  return parseKabukiDetailedOccurrences(
    "2026-10-01",
    "2026-10-03",
    headline,
    html,
  );
}

describe("verified Kabuki daily calendar", () => {
  it("takes exact showtimes from agreeing PC/mobile tables and omits only closed/private parts", () => {
    expect(parse().map((item) => item.startsAt)).toEqual([
      "2026-10-01T11:00:00+09:00",
      "2026-10-01T16:00:00+09:00",
      "2026-10-02T11:00:00+09:00",
      "2026-10-03T16:00:00+09:00",
    ]);
  });

  it("uses a verified day-specific clock rather than repeating the headline time", () => {
    const changed = [
      ["11：00", "16：00"],
      ["12：30", "16：00"],
      ["11：00", "16：00"],
    ];
    expect(parse(calendarHtml(changed)).map((item) => item.startsAt)).toContain(
      "2026-10-02T12:30:00+09:00",
    );
  });

  it.each([
    [
      "conflicting views",
      calendarHtml(NORMAL, [["11：00", "17：00"], ...NORMAL.slice(1)]),
      HEADLINE,
    ],
    [
      "unmapped symbol",
      calendarHtml([["11：00", "〇"], ...NORMAL.slice(1)]),
      HEADLINE,
    ],
    ["missing mobile day", calendarHtml(NORMAL.slice(0, 2)), HEADLINE],
    [
      "wrong month heading",
      calendarHtml().replace(
        'class="view-sp">2026年10月',
        'class="view-sp">2026年11月',
      ),
      HEADLINE,
    ],
    [
      "wrong weekday",
      calendarHtml().replace("1<br />（木）", "1<br />（金）"),
      HEADLINE,
    ],
    [
      "unparsed change note",
      calendarHtml(),
      `${HEADLINE} ※第二部 午後5時～に変更`,
    ],
    ["local clock disclaimer", calendarHtml(), `${HEADLINE} ※現地時間`],
    [
      "unread schedule footnote",
      calendarHtml().replace("</section>", "<p>※3日は中止</p></section>"),
      HEADLINE,
    ],
    [
      "unwrapped schedule footnote",
      calendarHtml().replace("</section>", "※3日は中止</section>"),
      HEADLINE,
    ],
    [
      "additional calendar outside the schedule",
      `${calendarHtml()}<table class="type-calendar"><tr><td>changed</td></tr></table>`,
      HEADLINE,
    ],
  ])("fails closed for %s", (_name, html, headline) => {
    expect(() => parse(html, headline)).toThrow(SourceParseFailure);
  });
});
