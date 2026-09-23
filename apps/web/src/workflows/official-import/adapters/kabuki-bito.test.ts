import { describe, expect, it, vi } from "vitest";
import { SourceFetchFailure, SourceParseFailure } from "../acquisition";
import { getOfficialSource } from "../source-registry";
import {
  createKabukiBitoAdapter,
  expandKabukiSchedule,
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

  it("records exclusions found only in a verified calendar", async () => {
    const playUrl = "https://www.kabuki-bito.jp/theaters/other/play/991";
    const pages = new Map<string, string>([
      [
        source.canonicalUrl,
        `<li class="item"><a href="/theaters/other/play/991"><h3 class="ttl">公演</h3></a><p class="term">2026年10月1日～2日</p></li>`,
      ],
      [
        playUrl,
        `<p class="text type-timetable">第一部 午前11時～</p>${mobileCalendar("<th></th><th>第一部</th>", ["<th>1（木）</th><td>11：00</td>", "<th>2（金）</th><td>-</td>"])}`,
      ],
    ]);
    const adapter = createKabukiBitoAdapter(async (_source, url) => {
      const body = pages.get(url);
      if (body === undefined) throw new Error(`unexpected URL ${url}`);
      return document(url, body);
    });
    const [draft] = await adapter.acquire(source);
    if (draft?.candidateKind !== "event")
      throw new Error("event draft missing");
    expect(draft.proposal.occurrences).toHaveLength(1);
    expect(draft.proposal.memo).toContain("除外");
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
    const acquisition = adapter.acquire(source);
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

    await expect(adapter.acquire(source)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("uses the official play id and expands fixed part times while excluding closed/private days", () => {
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
    const occurrences = expandKabukiSchedule(
      fact.startsOn,
      fact.endsOn,
      "昼の部 午前11時～ ／ 夜の部 午後4時～ 【休演】9日、18日 【貸切】12日",
    );
    expect(occurrences).toHaveLength(44);
    expect(occurrences[0]?.startsAt).toBe("2026-10-01T11:00:00+09:00");
    expect(
      occurrences.some((item) => item.startsAt.startsWith("2026-10-09")),
    ).toBe(false);
    expect(
      occurrences.some((item) => item.startsAt.startsWith("2026-10-12")),
    ).toBe(false);
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

  it("counts month-only full rows against the index scan cap", () => {
    const index = Array.from(
      { length: 31 },
      (_, id) =>
        `<li class="item"><a href="/theaters/kabukiza/play/${id + 1}"><h3 class="ttl">公演${id + 1}</h3></a><p class="term">2027年4月</p></li>`,
    ).join("");
    expect(() => parseKabukiIndex(source, index)).toThrow(SourceParseFailure);
  });

  it("rejects a timetable without deterministic part times", () => {
    expect(() =>
      expandKabukiSchedule("2026-10-01", "2026-10-02", "時間未定"),
    ).toThrow();
  });

  it("maps explicit per-date headline times without expanding them across the range", () => {
    const occurrences = parseKabukiDetailedOccurrences(
      "",
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
        "",
        "2026-10-01",
        "2026-10-25",
        "第一部 午前11時 第二部 午後4時",
      ),
    ).toThrow(SourceParseFailure);
  });

  it("rejects explicit times that omit a day in the listed range", () => {
    expect(() =>
      parseKabukiDetailedOccurrences(
        "",
        "2026-09-25",
        "2026-09-27",
        "25日（金） 午後6時～ 27日（日） 午後2時～",
      ),
    ).toThrow(SourceParseFailure);
  });

  it("does not stage an Event-only draft when a single day has no public showtime", () => {
    expect(() =>
      parseKabukiDetailedOccurrences(
        "",
        "2026-10-01",
        "2026-10-01",
        "昼の部 午前11時～ 【貸切】1日",
      ),
    ).toThrow(SourceParseFailure);
  });

  it("keeps the public part of a single-day part-specific private performance", () => {
    expect(
      parseKabukiDetailedOccurrences(
        "",
        "2026-11-01",
        "2026-11-01",
        "昼の部 午前11時～ 夜の部 午後4時～【貸切】昼の部：1日（日）",
        "other",
      ).map((item) => item.startsAt),
    ).toEqual(["2026-11-01T16:00:00+09:00"]);
  });

  it("uses only verified performance columns in a complete mobile calendar", () => {
    const html = `<table><tr><th>1（木）</th><td>10：00</td></tr></table>
      ${mobileCalendar("<th></th><th>第一部</th><th>第二部</th>", [
        "<th>1（木）</th><td>11：00</td><td>16：00</td>",
        "<th>2（金）</th><td>11：00</td><td>-</td>",
        "<th>3（土）</th><td>貸切</td><td>貸切</td>",
      ])}`;
    const occurrences = parseKabukiDetailedOccurrences(
      html,
      "2026-10-01",
      "2026-10-03",
      "第一部 午前11時～ 第二部 午後4時～",
    );
    expect(occurrences.map((item) => item.startsAt)).toEqual([
      "2026-10-01T11:00:00+09:00",
      "2026-10-01T16:00:00+09:00",
      "2026-10-02T11:00:00+09:00",
    ]);
  });

  it("rejects a calendar with an unverified header or malformed date row", () => {
    const rows = [
      "<th>1（木）</th><td>11：00</td><td>16：00</td>",
      "<th>2日（金）</th><td>11：00</td><td>16：00</td>",
    ];
    const header = "<th></th><th>第一部</th><th>第二部</th>";
    expect(() =>
      parseKabukiDetailedOccurrences(
        mobileCalendar("<th></th><th>開場</th><th>第二部</th>", rows),
        "2026-10-01",
        "2026-10-02",
        "第一部 午前11時～ 第二部 午後4時～",
      ),
    ).toThrow(SourceParseFailure);
    expect(() =>
      parseKabukiDetailedOccurrences(
        mobileCalendar(header, rows),
        "2026-10-01",
        "2026-10-02",
        "第一部 午前11時～ 第二部 午後4時～",
      ),
    ).toThrow(SourceParseFailure);
  });

  it("rejects a calendar clock that conflicts with its labeled headline time", () => {
    expect(() =>
      parseKabukiDetailedOccurrences(
        mobileCalendar("<th></th><th>第一部</th>", [
          "<th>1（木）</th><td>10：00</td>",
        ]),
        "2026-10-01",
        "2026-10-01",
        "第一部 午前11時～",
      ),
    ).toThrow(SourceParseFailure);
  });

  it("rejects a mobile calendar whose clock is marked as foreign local time", () => {
    expect(() =>
      parseKabukiDetailedOccurrences(
        mobileCalendar("<th></th><th>第一部</th>", [
          "<th>1（木）</th><td>19：00</td>",
        ]),
        "2026-10-01",
        "2026-10-01",
        "第一部 午後7時～ ※現地時間",
        "other",
      ),
    ).toThrow(SourceParseFailure);
  });

  it("does not mistake curtain times for a calendar header's opening time", () => {
    expect(
      parseKabukiDetailedOccurrences(
        mobileCalendar("<th></th><th>第一部</th><th>第二部</th>", [
          "<th>1（木）</th><td>11：00</td><td>16：00</td>",
        ]),
        "2026-10-01",
        "2026-10-01",
        "第一部 午前11時～ 第二部 午後4時～ 終演予定時間：第一部 午後1時頃／第二部 午後6時頃 ※終演予定時間は変更になる可能性があります",
        "kabukiza",
      ).map((item) => item.startsAt),
    ).toEqual(["2026-10-01T11:00:00+09:00", "2026-10-01T16:00:00+09:00"]);
  });

  it("maps A/B program variants to verified part times while respecting private cells", () => {
    const occurrences = parseKabukiDetailedOccurrences(
      mobileCalendar("<th></th><th>昼の部</th><th>夜の部</th>", [
        "<th>1（日）</th><td>A</td><td>B</td>",
        "<th>2（月）</th><td>貸切</td><td>A</td>",
      ]),
      "2026-11-01",
      "2026-11-02",
      "昼の部 午前11時～ 夜の部 午後4時30分～【貸切】昼の部：2日（月）",
      "kabukiza",
    );
    expect(occurrences.map((item) => item.startsAt)).toEqual([
      "2026-11-01T11:00:00+09:00",
      "2026-11-01T16:30:00+09:00",
      "2026-11-02T16:30:00+09:00",
    ]);
  });

  it("maps verified Aプロ/Bプロ and 〇 calendar cells to labeled part times", () => {
    const occurrences = parseKabukiDetailedOccurrences(
      mobileCalendar("<th></th><th>昼の部</th><th>夜の部</th>", [
        "<th>3（土）</th><td>Aプロ</td><td>〇</td>",
        "<th>4（日）</th><td>Bプロ</td><td>〇</td>",
      ]),
      "2026-10-03",
      "2026-10-04",
      "昼の部 午前11時30分～ 夜の部 午後4時～",
      "kyoto",
    );
    expect(occurrences.map((item) => item.startsAt)).toEqual([
      "2026-10-03T11:30:00+09:00",
      "2026-10-03T16:00:00+09:00",
      "2026-10-04T11:30:00+09:00",
      "2026-10-04T16:00:00+09:00",
    ]);
  });

  it("uses a verified clock header for a single-part calendar", () => {
    const occurrences = parseKabukiDetailedOccurrences(
      mobileCalendar("<th></th><th>14：00</th>", [
        "<th>3（土）</th><td>〇</td>",
        "<th>4（日）</th><td>貸切</td>",
      ]),
      "2026-10-03",
      "2026-10-04",
      "午後2時～ ※当初の発表から公演日程を変更しております",
      "other",
    );
    expect(occurrences.map((item) => item.startsAt)).toEqual([
      "2026-10-03T14:00:00+09:00",
    ]);
  });

  it("accepts numbered part headers only with matching headline times", () => {
    const occurrences = parseKabukiDetailedOccurrences(
      mobileCalendar("<th></th><th>第1部</th><th>第2部</th>", [
        "<th>2（土）</th><td>11：00</td><td>15：00</td>",
        "<th>3（日）</th><td>-</td><td>15：00</td>",
      ]),
      "2027-01-02",
      "2027-01-03",
      "第1部 午前11時～ 第2部 午後3時～【休演・貸切】日程詳細をご確認ください",
      "other",
    );
    expect(occurrences.map((item) => item.startsAt)).toEqual([
      "2027-01-02T11:00:00+09:00",
      "2027-01-02T15:00:00+09:00",
      "2027-01-03T15:00:00+09:00",
    ]);
  });

  it("allows a showtime footnote only when its non-time annotation is verified", () => {
    const table = mobileCalendar("<th></th><th>第1部</th><th>第2部</th>", [
      "<th>17（日）</th><td>11：00</td><td>15：00★</td>",
    ]);
    const args = [
      "2027-01-17",
      "2027-01-17",
      "第1部 午前11時～ 第2部 午後3時～",
      "other",
    ] as const;
    expect(() => parseKabukiDetailedOccurrences(table, ...args)).toThrow(
      SourceParseFailure,
    );
    expect(
      parseKabukiDetailedOccurrences(
        `${table}<p>★17日（日）第2部は「着物で歌舞伎」です。</p>`,
        ...args,
      ).map((item) => item.startsAt),
    ).toEqual(["2027-01-17T11:00:00+09:00", "2027-01-17T15:00:00+09:00"]);
  });

  it("rejects a Kabukiza calendar that disagrees with its closure note", () => {
    expect(() =>
      parseKabukiDetailedOccurrences(
        mobileCalendar("<th></th><th>昼の部</th>", [
          "<th>1（日）</th><td>A</td>",
          "<th>2（月）</th><td>B</td>",
        ]),
        "2026-11-01",
        "2026-11-02",
        "昼の部 午前11時～【休演】2日（月）",
        "kabukiza",
      ),
    ).toThrow(SourceParseFailure);
  });

  it("rejects missing dates and all-private rows instead of staging Event-only", () => {
    const header = "<th></th><th>第一部</th><th>第二部</th>";
    expect(() =>
      parseKabukiDetailedOccurrences(
        mobileCalendar(header, [
          "<th>1（木）</th><td>11：00</td><td>16：00</td>",
        ]),
        "2026-10-01",
        "2026-10-02",
        "第一部 午前11時～ 第二部 午後4時～",
      ),
    ).toThrow(SourceParseFailure);
    expect(() =>
      parseKabukiDetailedOccurrences(
        mobileCalendar(header, ["<th>1（木）</th><td>貸切</td><td>貸切</td>"]),
        "2026-10-01",
        "2026-10-01",
        "第一部 午前11時～ 第二部 午後4時～",
      ),
    ).toThrow(SourceParseFailure);
  });

  it("expands Kabukiza's labeled parts while excluding full closures and part-specific private shows", () => {
    const occurrences = parseKabukiDetailedOccurrences(
      "",
      "2026-09-02",
      "2026-09-26",
      "昼の部 午前11時～ 夜の部 午後4時～【休演】9日（水）、18日（金） 【貸切】※幕見席は営業 昼の部：25日（金） 夜の部：5日（土）、21日（祝・月） ※下記日程は学校団体様がいらっしゃいます 昼の部：2日（水）、4日（金）、16日（水）",
      "kabukiza",
    );
    expect(occurrences).toHaveLength(43);
    expect(occurrences.map((item) => item.startsAt)).toContain(
      "2026-09-02T11:00:00+09:00",
    );
    expect(occurrences.map((item) => item.startsAt)).not.toContain(
      "2026-09-05T16:00:00+09:00",
    );
    expect(occurrences.map((item) => item.startsAt)).not.toContain(
      "2026-09-25T11:00:00+09:00",
    );
    expect(
      occurrences.some((item) => item.startsAt.startsWith("2026-09-09")),
    ).toBe(false);
  });

  it("keeps Kabukiza's three labeled parts but ignores school-group and curtain notes", () => {
    const occurrences = parseKabukiDetailedOccurrences(
      "",
      "2026-10-02",
      "2026-10-20",
      "第一部 午前11時～第二部 午後2時30分～第三部 午後6時～【休演】9日（金） ※下記日程は学校団体様がいらっしゃいます 第一部：2日（金）、14日（水） 終演予定時間：第一部 午後1時35分頃／第二部 午後5時05分頃／第三部 午後9時10分頃",
      "kabukiza",
    );
    expect(occurrences).toHaveLength(54);
    expect(occurrences.map((item) => item.startsAt)).toContain(
      "2026-10-02T14:30:00+09:00",
    );
  });

  it("expands a non-Kabukiza period only when its base times and exceptions are explicit", () => {
    const occurrences = parseKabukiDetailedOccurrences(
      "",
      "2026-12-01",
      "2026-12-24",
      "昼の部 午前10時30分～ 夜の部 午後4時～【休演】9日（水）、17日（木）【貸切】昼の部：12日（土）、19日（土）、20日（日）、夜の部：18日（金）",
      "kyoto",
    );
    expect(occurrences).toHaveLength(40);
    expect(occurrences.map((item) => item.startsAt)).not.toContain(
      "2026-12-18T16:00:00+09:00",
    );
  });

  it("supports a single unlabeled daily showtime outside Kabukiza", () => {
    const occurrences = parseKabukiDetailedOccurrences(
      "",
      "2026-11-03",
      "2026-11-08",
      "午後1時～ ※開場は開演の1時間前を予定",
      "other",
    );
    expect(occurrences).toHaveLength(6);
    expect(occurrences[0]?.startsAt).toBe("2026-11-03T13:00:00+09:00");
  });

  it("accepts a single-date performance with one explicit unlabeled time", () => {
    expect(
      parseKabukiDetailedOccurrences(
        "",
        "2026-12-18",
        "2026-12-18",
        "午後2時～",
        "other",
      ).map((item) => item.startsAt),
    ).toEqual(["2026-12-18T14:00:00+09:00"]);
  });

  it("does not interpret a foreign local time as a Tokyo showtime", () => {
    expect(() =>
      parseKabukiDetailedOccurrences(
        "",
        "2026-10-30",
        "2026-10-31",
        "30日（金）午後7時～ 31日（土）午後7時～ ※現地時間",
        "other",
      ),
    ).toThrow(SourceParseFailure);
  });

  it("honors an explicitly morning-only final day", () => {
    const occurrences = parseKabukiDetailedOccurrences(
      "",
      "2026-11-04",
      "2026-11-11",
      "昼の部 午前11時30分～ 夜の部 午後4時～ ※11日（水）は、午前の部のみ1回公演",
      "other",
    );
    expect(occurrences).toHaveLength(15);
    expect(occurrences.map((item) => item.startsAt)).toContain(
      "2026-11-11T11:30:00+09:00",
    );
    expect(occurrences.map((item) => item.startsAt)).not.toContain(
      "2026-11-11T16:00:00+09:00",
    );
  });

  it("rejects multi-day headlines that only defer exceptions to another section", () => {
    expect(() =>
      parseKabukiDetailedOccurrences(
        "",
        "2026-10-01",
        "2026-10-25",
        "第一部 午前11時～ 第二部 午後4時～【休演】日程詳細をご確認ください",
        "other",
      ),
    ).toThrow(SourceParseFailure);
  });

  it("fails closed for an unrecognized Kabukiza date exception", () => {
    expect(() =>
      parseKabukiDetailedOccurrences(
        "",
        "2026-09-02",
        "2026-09-26",
        "昼の部 午前11時～ 夜の部 午後4時～【休演】9日（木）",
        "kabukiza",
      ),
    ).toThrow(SourceParseFailure);
  });

  it("does not hide a later closure inside a Kabukiza note", () => {
    expect(() =>
      parseKabukiDetailedOccurrences(
        "",
        "2026-09-02",
        "2026-09-03",
        "昼の部 午前11時～ ※下記日程は学校団体様がいらっしゃいます 昼の部：2日（水）【休演】3日（木）",
        "kabukiza",
      ),
    ).toThrow(SourceParseFailure);
  });

  it("rejects an unrecognized cancellation after an otherwise valid information note", () => {
    expect(() =>
      parseKabukiDetailedOccurrences(
        "",
        "2026-09-02",
        "2026-09-03",
        "昼の部 午前11時～ ※下記日程は学校団体様がいらっしゃいます 昼の部：2日（水） ※台風のため3日の公演は中止",
        "kabukiza",
      ),
    ).toThrow(SourceParseFailure);
  });
});

function mobileCalendar(header: string, rows: readonly string[]): string {
  return `<table class="table type-calendar view-sp"><tr>${header}</tr>${rows
    .map((row) => `<tr>${row}</tr>`)
    .join("")}</table>`;
}

function document(url: string, body: string): OfficialHtmlDocument {
  return {
    url,
    body,
    observedAt: "2026-09-22T00:00:00.000Z",
    contentHash: "a".repeat(64),
    etag: null,
    lastModified: null,
  };
}
