import { describe, expect, it, vi } from "vitest";
import { SourceParseFailure } from "../acquisition";
import { getOfficialSource } from "../source-registry";
import { createKabukiBitoAdapter } from "./kabuki-bito";
import { parseKabukiVerifiedCalendar } from "./kabuki-verified-calendar";

// Synthetic markup containing scheduling facts only, not a saved official page.
const PARTS = ["昼の部", "夜の部"];
const WEEKDAYS = [..."日月火水木金土"];
const BASE = "昼の部 午前11時～ 夜の部 午後4時30分～";
const CLOSED_PRIVATE =
  "〖休演〗9日（月）、17日（火）〖貸切〗※幕見席は営業 昼の部：14日（土） 夜の部：22日（日）";
const END_BLOCK =
  "終演予定時間：昼の部 午後3時41分頃／夜の部 午後8時57分頃 ※終演予定時間は変更になる可能性があります";
const SCHOOL =
  "※下記日程は学校団体様がいらっしゃいます 昼の部：4日（水）、5日（木）、10日（火）、11日（水）、12日（木）、13日（金）、18日（水）、19日（木）、20日（金）、24日（火） 夜の部：11日（水）";
const HEADLINE = `${BASE} ${CLOSED_PRIVATE} ${END_BLOCK} ${SCHOOL}`;

function rows(): string[][] {
  return Array.from({ length: 25 }, (_, index) => {
    const day = index + 1;
    if (day === 9 || day === 17) return ["-", "-"];
    return [
      day === 14 ? "貸切" : day % 2 === 0 ? "B" : "A",
      day === 22 ? "貸切" : "〇",
    ];
  });
}

function calendar(mobile = rows(), desktop = mobile): string {
  const mobileRows = mobile
    .map(
      (parts, index) =>
        `<tr><th>${index + 1}<br>（${WEEKDAYS[index % 7]}）</th>${parts.map((part) => `<td>${part}</td>`).join("")}</tr>`,
    )
    .join("");
  const desktopRows = Array.from({ length: 4 }, (_, week) => {
    const days = Array.from({ length: 7 }, (_, index) => week * 7 + index + 1);
    const dateCells = days
      .map((day) => `<td>${day <= 25 ? day : ""}</td>`)
      .join("");
    const timeCells = days
      .map(
        (day) =>
          `<td>${(desktop[day - 1] ?? []).map((part) => `<span class="span">${part}</span>`).join("")}</td>`,
      )
      .join("");
    return `<tr class="type-day">${week === 0 ? "" : "<td></td>"}${dateCells}</tr><tr><td>${PARTS.map((part) => `<span class="span">${part}</span>`).join("")}</td>${timeCells}</tr>`;
  }).join("");
  return `<section id="schedule"><h3>日程詳細</h3>
    <h4 class="view-pc">2026年11月</h4><table class="type-calendar view-pc">
    <tr class="type-day"><th rowspan="2"></th>${WEEKDAYS.map((day) => `<th>${day}</th>`).join("")}</tr>${desktopRows}</table>
    <h4 class="view-sp">2026年11月</h4><table class="type-calendar view-sp">
    <tr><th></th>${PARTS.map((part) => `<th>${part}</th>`).join("")}</tr>${mobileRows}</table></section>`;
}

function parse(headline = HEADLINE, html = calendar()) {
  return parseKabukiVerifiedCalendar(
    "2026-11-01",
    "2026-11-25",
    headline,
    html,
  );
}

async function acquire(headline = HEADLINE, html = calendar()) {
  const source = getOfficialSource("event.kabuki-bito.schedule");
  if (source === null) throw new Error("source missing");
  const held = vi.fn();
  const adapter = createKabukiBitoAdapter(async (_source, url) => ({
    url,
    body:
      url === source.canonicalUrl
        ? '<li class="item"><a href="/theaters/kabukiza/play/986"><h3 class="ttl">吉例顔見世大歌舞伎</h3></a><p class="term">2026年11月1日（日）～25日（水）</p></li>'
        : `<div class="box type-content"><p class="type-term">2026年11月1日（日）～25日（水）</p><p class="type-timetable">${headline}</p><p class="type-theater">歌舞伎座</p></div>${html}`,
    observedAt: "2026-10-15T00:00:00.000Z",
    contentHash: "a".repeat(64),
    etag: null,
    lastModified: null,
  }));
  return { drafts: await adapter.acquire(source, held), held };
}

describe("Kabukiza November calendar approximate closing block", () => {
  it("retains all 44 public starts and the verified per-part approximate ends", () => {
    const result = parse();
    const expected = Array.from(
      { length: 25 },
      (_, index) => index + 1,
    ).flatMap((day) => {
      if (day === 9 || day === 17) return [];
      const date = `2026-11-${String(day).padStart(2, "0")}`;
      return [
        ...(day === 14
          ? []
          : [
              {
                startsAt: `${date}T11:00:00+09:00`,
                endsAt: `${date}T15:41:00+09:00`,
              },
            ]),
        ...(day === 22
          ? []
          : [
              {
                startsAt: `${date}T16:30:00+09:00`,
                endsAt: `${date}T20:57:00+09:00`,
              },
            ]),
      ];
    });
    expect(result.occurrences).toHaveLength(44);
    expect(result.occurrences).toEqual(expected);
    // A/B markers must not opt in to act-by-act clock-only matching.
    expect(result.hasOnlyHeadlineClocks).toBe(false);
  });

  it("passes the ends and approximate-time notice through the actual adapter", async () => {
    const { drafts, held } = await acquire();
    expect(held).not.toHaveBeenCalled();
    expect(drafts).toHaveLength(1);
    const draft = drafts[0];
    if (draft?.candidateKind !== "event")
      throw new Error("event draft missing");
    expect(draft.proposal.occurrences).toEqual(parse().occurrences);
    expect(draft.proposal.memo).toContain("概算予定");
  });

  it("keeps calendars without a closing block unchanged", () => {
    const result = parse(`${BASE} ${CLOSED_PRIVATE} ${SCHOOL}`);
    expect(result.occurrences).toHaveLength(44);
    expect(result.occurrences.every((item) => item.endsAt === null)).toBe(true);
  });

  it.each([
    ["unknown part", END_BLOCK.replace("昼の部", "朝の部")],
    ["duplicate part", END_BLOCK.replace("夜の部", "昼の部")],
    [
      "reversed parts",
      END_BLOCK.replace("昼の部", "夜の部").replace(
        "夜の部 午後8",
        "昼の部 午後8",
      ),
    ],
    ["missing part", END_BLOCK.replace("／夜の部 午後8時57分頃", "")],
    ["invalid hour", END_BLOCK.replace("午後3時", "午後13時")],
    ["zero hour", END_BLOCK.replace("午後3時", "午後0時")],
    ["invalid minute", END_BLOCK.replace("41分", "61分")],
    ["end before opening", END_BLOCK.replace("午後3時41分", "午前10時41分")],
    ["end equals opening", END_BLOCK.replace("午後8時57分", "午後4時30分")],
    [
      "missing terminator",
      END_BLOCK.replace("※終演予定時間は変更になる可能性があります", ""),
    ],
    ["duplicate block", `${END_BLOCK} ${END_BLOCK}`],
    [
      "duplicate terminator",
      `${END_BLOCK} ※終演予定時間は変更になる可能性があります`,
    ],
    ["unknown inside block", END_BLOCK.replace("頃／", "頃 ※別の注意／")],
    ["unknown after block", `${END_BLOCK} ※夜の部は変更予定`],
  ])(
    "holds %s instead of discarding the closing information",
    async (_name, block) => {
      const headline = `${BASE} ${CLOSED_PRIVATE} ${block} ${SCHOOL}`;
      expect(() => parse(headline)).toThrow(SourceParseFailure);
      const { drafts, held } = await acquire(headline);
      expect(drafts).toEqual([]);
      expect(held).toHaveBeenCalledOnce();
      expect(held).toHaveBeenCalledWith(
        expect.objectContaining({
          officialExternalId: "986",
          reasonCode: "source_parse",
        }),
      );
    },
  );

  it("rejects a closing block inserted inside the private-date list", () => {
    const notes = CLOSED_PRIVATE.replace(
      "夜の部：22日（日）",
      `${END_BLOCK} 夜の部：22日（日）`,
    );
    expect(() => parse(`${BASE} ${notes} ${SCHOOL}`)).toThrow(
      SourceParseFailure,
    );
  });

  it("keeps unknown notes before and after the recognized school-group section rejected", () => {
    expect(() =>
      parse(`${BASE} ${CLOSED_PRIVATE} ※未知の注意 ${END_BLOCK} ${SCHOOL}`),
    ).toThrow(SourceParseFailure);
    expect(() => parse(`${HEADLINE} ※夜の部は午後5時に変更`)).toThrow(
      SourceParseFailure,
    );
  });

  it("rejects conflicting A/B views instead of mapping the wrong program", () => {
    const desktop = rows();
    const mobile = rows();
    mobile[0] = ["B", "〇"];
    expect(() => parse(HEADLINE, calendar(mobile, desktop))).toThrow(
      SourceParseFailure,
    );
  });

  it("rejects a duplicated calendar date", () => {
    expect(() =>
      parse(HEADLINE, calendar().replace("2<br>（月）", "1<br>（日）")),
    ).toThrow(SourceParseFailure);
  });

  it("does not project a part closing time onto a changed opening clock", () => {
    const changed = rows();
    changed[0] = ["17：00", "〇"];
    expect(() => parse(HEADLINE, calendar(changed))).toThrow(
      SourceParseFailure,
    );
  });

  it("still checks private-day and closure notes against both views", () => {
    expect(() => parse(HEADLINE.replace("14日（土）", "15日（日）"))).toThrow(
      SourceParseFailure,
    );
    expect(() => parse(HEADLINE.replace("9日（月）", "8日（日）"))).toThrow(
      SourceParseFailure,
    );
  });
});
