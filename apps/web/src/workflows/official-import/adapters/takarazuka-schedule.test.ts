import { describe, expect, it } from "vitest";
import { parseTakarazukaSchedule } from "./takarazuka-schedule";

// Synthetic DOM with observed date/time facts and role-legend structure.
// No fetched HTML or page snapshot is retained.
const blue = "#6fa8dc";
const yellow = "#ffe599";
const mark = (color = blue) => `<font color="${color}">●</font>`;
const legend = `<p class="txt">◇この公演は役替わりがあります。<a href="https://kageki.hankyu.co.jp/news/20260526_003.html" target="_self">こちらのニュース</a>をご確認ください。<br>
＜役替わり日程＞<br>${mark()}＝ルドルフ：侑輝 大弥<br>${mark(yellow)}＝ルドルフ：希波 らいと<br></p>`;
const caution = `<p class="txt3">※一部の公演ならびに席種において、取り扱いがない場合がございます。<br>※今後、都合により開演時間等の変更が生じることがございますので、ご了承ください。（公演時間は休憩を含め約3時間です）</p>`;
function page(rows: string, notes = "") {
  return `<div id="contents"><article><h1>公演日程</h1><section class="article02"><div class="table03">${notes}<div class="table01 list"><table>${rows}</table></div></div></section></article></div>`;
}
function row(date: string, time: string) {
  return `<tr><th>${date}</th><td>${time}</td></tr>`;
}
function starts(
  rows: string,
  notes = "",
  first = "2026-09-12",
  last = "2026-09-13",
) {
  return parseTakarazukaSchedule(page(rows, notes), first, last).map(
    (value) => value.startsAt,
  );
}

describe("Takarazuka schedule accepted forms", () => {
  it.each(["9/12", "9.12", "9 / 12"])(
    "accepts a complete month/day: %s",
    (date) => {
      expect(starts(row(date, "13:30"))).toEqual(["2026-09-12T13:30:00+09:00"]);
    },
  );
  it("validates skipped slots and resolves a leap day in the valid candidate year", () => {
    expect(
      starts(
        row("2/28", "休演日") + row("2/29", "13:30"),
        "",
        "2027-12-19",
        "2028-03-01",
      ),
    ).toEqual(["2028-02-29T13:30:00+09:00"]);
  });
  it.each([
    ["13:30", "13:30"],
    ["13：30", "13:30"],
    ["★13:30", "13:30"],
    ["18:30(新人公演)", "18:30"],
    ["18:30（新人公演）", "18:30"],
    ["午後1時30分", "13:30"],
    ["午前12時", "00:00"],
    ["午後12時", "12:00"],
    ["午前0時", "00:00"],
    ["午後0時", "12:00"],
  ])("accepts a complete clock: %s", (time, expected) => {
    expect(starts(row("9/12", time))).toEqual([
      `2026-09-12T${expected}:00+09:00`,
    ]);
  });
  it("keeps a bounded blank continuation, private show and closed day", () => {
    expect(
      starts(
        `<tr><th rowspan="2">9/12</th><th rowspan="2">土</th><td></td></tr><tr><td>13:30</td><td class="blue">貸切公演 ※1</td></tr>` +
          `<tr><th>9/13</th><th class="sun">日</th><td class="red">休演日</td></tr>`,
      ),
    ).toEqual(["2026-09-12T13:30:00+09:00"]);
  });
  it("accepts known caution including the generic future-change notice", () => {
    expect(starts(row("9/12", "13:30"), caution)).toHaveLength(1);
  });
  it("accepts the observed orange newcomer cell", () => {
    expect(
      starts('<tr><th>9/12</th><td class="orange">18:30(新人公演)</td></tr>'),
    ).toEqual(["2026-09-12T18:30:00+09:00"]);
  });
  it("accepts a known dated private-show footnote", () => {
    const note = `<p class="txt3">※1 9月12日（土）15:30開演は三井住友カードと宝塚友の会の共同開催となり、予定枚数に達しなかった場合にのみ、一般前売で販売いたします。</p>`;
    expect(
      starts(`<tr><th>9/12</th><td>13:30</td><td>貸切公演 ※1</td></tr>`, note),
    ).toHaveLength(1);
  });

  it.each([
    ["9/12（公演中止）", "13:30"],
    ["9/12・13", "13:30"],
    ["9/12→9/13", "13:30"],
    ["予定9/12", "13:30"],
    ["9月12日", "13:30"],
    ["9/32", ""],
    ["9/32", "休演日"],
    ["9/32", "貸切公演"],
    ["9/11", ""],
    ["9/11", "休演日"],
    ["9/11", "貸切公演"],
  ])(
    "rejects an invalid/unsupported date before skipping its slot: %s / %s",
    (date, time) => {
      expect(() => starts(row(date, time) + row("9/13", "11:00"))).toThrow(
        "Official source parse failed",
      );
    },
  );
  it.each([
    "13:30（公演中止）",
    "13:30（15:30に変更）",
    "13:30 15:30",
    "開演時刻調整中",
    "貸切公演（中止）",
    "休演日（変更予定）",
    "18:30(新人公演）",
    "18:30（新人公演)",
    "午前13時",
    "午後13時",
    "13:60",
    "24:00",
    "１３：３０",
    "<s>13:30</s>",
    "<del>13:30</del>",
    '<img alt="公演中止">13:30',
    "<span hidden>13:30</span>",
  ])("rejects an unreadable clock or status markup: %s", (time) => {
    expect(() => starts(row("9/12", time))).toThrow(
      "Official source parse failed",
    );
  });
  it.each([
    "<tr><th>9/12</th><th>中止</th><td>13:30</td></tr>",
    "<tr><th>9/12</th><th>日</th><td>13:30</td></tr>",
    "<tr><th>9/12</th></tr>",
    "<tr hidden><th>9/12</th><td>13:30</td></tr>",
    '<tr><th>9/12</th><td title="公演中止">13:30</td></tr>',
    '<tr><th>9/12</th><td style="text-decoration:line-through">13:30</td></tr>',
    '<tr><th>9/12</th><td class="red">13:30</td></tr>',
    '<tr><th>9/12</th><td class="orange">13:30</td></tr>',
    '<tr><th rowspan="0">9/12</th><td>13:30</td></tr>',
    '<tr><th rowspan="3">9/12</th><td>13:30</td></tr>',
    '<tr><th rowspan="2">9/12</th><th>土</th><td>13:30</td></tr><tr><td></td></tr>',
    '<tr><th rowspan="2">9/12</th><td>13:30</td></tr>',
    '<tr><th rowspan="2">9/12</th><td>13:30</td></tr><tr><td>15:30</td></tr><tr><td>18:30</td></tr>',
    "<tr><th>9/12</th><td>13:30</td></tr><tr><td>11:00</td></tr>",
    '<tbody><tr><th rowspan="2">9/12</th><td>13:30</td></tr></tbody><tbody><tr><td>11:00</td></tr></tbody>',
  ])("rejects unsupported or unbounded row structure: %s", (rows) => {
    expect(() => starts(rows)).toThrow("Official source parse failed");
  });
  it.each([
    "<tr><th>9/12</th><td>休演日</td><td>13:30</td></tr>",
    "<tr><th>9/12</th><td>13:30</td><td>休演日</td></tr>",
    "<tr><th>9/12</th><td>貸切公演</td><td>休演日</td></tr>",
    row("9/12", "休演日") + row("9/12", "13:30"),
    row("9/12", "13:30") + row("9/12", "13:30"),
  ])("rejects a closed-day conflict or duplicate start: %s", (rows) => {
    expect(() => starts(rows)).toThrow("Official source parse failed");
  });
  it("rejects duplicate starts across separate tables", () => {
    const html = page(row("9/12", "13:30")).replace(
      "</table>",
      `</table><table>${row("9/12", "13:30")}</table>`,
    );
    expect(() =>
      parseTakarazukaSchedule(html, "2026-09-12", "2026-09-13"),
    ).toThrow("Official source parse failed");
  });
  it.each([
    "<p>9月12日の公演は中止です。</p>",
    "<p>13:30公演は15:30に変更します。</p>",
    caution.replace("</p>", "中止</p>"),
    '<p class="txt3"><s>13:30</s></p>',
  ])(
    "rejects unknown notices without extracting a replacement time: %s",
    (note) => {
      expect(() => starts(row("9/12", "13:30"), note)).toThrow(
        "Official source parse failed",
      );
    },
  );
});

describe("page-confirmed role markers", () => {
  it("accepts both legend colors on a clock, priority clock and private show", () => {
    expect(
      starts(
        `<tr><th rowspan="2">9/12</th><td>★13:30${mark()}</td></tr><tr><td>貸切公演 ※1${mark(yellow)}</td></tr>` +
          row("9/13", `11:00${mark(yellow)}`),
        legend,
      ),
    ).toEqual(["2026-09-12T13:30:00+09:00", "2026-09-13T11:00:00+09:00"]);
  });
  it.each([
    [mark(), ""],
    [mark("#ff0000"), legend],
    ["●", legend],
    [mark() + mark(), legend],
    [mark().replace("color=", 'title="公演中止" color='), legend],
  ])("rejects an unconfirmed marker: %s", (marker, note) => {
    expect(() => starts(row("9/12", `13:30${marker}`), note)).toThrow(
      "Official source parse failed",
    );
  });
  it.each([
    legend.replace("ルドルフ", "公演中止"),
    legend.replace("＜役替わり日程＞", ""),
    legend.replace(yellow, blue),
    legend.replace("希波 らいと", "侑輝 大弥"),
    legend.replace('target="_self"', 'onclick="unknown()"'),
    legend.replace("</p>", "公演中止</p>"),
  ])("rejects an unreadable/ambiguous legend", (note) => {
    expect(() => starts(row("9/12", `13:30${mark()}`), note)).toThrow(
      "Official source parse failed",
    );
  });
  it.each([
    mark(),
    `休演日${mark()}`,
    `13${mark()}:30`,
    `13:30${mark()}（中止）`,
  ])("rejects a marker in an unsupported position: %s", (time) => {
    expect(() => starts(row("9/12", time), legend)).toThrow(
      "Official source parse failed",
    );
  });
  it("keeps observed Takarazuka and Tokyo Elisabeth date/time facts", () => {
    const takarazuka =
      `<tr><th rowspan="2">10/17</th><th rowspan="2">土</th><td>13:00${mark()}</td></tr><tr><td></td></tr>` +
      `<tr><th rowspan="2">10/18</th><th rowspan="2">日</th><td>11:00${mark()}</td></tr><tr><td>15:30${mark()}</td></tr>` +
      row("10/19", "休演日") +
      `<tr><th rowspan="2">10/20</th><td></td></tr><tr><td>15:30${mark(yellow)}</td></tr>` +
      `<tr><th rowspan="2">11/12</th><td>13:00${mark()}</td></tr><tr><td>18:00(新人公演)</td></tr>`;
    expect(
      starts(takarazuka, legend + caution, "2026-10-17", "2026-11-22"),
    ).toEqual([
      "2026-10-17T13:00:00+09:00",
      "2026-10-18T11:00:00+09:00",
      "2026-10-18T15:30:00+09:00",
      "2026-10-20T15:30:00+09:00",
      "2026-11-12T13:00:00+09:00",
      "2026-11-12T18:00:00+09:00",
    ]);
    const tokyo =
      `<tr><th rowspan="2">12/19</th><td>13:30${mark(yellow)}</td></tr><tr><td></td></tr>` +
      `<tr><th rowspan="2">12/20</th><td>貸切公演${mark(yellow)}</td></tr><tr><td>15:30${mark(yellow)}</td></tr>` +
      row("12/21", "休演日") +
      `<tr><th rowspan="2">12/29</th><td>貸切公演 ※1${mark(yellow)}</td></tr><tr><td>15:30${mark(yellow)}</td></tr>` +
      row("1/5", `13:30${mark()}`);
    expect(starts(tokyo, legend + caution, "2026-12-19", "2027-02-07")).toEqual(
      [
        "2026-12-19T13:30:00+09:00",
        "2026-12-20T15:30:00+09:00",
        "2026-12-29T15:30:00+09:00",
        "2027-01-05T13:30:00+09:00",
      ],
    );
  });
});
