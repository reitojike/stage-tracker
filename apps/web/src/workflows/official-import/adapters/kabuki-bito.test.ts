import { describe, expect, it, vi } from "vitest";
import { SourceFetchFailure, SourceParseFailure } from "../acquisition";
import { getOfficialSource } from "../source-registry";
import {
  createKabukiBitoAdapter,
  parseKabukiDetailedOccurrences,
  parseKabukiIndex,
} from "./kabuki-bito";
import type { OfficialHtmlDocument } from "./http";

const source = getOfficialSource("event.kabuki-bito.schedule");
if (source === null) throw new Error("test source missing");

describe("Kabuki-bito adapter facts", () => {
  it("derives the established source key from theater and official play id", async () => {
    const pages = new Map<string, string>([
      [
        source.canonicalUrl,
        `<li class="item"><a href="/theaters/kabukiza/play/978"><h3 class="ttl">十月大歌舞伎</h3></a><p class="term">2026年10月1日～2日</p></li>`,
      ],
      [
        "https://www.kabuki-bito.jp/theaters/kabukiza/play/978",
        `<p class="text type-timetable">1日（木） 午前11時～ 2日（金） 午前11時～</p><p class="text type-theater">歌舞伎座</p>`,
      ],
    ]);
    const adapter = createKabukiBitoAdapter(async (_source, url) => {
      const body = pages.get(url);
      if (body === undefined) throw new Error(`unexpected URL ${url}`);
      return document(url, body);
    });
    const [draft] = await adapter.acquire(source);
    expect(draft?.candidateKind).toBe("event");
    if (draft?.candidateKind !== "event")
      throw new Error("event draft missing");
    expect(draft.proposal.sourceKey).toBe("kabuki-bito:kabukiza:play:978");
    expect(draft.proposal.occurrences).toHaveLength(2);
  });

  it("stages published act-by-act closing times for a verified headline period", async () => {
    const detailUrl = "https://www.kabuki-bito.jp/theaters/kabukiza/play/978";
    const adapter = createKabukiBitoAdapter(async (_source, url) =>
      document(
        url,
        url === source.canonicalUrl
          ? '<li class="item"><a href="/theaters/kabukiza/play/978"><h3 class="ttl">秀山祭九月大歌舞伎</h3></a><p class="term">2026年9月2日（水）～3日（木）</p></li>'
          : `<p class="text type-timetable">昼の部 午前11時～ 夜の部 午後4時～ 終演予定時間：昼の部 午後3時05分頃／夜の部 午後8時35分頃 ※終演予定時間は変更になる可能性があります</p>
             <p class="text type-term">2026年9月2日（水）～3日（木）</p>
             <p class="text type-theater">歌舞伎座</p>
             <section id="timetable">
               <h3>上演時間</h3>
               <dl class="list type-part"><dt><span>昼の部</span></dt><dd><ul class="list type-program">
                 <li class="item"><time class="time">11：00－11：41</time></li>
                 <li class="item type-interlude"><span class="span">幕間 20分</span></li>
                 <li class="item"><time class="time">12：00－12：51</time></li>
                 <li class="item"><time class="time">1：26－3：12</time></li>
               </ul></dd></dl>
               <dl class="list type-part"><dt><span>夜の部</span></dt><dd><ul class="list type-program">
                 <li class="item"><time class="time">4：00－4：19</time></li>
                 <li class="item"><time class="time">4：39－6：27</time></li>
                 <li class="item"><time class="time">7：02－7：32</time></li>
                 <li class="item"><time class="time">7：52－8：49</time></li>
               </ul></dd></dl>
             </section>`,
      ),
    );
    const [draft] = await adapter.acquire(source);
    if (draft?.candidateKind !== "event")
      throw new Error("event draft missing");
    expect(draft.canonicalUrl).toBe(detailUrl);
    expect(draft.proposal.occurrences.map((item) => item.endsAt)).toEqual([
      "2026-09-02T15:12:00+09:00",
      "2026-09-02T20:49:00+09:00",
      "2026-09-03T15:12:00+09:00",
      "2026-09-03T20:49:00+09:00",
    ]);
    expect(draft.proposal.memo).toContain("掲載時点の予定");
    expect(draft.proposal.memo).not.toContain("概算予定");
  });

  it("stages approximate closing times until an act-by-act timetable is published", async () => {
    const adapter = createKabukiBitoAdapter(async (_source, url) =>
      document(
        url,
        url === source.canonicalUrl
          ? '<li class="item"><a href="/theaters/kabukiza/play/979"><h3 class="ttl">錦秋十月大歌舞伎</h3></a><p class="term">2026年10月2日（金）～3日（土）</p></li>'
          : `<p class="text type-timetable">第一部 午前11時～ 第二部 午後2時30分～ 第三部 午後6時～ 終演予定時間：第一部 午後1時35分頃／第二部 午後5時05分頃／第三部 午後9時10分頃 ※終演予定時間は変更になる可能性があります</p>
             <p class="text type-term">2026年10月2日（金）～3日（土）</p>
             <p class="text type-theater">歌舞伎座</p>`,
      ),
    );
    const [draft] = await adapter.acquire(source);
    if (draft?.candidateKind !== "event")
      throw new Error("event draft missing");
    expect(draft.proposal.occurrences.map((item) => item.endsAt)).toEqual([
      "2026-10-02T13:35:00+09:00",
      "2026-10-02T17:05:00+09:00",
      "2026-10-02T21:10:00+09:00",
      "2026-10-03T13:35:00+09:00",
      "2026-10-03T17:05:00+09:00",
      "2026-10-03T21:10:00+09:00",
    ]);
    expect(draft.proposal.memo).toContain("概算予定");
  });

  it("reports an unsupported performance-time section as a held page", async () => {
    const adapter = createKabukiBitoAdapter(async (_source, url) =>
      document(
        url,
        url === source.canonicalUrl
          ? '<li class="item"><a href="/theaters/kabukiza/play/978"><h3 class="ttl">公演</h3></a><p class="term">2026年9月2日（水）～3日（木）</p></li>'
          : `<p class="type-timetable">昼の部 午前11時～ 夜の部 午後4時～</p>
             <p class="type-term">2026年9月2日（水）～3日（木）</p>
             <p class="type-theater">歌舞伎座</p>
             <section id="timetable"><h3>上演時間</h3><p>未対応の構造</p></section>`,
      ),
    );
    const held: string[] = [];
    const drafts = await adapter.acquire(source, (page) => {
      held.push(page.officialExternalId);
    });
    expect(drafts).toEqual([]);
    expect(held).toEqual(["978"]);
  });

  it("reports only unverified detail pages while retaining verified siblings", async () => {
    const validUrl = "https://www.kabuki-bito.jp/theaters/kabukiza/play/978";
    const heldUrl = "https://www.kabuki-bito.jp/theaters/kabukiza/play/979";
    const index = [
      '<li class="item"><a href="/theaters/kabukiza/play/978"><h3 class="ttl">確認済み公演</h3></a><p class="term">2026年10月1日～2日</p></li>',
      '<li class="item"><a href="/theaters/kabukiza/play/979"><h3 class="ttl">保留公演</h3></a><p class="term">2026年10月1日～2日</p></li>',
    ].join("");
    const adapter = createKabukiBitoAdapter(async (_source, url) =>
      document(
        url,
        url === source.canonicalUrl
          ? index
          : url === validUrl
            ? '<p class="type-timetable">1日（木） 午前11時～ 2日（金） 午前11時～</p><p class="type-theater">歌舞伎座</p>'
            : '<p class="type-timetable">※2日は第一部のみ</p><p class="type-theater">歌舞伎座</p>',
      ),
    );
    const held = vi.fn();
    const drafts = await adapter.acquire(source, held);
    expect(drafts.map((draft) => draft.officialExternalId)).toEqual(["978"]);
    expect(held).toHaveBeenCalledExactlyOnceWith({
      canonicalUrl: heldUrl,
      officialExternalId: "979",
      title: "保留公演",
      startsOn: "2026-10-01",
      endsOn: "2026-10-02",
      reasonCode: "source_parse",
    });
  });

  it("bounds detail-page concurrency and pauses between batches", async () => {
    const index = [1, 2, 3, 4, 5]
      .map(
        (id) =>
          `<li class="item"><a href="/theaters/kabukiza/play/${id}"><h3 class="ttl">公演${id}</h3></a><p class="term">2026年10月1日～2日</p></li>`,
      )
      .join("");
    let active = 0;
    let peak = 0;
    const pause = vi.fn(async () => {});
    const adapter = createKabukiBitoAdapter(async (_source, url) => {
      if (url === source.canonicalUrl) return document(url, index);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return document(
        url,
        `<p class="text type-timetable">1日（木） 午前11時～ 2日（金） 午前11時～</p><p class="text type-theater">歌舞伎座</p>`,
      );
    }, pause);

    expect(await adapter.acquire(source)).toHaveLength(5);
    expect(peak).toBe(2);
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it("waits for a sibling detail request after one fetch fails", async () => {
    const index = [1, 2]
      .map(
        (id) =>
          `<li class="item"><a href="/theaters/kabukiza/play/${id}"><h3 class="ttl">公演${id}</h3></a><p class="term">2026年10月1日～2日</p></li>`,
      )
      .join("");
    let failFirst: (error: Error) => void = () => {
      throw new Error("first detail was not requested");
    };
    let finishSecond: () => void = () => {
      throw new Error("second detail was not requested");
    };
    let detailRequests = 0;
    const adapter = createKabukiBitoAdapter(async (_source, url) => {
      if (url === source.canonicalUrl) return document(url, index);
      detailRequests += 1;
      if (url.endsWith("/1")) {
        return new Promise<OfficialHtmlDocument>((_resolve, reject) => {
          failFirst = reject;
        });
      }
      return new Promise<OfficialHtmlDocument>((resolve) => {
        finishSecond = () =>
          resolve(
            document(
              url,
              `<p class="text type-timetable">昼の部 午前11時～</p><p class="text type-theater">歌舞伎座</p>`,
            ),
          );
      });
    });
    const held = vi.fn();
    const acquisition = adapter.acquire(source, held);
    let completed = false;
    void acquisition.then(
      () => {
        completed = true;
      },
      () => {
        completed = true;
      },
    );
    const outcome =
      expect(acquisition).rejects.toBeInstanceOf(SourceFetchFailure);
    await vi.waitFor(() => expect(detailRequests).toBe(2));
    failFirst(new SourceFetchFailure());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completed).toBe(false);
    finishSecond();
    await outcome;
    expect(completed).toBe(true);
    expect(held).not.toHaveBeenCalled();
  });

  it("preserves an early parse failure when a lower-index sibling fails later", async () => {
    const index = [1, 2]
      .map(
        (id) =>
          `<li class="item"><a href="/theaters/kabukiza/play/${id}"><h3 class="ttl">公演${id}</h3></a><p class="term">2026年10月1日～2日</p></li>`,
      )
      .join("");
    let failFirst: (error: Error) => void = () => {
      throw new Error("first detail was not requested");
    };
    let secondRequested = false;
    const adapter = createKabukiBitoAdapter(async (_source, url) => {
      if (url === source.canonicalUrl) return document(url, index);
      if (url.endsWith("/1")) {
        return new Promise<OfficialHtmlDocument>((_resolve, reject) => {
          failFirst = reject;
        });
      }
      secondRequested = true;
      return document(url, `<p class="text type-theater">歌舞伎座</p>`);
    });
    const acquisition = adapter.acquire(source);
    const outcome =
      expect(acquisition).rejects.toBeInstanceOf(SourceParseFailure);
    await vi.waitFor(() => expect(secondRequested).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    failFirst(new SourceFetchFailure());
    await outcome;
  });

  it("fails closed before detail fetches if the index exceeds the scan cap", async () => {
    const index = Array.from(
      { length: 31 },
      (_, id) =>
        `<li class="item"><a href="/theaters/kabukiza/play/${id + 1}"><h3 class="ttl">公演${id + 1}</h3></a><p class="term">2026年10月1日～2日</p></li>`,
    ).join("");
    const fetcher = vi.fn(async (_source, url: string) => {
      if (url !== source.canonicalUrl)
        throw new Error("unexpected detail fetch");
      return document(url, index);
    });
    const adapter = createKabukiBitoAdapter(fetcher);
    const held = vi.fn();

    await expect(adapter.acquire(source, held)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(held).not.toHaveBeenCalled();
  });

  it("uses the official play id from the index", () => {
    const [fact] = parseKabukiIndex(
      source,
      `
      <li class="item"><a href="/theaters/kabukiza/play/978"><h3 class="ttl">十月大歌舞伎</h3></a><p class="term">2026年10月1日（木）～25日（日）</p></li>`,
    );
    if (fact === undefined) throw new Error("fixture was not parsed");
    expect(fact).toMatchObject({
      officialId: "978",
      theater: "kabukiza",
      startsOn: "2026-10-01",
      endsOn: "2026-10-25",
    });
  });

  it("deduplicates teaser links and stages only exact-dated full rows", () => {
    const facts = parseKabukiIndex(
      source,
      `
      <div class="item"><a href="/theaters/kabukiza/play/978">teaser</a></div>
      <li class="item"><a href="/theaters/kabukiza/play/978"><h3 class="ttl">公演A</h3></a><p class="term">2026年9月25日（金）</p></li>
      <li class="item"><a href="/theaters/kabukiza/play/979"><h3 class="ttl">公演B</h3></a><p class="term">2027年4月</p></li>`,
    );
    expect(facts).toMatchObject([
      {
        officialId: "978",
        startsOn: "2026-09-25",
        endsOn: "2026-09-25",
      },
    ]);
  });

  it.each([
    ["2026年11月3日（火・祝）", "2026-11-03"],
    ["2027年3月22日（月・休）", "2027-03-22"],
  ])("accepts a verified holiday date %s", (term, expected) => {
    const [fact] = parseKabukiIndex(
      source,
      `<li class="item"><a href="/theaters/kabukiza/play/978"><h3 class="ttl">公演</h3></a><p class="term">${term}</p></li>`,
    );
    expect(fact?.startsOn).toBe(expected);
    expect(fact?.endsOn).toBe(expected);
  });

  it("fails closed for a teaser without a full row or a malformed full date", () => {
    expect(() =>
      parseKabukiIndex(
        source,
        `<div class="item"><a href="/theaters/kabukiza/play/978">teaser</a></div>`,
      ),
    ).toThrow(SourceParseFailure);
    expect(() =>
      parseKabukiIndex(
        source,
        `<li class="item"><a href="/theaters/kabukiza/play/978"><h3 class="ttl">公演A</h3></a><p class="term">2026年9月頃</p></li>`,
      ),
    ).toThrow(SourceParseFailure);
  });

  it.each([
    "2026年10月1日（金）～2日（金）",
    "2026年10月1日（木）～2日（金） ※3日は中止",
    "2026年10月1日（木）～2日（土）",
  ])("rejects inconsistent or trailing index date text: %s", (term) => {
    expect(() =>
      parseKabukiIndex(
        source,
        `<li class="item"><a href="/theaters/kabukiza/play/978"><h3 class="ttl">公演</h3></a><p class="term">${term}</p></li>`,
      ),
    ).toThrow(SourceParseFailure);
  });

  it("counts month-only full rows against the index scan cap", () => {
    const index = Array.from(
      { length: 31 },
      (_, id) =>
        `<li class="item"><a href="/theaters/kabukiza/play/${id + 1}"><h3 class="ttl">公演${id + 1}</h3></a><p class="term">2027年4月</p></li>`,
    ).join("");
    expect(() => parseKabukiIndex(source, index)).toThrow(SourceParseFailure);
  });

  it("maps explicit per-date headline times without expanding them across the range", () => {
    const occurrences = parseKabukiDetailedOccurrences(
      "2026-09-25",
      "2026-09-27",
      "25日（金） 午後6時～ 26日（土） 午後2時～ 27日（日） 午後2時～",
    );
    expect(occurrences.map((item) => item.startsAt)).toEqual([
      "2026-09-25T18:00:00+09:00",
      "2026-09-26T14:00:00+09:00",
      "2026-09-27T14:00:00+09:00",
    ]);
  });

  it("rejects a multi-day headline without day-level evidence", () => {
    expect(() =>
      parseKabukiDetailedOccurrences(
        "2026-10-01",
        "2026-10-25",
        "第一部 午前11時 第二部 午後4時",
      ),
    ).toThrow(SourceParseFailure);
  });

  it("rejects explicit times that omit a day in the listed range", () => {
    expect(() =>
      parseKabukiDetailedOccurrences(
        "2026-09-25",
        "2026-09-27",
        "25日（金） 午後6時～ 27日（日） 午後2時～",
      ),
    ).toThrow(SourceParseFailure);
  });

  it.each([
    "1日（金） 午前11時～",
    "1日（木） 午後13時～",
    "1日（木） 午前0時～",
  ])("rejects inconsistent per-date annotations or clocks: %s", (text) => {
    expect(() =>
      parseKabukiDetailedOccurrences("2026-10-01", "2026-10-01", text),
    ).toThrow(SourceParseFailure);
  });

  it("holds an unrecognized headline element structure", async () => {
    const adapter = createKabukiBitoAdapter(async (_source, url) =>
      document(
        url,
        url === source.canonicalUrl
          ? '<li class="item"><a href="/theaters/kabukiza/play/978"><h3 class="ttl">公演</h3></a><p class="term">2026年10月1日～2日</p></li>'
          : '<p class="type-timetable"><em>昼の部 午前11時～</em></p><p class="type-theater">歌舞伎座</p>',
      ),
    );
    await expect(adapter.acquire(source)).rejects.toThrow(SourceParseFailure);
  });

  it("holds a headline outside its observed container", async () => {
    const adapter = createKabukiBitoAdapter(async (_source, url) =>
      document(
        url,
        url === source.canonicalUrl
          ? '<li class="item"><a href="/theaters/kabukiza/play/978"><h3 class="ttl">公演</h3></a><p class="term">2026年10月1日～2日</p></li>'
          : '<aside><p class="type-timetable">昼の部 午前11時～</p></aside><p class="type-theater">歌舞伎座</p>',
      ),
    );
    await expect(adapter.acquire(source)).rejects.toThrow(SourceParseFailure);
  });

  it.each([
    {
      name: "redirected play identity",
      url: "https://www.kabuki-bito.jp/theaters/kabukiza/play/999",
      period: "2026年10月1日～2日",
    },
    {
      name: "changed detail period",
      url: "https://www.kabuki-bito.jp/theaters/kabukiza/play/978",
      period: "2026年10月10日～11日",
    },
  ])("rejects a $name", async ({ url: detailUrl, period }) => {
    const adapter = createKabukiBitoAdapter(async (_source, url) =>
      document(
        url === source.canonicalUrl ? url : detailUrl,
        url === source.canonicalUrl
          ? '<li class="item"><a href="/theaters/kabukiza/play/978"><h3 class="ttl">公演</h3></a><p class="term">2026年10月1日～2日</p></li>'
          : `<p class="type-timetable">昼の部 午前11時～</p><p class="text type-term">${period}</p><p class="type-theater">歌舞伎座</p>`,
      ),
    );
    const held = vi.fn();
    await expect(adapter.acquire(source, held)).rejects.toThrow(
      SourceParseFailure,
    );
    expect(held).not.toHaveBeenCalled();
  });

  it("does not stage an Event-only draft when a single day has no public showtime", () => {
    expect(() =>
      parseKabukiDetailedOccurrences(
        "2026-10-01",
        "2026-10-01",
        "昼の部 午前11時～ 【貸切】1日",
      ),
    ).toThrow(SourceParseFailure);
  });

  it("stages an exact-dated Event without Occurrences when opening times are unpublished", async () => {
    const adapter = createKabukiBitoAdapter(async (_source, url) =>
      document(
        url,
        url === source.canonicalUrl
          ? '<li class="item"><a href="/theaters/kabukiza/play/978"><h3 class="ttl">公演</h3></a><p class="term">2026年10月1日～2日</p></li>'
          : '<p class="type-timetable">【休演】2日（金）</p><p class="type-theater">歌舞伎座</p>',
      ),
    );
    const [draft] = await adapter.acquire(source);
    expect(draft?.candidateKind).toBe("event");
    if (draft?.candidateKind !== "event")
      throw new Error("missing Event draft");
    expect(draft.proposal.startsOn).toBe("2026-10-01");
    expect(draft.proposal.endsOn).toBe("2026-10-02");
    expect(draft.proposal.occurrences).toEqual([]);
  });

  it.each([
    "14：00",
    "※開演時刻が変更になりました",
    "※公演中止",
    "※2日は第一部のみ",
    "【休演】2日（金） ※3日は夜の部のみ",
    "【休演】4日（日）",
  ])(
    "does not downgrade a schedule-bearing detail to Event-only: %s",
    async (timetable) => {
      const adapter = createKabukiBitoAdapter(async (_source, url) =>
        document(
          url,
          url === source.canonicalUrl
            ? '<li class="item"><a href="/theaters/kabukiza/play/978"><h3 class="ttl">公演</h3></a><p class="term">2026年10月1日～2日</p></li>'
            : `<p class="type-timetable">${timetable}</p><p class="type-theater">歌舞伎座</p>`,
        ),
      );
      await expect(adapter.acquire(source)).rejects.toThrow(SourceParseFailure);
    },
  );
});

function document(url: string, body: string): OfficialHtmlDocument {
  const isDetail = /\/play\/\d+/u.test(url);
  const detailBody =
    isDetail && !body.includes("type-term")
      ? `${body}<p class="text type-term">2026年10月1日～2日</p>`
      : body;
  return {
    url,
    body: isDetail
      ? `<div class="box type-content">${detailBody}</div>`
      : detailBody,
    observedAt: "2026-09-22T00:00:00.000Z",
    contentHash: "a".repeat(64),
    etag: null,
    lastModified: null,
  };
}
