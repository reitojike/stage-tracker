import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getOfficialSource } from "../source-registry";
import {
  createTakarazukaRevueAdapter,
  parseTakarazukaIndex,
  parseTakarazukaSchedule,
} from "./takarazuka-revue";
import type { OfficialHtmlDocument } from "./http";

const source = getOfficialSource("event.takarazuka.revue");
if (source === null) throw new Error("test source missing");

describe("Takarazuka revue adapter facts", () => {
  it("keeps only observed work names and canonical main-theater names", () => {
    const [fact] = parseTakarazukaIndex(
      source,
      `<div class="item"><a href="/sp/revue/2027/abunaideka/index.html">
      <p class="title">YOKOHAMA CITY MEMORY 『あぶない刑事』 原作／「あぶない刑事」 ©セントラル・アーツ
      脚本・演出／齋藤 吉正 鴨川清作メモリーズ・オブ・ドリームス 『PURE LOVE!!』
      監修／三木 章雄 作・演出／藤井 大介</p></a>
      <dl><dt>宝塚大劇場 (兵庫県)</dt><dd>2027年5月8日～6月20日</dd></dl></div>`,
    );
    expect(fact?.title).toBe("『あぶない刑事』 『PURE LOVE!!』");
    expect(fact?.venues[0]?.venue).toBe("宝塚大劇場");
  });

  it("uses the official production-page title for the observed Star Troupe event", async () => {
    const detailUrl =
      "https://kageki.hankyu.co.jp/sp/revue/2027/abunaideka/index.html";
    const pages = new Map([
      [
        source.canonicalUrl,
        `<div class="item"><a href="/sp/revue/2027/abunaideka/index.html"><p class="title">『あぶない刑事』</p></a>
        <dl><dt>宝塚大劇場</dt><dd>2027年5月8日～6月20日</dd></dl></div>`,
      ],
      [
        detailUrl,
        `<title>星組公演 『あぶない刑事』『PURE LOVE!!』</title>
        <dl class="revueInfo accordion"><dt class="acc-trigger">宝塚大劇場 [兵庫県]</dt>
        <dd>公演期間 2027年5月8日～6月20日 一般前売 2027年4月10日</dd></dl>`,
      ],
    ]);
    const adapter = createTakarazukaRevueAdapter(async (_source, url) => {
      const body = pages.get(url);
      if (body === undefined) throw new Error(`unexpected URL ${url}`);
      return document(url, body);
    });
    const [draft] = await adapter.acquire(source);
    expect(draft?.proposal).toMatchObject({
      genre: "takarazuka",
      groups: [{ key: "takarazuka-hoshi", displayName: "星組" }],
    });
  });

  it("holds an unrecognized production-page troupe instead of guessing", async () => {
    const detailUrl =
      "https://kageki.hankyu.co.jp/sp/revue/2027/abunaideka/index.html";
    const pages = new Map([
      [
        source.canonicalUrl,
        `<div class="item"><a href="/sp/revue/2027/abunaideka/index.html"><p class="title">『あぶない刑事』</p></a>
        <dl><dt>宝塚大劇場</dt><dd>2027年5月8日～6月20日</dd></dl></div>`,
      ],
      [detailUrl, `<title>組公演 『あぶない刑事』</title>`],
    ]);
    const adapter = createTakarazukaRevueAdapter(async (_source, url) => {
      const body = pages.get(url);
      if (body === undefined) throw new Error(`unexpected URL ${url}`);
      return document(url, body);
    });
    await expect(adapter.acquire(source)).rejects.toMatchObject({
      name: "SourceParseFailure",
      canonicalUrl: detailUrl,
    });
  });

  it("keeps Event facts when only the general-sale field is unreadable", () => {
    const facts = parseTakarazukaIndex(
      source,
      `<div class="item"><a href="/sp/revue/2026/example/index.html"><p class="title">Example</p></a>
      <dl><dt>宝塚大劇場</dt><dd>2026年10月17日～11月22日 一般前売 2026年9月26日</dd></dl></div>`,
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]?.venues[0]).toMatchObject({
      startsOn: "2026-10-17",
      endsOn: "2026-11-22",
      generalSaleOn: null,
    });
  });

  it("fails closed when the index has no recognized production links", () => {
    expect(() =>
      parseTakarazukaIndex(
        source,
        `<div class="item"><a href="/sp/revue/index.html">公演案内</a></div>
        <div class="item"><a href="/sp/revue/2027/example/performance.html">Example</a></div>`,
      ),
    ).toThrow("Official source parse failed");
  });

  it("fails closed when one production repeats a venue identity", () => {
    expect(() =>
      parseTakarazukaIndex(
        source,
        `<div class="item"><a href="/sp/revue/2027/fictionalwork/index.html"><p class="title">Fictional Work</p></a>
        <dl><dt>宝塚大劇場</dt><dd>2027年4月3日～5月16日</dd></dl>
        <dl><dt>宝塚大劇場</dt><dd>2027年7月1日～8月1日</dd></dl></div>`,
      ),
    ).toThrow("Official source parse failed");
  });

  it("stages a dated venue without a published day schedule as Event-only", async () => {
    const detailUrl =
      "https://kageki.hankyu.co.jp/sp/revue/2027/thelondonway/index.html";
    const pages = new Map<string, string>([
      [
        source.canonicalUrl,
        `<div class="item"><a href="/sp/revue/2027/thelondonway/index.html"><p class="title">The London Way</p></a>
        <dl><dt>東京宝塚劇場</dt><dd>2027年4月3日～5月16日</dd></dl></div>`,
      ],
      [
        detailUrl,
        `<title>宙組公演 『The London Way』</title>
        <dl class="revueInfo accordion"><dt class="acc-trigger">東京宝塚劇場 [東京都]</dt>
        <dd>公演期間 2027年4月3日～5月16日 一般前売 2027年3月7日</dd></dl>`,
      ],
    ]);
    const adapter = createTakarazukaRevueAdapter(async (_source, url) => {
      const body = pages.get(url);
      if (body === undefined) throw new Error(`unexpected URL ${url}`);
      return document(url, body);
    });
    const drafts = await adapter.acquire(source);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.proposal).toMatchObject({
      sourceKey: "takarazuka:2027:thelondonway:tokyo",
      sourceUrl: detailUrl,
      startsOn: "2027-04-03",
      endsOn: "2027-05-16",
      occurrences: [],
      genre: "takarazuka",
      groups: [{ key: "takarazuka-sora", displayName: "宙組" }],
    });
  });

  it("does not treat a renamed day-schedule link as an unpublished schedule", async () => {
    const detailUrl =
      "https://kageki.hankyu.co.jp/sp/revue/2027/thelondonway/index.html";
    const pages = new Map<string, string>([
      [
        source.canonicalUrl,
        `<div class="item"><a href="/sp/revue/2027/thelondonway/index.html"><p class="title">The London Way</p></a>
        <dl><dt>東京宝塚劇場</dt><dd>2027年4月3日～5月16日</dd></dl></div>`,
      ],
      [
        detailUrl,
        `<title>宙組公演 『The London Way』</title>
        <dl class="revueInfo accordion"><dt class="acc-trigger">東京宝塚劇場 [東京都]</dt>
        <dd>公演期間 2027年4月3日～5月16日
        <a href="days_tokyo.html">公演日程を見る</a>
        一般前売 2027年3月7日</dd></dl>`,
      ],
    ]);
    const adapter = createTakarazukaRevueAdapter(async (_source, url) => {
      const body = pages.get(url);
      if (body === undefined) throw new Error(`unexpected URL ${url}`);
      return document(url, body);
    });
    await expect(adapter.acquire(source)).rejects.toThrow(
      "Official source parse failed",
    );
  });

  it("fails closed before fetching more than 30 Takarazuka pages", async () => {
    const index = Array.from(
      { length: 15 },
      (_, index) => `
      <div class="item"><a href="/sp/revue/2027/work${index}/index.html">
      <p class="title">Work ${index}</p></a>
      <dl><dt>東京宝塚劇場</dt><dd>2027年4月3日～5月16日</dd></dl></div>`,
    ).join("");
    let requests = 0;
    const adapter = createTakarazukaRevueAdapter(async (_source, url) => {
      requests += 1;
      const body =
        url === source.canonicalUrl
          ? index
          : url.endsWith("/index.html")
            ? `<title>星組公演 Work</title><a href="schedule_tokyo.html">日程</a>`
            : schedulePage(
                `<table><tr><th>4/3</th><td>13:30</td></tr></table>`,
              );
      return document(url, body);
    });
    await expect(adapter.acquire(source)).rejects.toMatchObject({
      name: "SourceParseFailure",
      reason: "request_limit",
    });
    expect(requests).toBe(30);
  });

  it("ignores the observed navigation and cast blocks and fetches duplicate schedule links once", async () => {
    const detailUrl =
      "https://kageki.hankyu.co.jp/sp/revue/2026/ponoichizoku/index.html";
    const scheduleUrl =
      "https://kageki.hankyu.co.jp/sp/revue/2026/ponoichizoku/schedule_tokyo.html";
    const pages = new Map<string, string>([
      [
        source.canonicalUrl,
        `<div class="item"><a href="/sp/revue/index.html">公演案内</a></div>
        <div class="item"><a href="/sp/revue/2026/ponoichizoku/index.html"><p class="title">『ポーの一族』</p></a>
        <dl><dt>東京宝塚劇場</dt><dd>2026年9月12日～13日</dd></dl>
        <dl><dt>主な出演者</dt><dd>出演者名</dd></dl></div>`,
      ],
      [
        detailUrl,
        `<title>雪組公演 『ポーの一族』</title><a href="schedule_tokyo.html">日程</a><a href="schedule_tokyo.html">日程</a>`,
      ],
      [
        scheduleUrl,
        schedulePage(`<table><tr><th>9/12</th><td>13:30</td></tr></table>`),
      ],
    ]);
    const requests: string[] = [];
    const adapter = createTakarazukaRevueAdapter(async (_source, url) => {
      requests.push(url);
      const body = pages.get(url);
      if (body === undefined) throw new Error(`unexpected URL ${url}`);
      return document(url, body);
    });
    const drafts = await adapter.acquire(source);
    expect(drafts).toHaveLength(1);
    expect(requests).toEqual([source.canonicalUrl, detailUrl, scheduleUrl]);
  });

  it("derives one venue-specific Event source key and occurrence draft", async () => {
    const pages = new Map<string, string>([
      [
        source.canonicalUrl,
        `<div class="item"><a href="/sp/revue/2026/ponoichizoku/index.html"><p class="title">『ポーの一族』</p></a><dl><dt>東京宝塚劇場</dt><dd>2026年9月12日～13日</dd></dl></div>`,
      ],
      [
        "https://kageki.hankyu.co.jp/sp/revue/2026/ponoichizoku/index.html",
        `<title>雪組公演 『ポーの一族』</title><a href="schedule_tokyo.html">東京公演日程</a>`,
      ],
      [
        "https://kageki.hankyu.co.jp/sp/revue/2026/ponoichizoku/schedule_tokyo.html",
        schedulePage(`<table><tr><th>9/12</th><td>13:30</td></tr></table>`),
      ],
    ]);
    const adapter = createTakarazukaRevueAdapter(async (_source, url) => {
      const body = pages.get(url);
      if (body === undefined) throw new Error(`unexpected URL ${url}`);
      return document(url, body);
    });
    const [draft] = await adapter.acquire(source);
    expect(draft?.candidateKind).toBe("event");
    if (draft?.candidateKind !== "event")
      throw new Error("event draft missing");
    expect(draft.proposal.sourceKey).toBe("takarazuka:2026:ponoichizoku:tokyo");
    expect(draft.proposal).toMatchObject({
      genre: "takarazuka",
      groups: [{ key: "takarazuka-yuki", displayName: "雪組" }],
    });
    expect(draft.proposal.occurrences).toEqual([
      { startsAt: "2026-09-12T13:30:00+09:00", endsAt: null },
    ]);
  });

  it("keeps Event identity and content hash stable for identical mock pages", async () => {
    const detailUrl =
      "https://kageki.hankyu.co.jp/sp/revue/2027/fictionalwork/index.html";
    const takarazukaScheduleUrl =
      "https://kageki.hankyu.co.jp/sp/revue/2027/fictionalwork/schedule_takarazuka.html";
    const tokyoScheduleUrl =
      "https://kageki.hankyu.co.jp/sp/revue/2027/fictionalwork/schedule_tokyo.html";
    const pages = new Map<string, string>([
      [
        source.canonicalUrl,
        `<div class="item"><a href="/sp/revue/2027/fictionalwork/index.html"><p class="title">Fictional Work</p></a>
        <dl><dt>宝塚大劇場</dt><dd>2027年4月3日～5月16日</dd></dl>
        <dl><dt>東京宝塚劇場</dt><dd>2027年6月1日～7月15日</dd></dl></div>`,
      ],
      [
        detailUrl,
        `<title>星組公演 Fictional Work</title><a href="schedule_takarazuka.html">Schedule A</a><a href="schedule_tokyo.html">Schedule B</a>`,
      ],
      [
        takarazukaScheduleUrl,
        schedulePage(`<table><tr><th>4/3</th><td>13:30</td></tr></table>`),
      ],
      [
        tokyoScheduleUrl,
        schedulePage(`<table><tr><th>6/1</th><td>13:30</td></tr></table>`),
      ],
    ]);
    const adapter = createTakarazukaRevueAdapter(async (_source, url) => {
      const body = pages.get(url);
      if (body === undefined) throw new Error(`unexpected URL ${url}`);
      return {
        ...document(url, body),
        contentHash: createHash("sha256").update(body).digest("hex"),
      };
    });

    const first = await adapter.acquire(source);
    const second = await adapter.acquire(source);
    const identityAndHash = (drafts: typeof first) =>
      drafts.map(({ officialExternalId, contentHash, proposal }) => ({
        officialExternalId,
        sourceKey: proposal.sourceKey,
        contentHash,
      }));

    expect(first).toHaveLength(2);
    expect(new Set(first.map((draft) => draft.officialExternalId)).size).toBe(
      first.length,
    );
    expect(first.map((draft) => draft.officialExternalId)).toEqual([
      "2027:fictionalwork:takarazuka",
      "2027:fictionalwork:tokyo",
    ]);
    expect(first.map((draft) => draft.proposal.sourceKey)).toEqual([
      "takarazuka:2027:fictionalwork:takarazuka",
      "takarazuka:2027:fictionalwork:tokyo",
    ]);
    expect(first[0]?.officialExternalId).toBe("2027:fictionalwork:takarazuka");
    expect(first[0]?.proposal.sourceKey).toBe(
      "takarazuka:2027:fictionalwork:takarazuka",
    );
    expect(first[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(identityAndHash(second)).toEqual(identityAndHash(first));
  });

  it("keeps the established year/work/venue identity and extracts public performance times", () => {
    const [production] = parseTakarazukaIndex(
      source,
      `
      <div class="item"><a href="/sp/revue/2026/ponoichizoku/index.html"><p class="title">『ポーの一族』</p></a>
      <dl><dt>東京宝塚劇場</dt><dd>2026年9月12日（土）～10月25日（日）</dd></dl></div>`,
    );
    if (production === undefined) throw new Error("fixture was not parsed");
    expect(production).toMatchObject({
      year: "2026",
      workSlug: "ponoichizoku",
    });
    expect(production.venues[0]).toMatchObject({
      venueSlug: "tokyo",
      startsOn: "2026-09-12",
      endsOn: "2026-10-25",
    });
    const occurrences = parseTakarazukaSchedule(
      schedulePage(
        `<table><tr><th>9/12</th><td>13:30</td><td>貸切公演</td></tr><tr><th>9/13</th><td>11:00</td><td>15:30</td></tr></table>`,
      ),
      "2026-09-12",
      "2026-10-25",
    );
    expect(occurrences.map((item) => item.startsAt)).toEqual([
      "2026-09-12T13:30:00+09:00",
      "2026-09-13T11:00:00+09:00",
      "2026-09-13T15:30:00+09:00",
    ]);
  });

  it("fails closed when a schedule table has no usable occurrence", () => {
    expect(() =>
      parseTakarazukaSchedule(
        schedulePage("<table><tr><th>9/12</th><td>休演日</td></tr></table>"),
        "2026-09-12",
        "2026-09-12",
      ),
    ).toThrow();
  });

  it.each([
    [
      "an unreadable sibling time",
      `<table><tr><th>9/12</th><td>13:30</td><td>開演時刻調整中</td></tr></table>`,
    ],
    [
      "a linked page without a day table",
      `<main><h2>公演日程</h2><p>調整中</p></main>`,
    ],
    [
      "a cancelled time",
      `<table><tr><th>9/12</th><td>13:30（公演中止）</td></tr></table>`,
    ],
    [
      "an ambiguously changed time",
      `<table><tr><th>9/12</th><td>13:30（15:30に変更）</td></tr></table>`,
    ],
    [
      "an unreadable date before a recognized date",
      `<table><tr><th>9月12日</th><td>13:30</td></tr><tr><th>9/13</th><td>11:00</td></tr></table>`,
    ],
    [
      "an undated time before a recognized date",
      `<table><tr><td>13:30</td></tr><tr><th>9/13</th><td>11:00</td></tr></table>`,
    ],
    [
      "an unreadable date after a recognized date",
      `<table><tr><th>9/12</th><td>13:30</td></tr><tr><th>9月13日</th><td>11:00</td></tr></table>`,
    ],
    [
      "a known schedule table with only unreadable dates beside a valid table",
      `<table><tr><th>日付</th><th>開演時間</th></tr><tr><th>9月12日</th><td>13:30</td></tr></table><table><tr><th>9/13</th><td>11:00</td></tr></table>`,
    ],
    [
      "a headerless unreadable-date table before a valid table",
      `<table><tr><th>9月12日</th><td>13:30</td></tr></table><table><tr><th>9/13</th><td>11:00</td></tr></table>`,
    ],
    [
      "a headerless unreadable-date table after a valid table",
      `<table><tr><th>9/12</th><td>13:30</td></tr></table><table><tr><th>9月13日</th><td>11:00</td></tr></table>`,
    ],
    [
      "a standalone headerless unreadable-date table",
      `<table><tr><th>9月12日</th><td>13:30</td></tr></table>`,
    ],
    [
      "a headerless unreadable-date sibling with an empty first slot",
      `<table><tr><th>9/12</th><td>13:30</td></tr></table><table><tr><th rowspan="2">9月13日</th><td></td></tr><tr><td>11:00</td></tr></table>`,
    ],
    [
      "an unreadable rowspan date with an empty first slot after a valid day",
      `<table><tr><th>9/12</th><td>13:30</td></tr><tr><th rowspan="2">9月13日</th><td></td></tr><tr><td>11:00</td></tr></table>`,
    ],
    [
      "an unreadable rowspan date with an empty first slot before a valid day",
      `<table><tr><th rowspan="2">9月12日</th><td></td></tr><tr><td>13:30</td></tr><tr><th>9/13</th><td>11:00</td></tr></table>`,
    ],
    [
      "an unreadable date heading without a time cell",
      `<table><tr><th>9/12</th><td>13:30</td></tr><tr><th>日付調整中</th></tr><tr><td>11:00</td></tr></table>`,
    ],
    [
      "an orphan time after a repeated table header",
      `<table><tr><th>9/12</th><td>13:30</td></tr><tr><th>日付</th><th>開演時間</th></tr><tr><td>11:00</td></tr></table>`,
    ],
  ])(
    "rejects %s at both the parser and adapter boundary",
    async (_label, schedule) => {
      await expectInvalidSchedulePage(schedulePage(schedule));
    },
  );

  it.each([
    ["bare tables", `<table><tr><th>9/12</th><td>13:30</td></tr></table>`],
    [
      "no schedule region",
      `<div id="contents"><article><h1>公演日程</h1><table><tr><th>9/12</th><td>13:30</td></tr></table></article></div>`,
    ],
    [
      "two schedule regions",
      `<div id="contents"><article><h1>公演日程</h1><section class="article02"><div class="table03"><table><tr><th>9/12</th><td>13:30</td></tr></table></div><div class="table03"><table><tr><th>9/13</th><td>11:00</td></tr></table></div></section></article></div>`,
    ],
    [
      "two content roots",
      schedulePage(
        `<table><tr><th>9/12</th><td>13:30</td></tr></table>`,
      ).repeat(2),
    ],
    [
      "two schedule sections even when one has no frame",
      schedulePage(
        `<table><tr><th>9/12</th><td>13:30</td></tr></table>`,
      ).replace(
        "</article>",
        '<section class="article02"></section></article>',
      ),
    ],
    [
      "wrong page heading",
      schedulePage(
        `<table><tr><th>9/12</th><td>13:30</td></tr></table>`,
      ).replace("公演日程", "料金"),
    ],
    [
      "duplicate page headings",
      schedulePage(
        `<table><tr><th>9/12</th><td>13:30</td></tr></table>`,
      ).replace("</h1>", "</h1><h1>公演日程</h1>"),
    ],
    [
      "unknown region class",
      schedulePage(
        `<table><tr><th>9/12</th><td>13:30</td></tr></table>`,
      ).replace('class="article02"', 'class="changed"'),
    ],
    [
      "empty region with only an outside table",
      schedulePage("", `<table><tr><th>9/12</th><td>13:30</td></tr></table>`),
    ],
    [
      "nested tables",
      schedulePage(
        `<table><tr><td><table><tr><th>9/12</th><td>13:30</td></tr></table></td></tr></table>`,
      ),
    ],
    [
      "a headingless nonempty table inside the region",
      schedulePage(
        `<table><tr><td>13:30</td></tr></table><table><tr><th>9/13</th><td>11:00</td></tr></table>`,
      ),
    ],
    [
      "an ambiguous fee table inside the region",
      schedulePage(
        `<table><tr><th>9/12</th><td>13:30</td></tr></table><table><tr><th>料金</th><td>1000円</td></tr></table>`,
      ),
    ],
    [
      "an empty table beside a valid table inside the region",
      schedulePage(
        `<table></table><table><tr><th>9/12</th><td>13:30</td></tr></table>`,
      ),
    ],
    [
      "a header-only table beside a valid table inside the region",
      schedulePage(
        `<table><tr><th>日付</th><th>開演時間</th></tr></table><table><tr><th>9/12</th><td>13:30</td></tr></table>`,
      ),
    ],
  ])(
    "rejects %s without falling back to other tables",
    async (_label, page) => {
      await expectInvalidSchedulePage(page);
    },
  );

  it.each([
    `<table><tr><th>料金</th><td>1000円</td></tr></table>`,
    `<table><tr><th>連絡先</th><td>03:00</td></tr></table>`,
  ])(
    "ignores an unrelated headed table outside the schedule region: %s",
    async (outside) => {
      const page = schedulePage(
        `<table><tr><th>9/12</th><td>13:30</td></tr></table>`,
        outside,
      );
      const expected = [
        { startsAt: "2026-09-12T13:30:00+09:00", endsAt: null },
      ];
      expect(parseTakarazukaSchedule(page, "2026-09-12", "2026-09-13")).toEqual(
        expected,
      );
      const [draft] = await acquireSchedulePage(page);
      if (draft?.candidateKind !== "event")
        throw new Error("event draft missing");
      expect(draft?.proposal.occurrences).toEqual(expected);
    },
  );

  it("keeps empty rowspan cells, closed days, private shows and observed clock marks", () => {
    const occurrences = parseTakarazukaSchedule(
      schedulePage(
        `<table class="edgenone center">
      <tr><th colspan="2">日付</th><th>開演時間</th></tr>
      <tr><td></td></tr>
      <tr><th rowspan="2">9/12</th><th rowspan="2">土</th><td>★13:30</td></tr>
      <tr><td></td></tr>
      <tr><th>9/13</th><th>日</th><td>休演日</td></tr>
      <tr><th rowspan="2">9/14</th><th rowspan="2">月</th><td>貸切公演 ※1</td></tr>
      <tr><td>18:30(新人公演)</td></tr>
      <tr><th>9/15</th><td>貸切公演</td><td>11：00</td></tr>
      </table>`,
        "",
        `<p class="txt3">※1 9月14日（月）13:30開演は三井住友カードと宝塚友の会の共同開催となり、予定枚数に達しなかった場合にのみ、一般前売で販売いたします。</p>`,
      ),
      "2026-09-12",
      "2026-09-15",
    );
    expect(occurrences.map(({ startsAt }) => startsAt)).toEqual([
      "2026-09-12T13:30:00+09:00",
      "2026-09-14T18:30:00+09:00",
      "2026-09-15T11:00:00+09:00",
    ]);
  });

  it.each([
    "開演時刻調整中",
    "13:30 未確認",
    "貸切公演（中止）",
    "休演日（変更予定）",
    "★13:30（中止）",
    "13:30 15:30",
  ])("does not discard or partially read an unknown time cell: %s", (text) => {
    expect(() =>
      parseTakarazukaSchedule(
        schedulePage(
          `<table><tr><th>9/12</th><td>11:00</td></tr><tr><td>${text}</td></tr></table>`,
        ),
        "2026-09-12",
        "2026-09-12",
      ),
    ).toThrow("Official source parse failed");
  });

  it("does not carry a date into an unrelated table", () => {
    expect(
      parseTakarazukaSchedule(
        schedulePage(
          `<table><tr><th>9/12</th><td>13:30</td></tr></table>`,
          `<table><tr><td>連絡先 03:00</td></tr></table>`,
        ),
        "2026-09-12",
        "2026-09-12",
      ),
    ).toEqual([{ startsAt: "2026-09-12T13:30:00+09:00", endsAt: null }]);
  });

  it("keeps valid headerless and headed schedule tables on the same page", () => {
    expect(
      parseTakarazukaSchedule(
        schedulePage(`<table><tr><th rowspan="2">9/12</th><td>13:30</td></tr><tr><td></td></tr></table>
      <table><tr><th>日付</th><th>開演時間</th></tr><tr><th>9/13</th><td>11:00</td><td>貸切公演</td></tr></table>`),
        "2026-09-12",
        "2026-09-13",
      ),
    ).toEqual([
      { startsAt: "2026-09-12T13:30:00+09:00", endsAt: null },
      { startsAt: "2026-09-13T11:00:00+09:00", endsAt: null },
    ]);
  });

  it("rejects an unrelated table without a dated heading", () => {
    expect(() =>
      parseTakarazukaSchedule(
        schedulePage(`<table><tr><th>開演時間</th><td>13:30</td></tr></table>`),
        "2026-09-12",
        "2026-09-12",
      ),
    ).toThrow("Official source parse failed");
  });

  it("rejects a production when any venue block is only partially parseable", () => {
    expect(() =>
      parseTakarazukaIndex(
        source,
        `<div class="item"><a href="/sp/revue/2026/ponoichizoku/index.html"><p class="title">『ポーの一族』</p></a>
        <dl><dt>宝塚大劇場</dt><dd>2026年7月1日～8月1日</dd></dl>
        <dl><dt>東京宝塚劇場</dt><dd>日程調整中</dd></dl></div>`,
      ),
    ).toThrow();
  });

  it("does not expand the main-theater source to an unobserved venue", () => {
    expect(() =>
      parseTakarazukaIndex(
        source,
        `<div class="item"><a href="/sp/revue/2027/example/index.html"><p class="title">Example</p></a>
        <dl><dt>梅田芸術劇場</dt><dd>2027年4月3日～5月16日</dd></dl></div>`,
      ),
    ).toThrow("Official source parse failed");
  });
});

function schedulePage(tables: string, outside = "", notes = ""): string {
  return `<div id="contents"><article><div><h1>公演日程</h1></div>
    <section class="article02"><div class="table03">${notes}<div class="table01 list">${tables}</div></div></section>
    <section>${outside}</section></article></div>`;
}

async function expectInvalidSchedulePage(page: string) {
  expect(() =>
    parseTakarazukaSchedule(page, "2026-09-12", "2026-09-13"),
  ).toThrow("Official source parse failed");
  await expect(acquireSchedulePage(page)).rejects.toMatchObject({
    name: "SourceParseFailure",
    canonicalUrl:
      "https://kageki.hankyu.co.jp/sp/revue/2026/fictionalwork/schedule_takarazuka.html",
  });
}

function acquireSchedulePage(page: string) {
  if (source === null) throw new Error("test source missing");
  const detailUrl =
    "https://kageki.hankyu.co.jp/sp/revue/2026/fictionalwork/index.html";
  const scheduleUrl = new URL("schedule_takarazuka.html", detailUrl).href;
  const pages = new Map([
    [
      source.canonicalUrl,
      `<div class="item"><a href="${detailUrl}"><p class="title">『架空公演』</p></a><dl><dt>宝塚大劇場</dt><dd>2026年9月12日～13日</dd></dl></div>`,
    ],
    [
      detailUrl,
      `<title>星組公演 『架空公演』</title><a href="schedule_takarazuka.html">公演日程を見る</a>`,
    ],
    [scheduleUrl, page],
  ]);
  const adapter = createTakarazukaRevueAdapter(async (_source, url) => {
    const body = pages.get(url);
    if (body === undefined) throw new Error(`unexpected URL ${url}`);
    return document(url, body);
  });
  return adapter.acquire(source);
}

function document(url: string, body: string): OfficialHtmlDocument {
  return {
    url,
    body,
    observedAt: "2026-09-22T00:00:00.000Z",
    contentHash: "b".repeat(64),
    etag: null,
    lastModified: null,
  };
}
