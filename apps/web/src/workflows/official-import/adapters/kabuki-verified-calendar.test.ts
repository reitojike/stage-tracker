import { describe, expect, it, vi } from "vitest";
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
  labels: readonly string[] = ["第一部", "第二部"],
): string {
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

  it("keeps a marked exact clock and reports its matching non-scheduling note", () => {
    const cells = [
      ["11：00", "16：00"],
      ["11：00", "16：00★"],
      ["貸切", "16：00"],
    ];
    const headline =
      "第一部 午前11時～ 第二部 午後4時～ 〖休演・貸切〗日程詳細をご確認ください ※2日（金）第二部は「着物で歌舞伎」です。皆様、お着物でご観劇ください";
    const html = calendarHtml(cells).replace(
      "</section>",
      '<p class="schedule-footer">★2日（金）第二部は「着物で歌舞伎」です。皆様、お着物でご観劇ください</p></section>',
    );
    const onAnnotation = vi.fn();
    const occurrences = parseKabukiDetailedOccurrences(
      "2026-10-01",
      "2026-10-03",
      headline,
      html,
      onAnnotation,
    );
    expect(occurrences.map((item) => item.startsAt)).toContain(
      "2026-10-02T16:00:00+09:00",
    );
    expect(onAnnotation).toHaveBeenCalledOnce();
  });

  it("holds an unmatched or schedule-changing marked note", () => {
    const cells = [
      ["11：00", "16：00"],
      ["11：00", "16：00★"],
      ["貸切", "16：00"],
    ];
    const base =
      "第一部 午前11時～ 第二部 午後4時～ 〖休演・貸切〗日程詳細をご確認ください";
    const html = calendarHtml(cells).replace(
      "</section>",
      '<p class="schedule-footer">★2日（金）第二部は「着物で歌舞伎」です。皆様、お着物でご観劇ください</p></section>',
    );
    expect(() => parse(html, base)).toThrow(SourceParseFailure);
    expect(() =>
      parse(
        calendarHtml(cells, NORMAL),
        `${base} ※2日（金）第二部は「着物で歌舞伎」です。皆様、お着物でご観劇ください`,
      ),
    ).toThrow(SourceParseFailure);
    expect(() =>
      parse(
        html,
        `${base} ※3日（土）第二部は「着物で歌舞伎」です。皆様、お着物でご観劇ください`,
      ),
    ).toThrow(SourceParseFailure);
    expect(() =>
      parse(
        calendarHtml(cells).replace(
          "</section>",
          '<p class="schedule-footer">★2日（金）第二部は午後5時開演に変更します</p></section>',
        ),
        `${base} ※2日（金）第二部は午後5時開演に変更します`,
      ),
    ).toThrow(SourceParseFailure);
    expect(() =>
      parse(
        calendarHtml(cells).replace(
          "</section>",
          '<p class="schedule-footer">★2日（金）第二部は通常より遅れて始まります</p></section>',
        ),
        `${base} ※2日（金）第二部は通常より遅れて始まります`,
      ),
    ).toThrow(SourceParseFailure);
  });

  it("maps program and circle markers to explicitly stated part clocks", () => {
    const cells = [
      ["Aプロ", "〇"],
      ["Bプロ", "〇"],
      ["-", "-"],
    ];
    expect(parse(calendarHtml(cells)).map((item) => item.startsAt)).toEqual([
      "2026-10-01T11:00:00+09:00",
      "2026-10-01T16:00:00+09:00",
      "2026-10-02T11:00:00+09:00",
      "2026-10-02T16:00:00+09:00",
    ]);
  });

  it("keeps an explicit changed clock authoritative beside symbolic cells", () => {
    const cells = [
      ["〇", "16：00"],
      ["12：30", "16：00"],
      ["-", "-"],
    ];
    expect(parse(calendarHtml(cells)).map((item) => item.startsAt)).toContain(
      "2026-10-02T12:30:00+09:00",
    );
  });

  it("uses a stated single clock for circle markers, but excludes private and closed dates", () => {
    const cells = [["〇"], ["貸切"], ["-"]];
    const html = calendarHtml(cells, cells, ["14：00"]);
    expect(
      parse(
        html,
        "午後2時～※当初の発表から公演日程を変更しております 〖休演・貸切〗日程詳細をご確認ください",
      ),
    ).toEqual([{ startsAt: "2026-10-01T14:00:00+09:00", endsAt: null }]);
  });

  it("allows only a non-date-specific informational schedule footer", () => {
    const html = calendarHtml().replace(
      "</section>",
      '<p class="schedule-footer">※貸切公演が入る場合があります</p></section>',
    );
    expect(parse(html)).toHaveLength(4);
  });

  it("checks explicit rest and part-private notes against the day table", () => {
    const cells = [
      ["A", "A"],
      ["-", "-"],
      ["貸切", "B"],
    ];
    const headline =
      "昼の部 午前11時～ 夜の部 午後4時～ 〖休演〗2日（金）〖貸切〗※幕見席は営業 昼の部：3日（土）";
    expect(
      parse(calendarHtml(cells, cells, ["昼の部", "夜の部"]), headline).map(
        (item) => item.startsAt,
      ),
    ).toEqual([
      "2026-10-01T11:00:00+09:00",
      "2026-10-01T16:00:00+09:00",
      "2026-10-03T16:00:00+09:00",
    ]);
  });

  it("rejects a table that contradicts an explicit private-day note", () => {
    const cells = [
      ["A", "A"],
      ["-", "-"],
      ["A", "B"],
    ];
    const headline =
      "昼の部 午前11時～ 夜の部 午後4時～ 〖休演〗2日（金）〖貸切〗※幕見席は営業 昼の部：3日（土）";
    expect(() =>
      parse(calendarHtml(cells, cells, ["昼の部", "夜の部"]), headline),
    ).toThrow(SourceParseFailure);
  });

  it("holds an unverified combination of otherwise known note forms", () => {
    const cells = [
      ["A", "A"],
      ["-", "-"],
      ["貸切", "B"],
    ];
    const html = calendarHtml(cells, cells);
    const headline =
      "第一部 午前11時～ 第二部 午後4時～ 〖休演〗2日（金）〖貸切〗※幕見席は営業 第一部：3日（土）";
    expect(parse(html, headline)).toHaveLength(3);
    expect(() =>
      parse(
        html,
        `${headline} ※下記日程は学校団体様がいらっしゃいます 第一部：1日（木）`,
      ),
    ).toThrow(SourceParseFailure);
  });

  it.each([
    [
      "conflicting views",
      calendarHtml(NORMAL, [["11：00", "17：00"], ...NORMAL.slice(1)]),
      HEADLINE,
    ],
    [
      "unmapped symbol",
      calendarHtml([["11：00", "◎"], ...NORMAL.slice(1)]),
      HEADLINE,
    ],
    [
      "conflicting program markers",
      calendarHtml(
        [["A", "B"], ...NORMAL.slice(1)],
        [["B", "B"], ...NORMAL.slice(1)],
      ),
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
    ["unparsed part-only note", calendarHtml(), `${HEADLINE} ※2日は第一部のみ`],
    [
      "school-group note with a date outside the performance range",
      calendarHtml(),
      `${HEADLINE} ※下記日程は学校団体様がいらっしゃいます 第一部：4日（日）`,
    ],
    [
      "unverified informational note with a trailing clock change",
      calendarHtml(
        [
          ["A", "A"],
          ["-", "-"],
          ["貸切", "B"],
        ],
        [
          ["A", "A"],
          ["-", "-"],
          ["貸切", "B"],
        ],
        ["昼の部", "夜の部"],
      ),
      "昼の部 午前11時～ 夜の部 午後4時～ 〖休演〗2日（金）〖貸切〗※幕見席は営業 昼の部：3日（土） 昼の部では、古式に則り、説明・開演（午前11時）に先立ち、説明・説明 ※夜公演は午後5時に開演",
    ],
    ["local clock disclaimer", calendarHtml(), `${HEADLINE} ※現地時間`],
    [
      "unread schedule footnote",
      calendarHtml().replace("</section>", "<p>※3日は中止</p></section>"),
      HEADLINE,
    ],
    [
      "unverified evening-part footer without a numeric clock",
      calendarHtml().replace(
        "</section>",
        '<p class="schedule-footer">※夜の部は、通常より遅く上演いたします</p></section>',
      ),
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
    [
      "unsupported caption inside an otherwise valid table",
      calendarHtml().replace(
        '<table class="type-calendar view-sp">',
        '<table class="type-calendar view-sp"><caption>補足</caption>',
      ),
      HEADLINE,
    ],
  ])("fails closed for %s", (_name, html, headline) => {
    expect(() => parse(html, headline)).toThrow(SourceParseFailure);
  });
});
