import { describe, expect, it } from "vitest";
import { getOfficialSource } from "../source-registry";
import { createTakarazukaGeneralSaleAdapter } from "./takarazuka-general-sale";
import type { OfficialHtmlDocument } from "./http";

const source = getOfficialSource("ticket.takarazuka.revue-general-sale");
if (source === null) throw new Error("test source missing");

const unpublishedPlus = `<div class="set"><h4>宝塚歌劇共通ID＋（プラス）</h4><p class="txt">一般前売に先がけてチケット先行販売を実施いたします。<br>詳細が決まり次第掲載いたします。</p></div>`;
const londonFriends = `<div class="set"><h4>宝塚友の会</h4><p class="txt">
■「第1抽選方式」申込期間：11月28日（土）10:00〜11月29日（日）23:00 結果照会：12月2日（水）10:00〜
■「第2抽選方式」申込期間：12月4日（金）10:00〜12月5日（土）23:00 結果照会：12月8日（火）10:00〜
■「第3抽選方式」申込期間：12月9日（水）10:00〜12月10日（木）23:00 結果照会：12月13日（日）10:00〜
</p></div>`;
const publishedPlus = `<div class="set"><h4>宝塚歌劇共通ID＋（プラス）</h4><p class="txt">■「抽選方式」申込期間：12月15日（火）10:00〜12月16日（水）23:00 結果照会：12月19日（土）10:00〜</p></div>`;
function londonAdapter(ticket: () => string) {
  return createTakarazukaGeneralSaleAdapter(async (_source, url) => ({
    url,
    body: url.endsWith("ticket_takarazuka.html")
      ? ticket()
      : url.endsWith("thelondonway/index.html")
        ? `<a href="/sp/revue/2027/thelondonway/ticket_takarazuka.html">チケット</a>`
        : `<div class="item"><a href="/sp/revue/2027/thelondonway/index.html"><p class="title">『The London Way』</p></a><dl><dt>宝塚大劇場</dt><dd>2027年1月30日～3月14日 一般前売：2027年1月9日</dd></dl></div>`,
    observedAt: "2026-10-15T00:00:00.000Z",
    contentHash: "a".repeat(64),
    etag: null,
    lastModified: null,
  }));
}

describe("Takarazuka general-sale index adapter", () => {
  it("fails closed when a published general-sale field cannot be parsed", async () => {
    const adapter = createTakarazukaGeneralSaleAdapter(
      async (_source, url): Promise<OfficialHtmlDocument> => ({
        url,
        body: `<div class="item"><a href="/sp/revue/2026/example/index.html"><p class="title">Example</p></a>
          <dl><dt>宝塚大劇場</dt><dd>2026年10月17日～11月22日 一般前売 2026年9月26日</dd></dl></div>`,
        observedAt: "2026-09-27T00:00:00.000Z",
        contentHash: "a".repeat(64),
        etag: null,
        lastModified: null,
      }),
    );
    await expect(adapter.acquire(source)).rejects.toThrow(
      "Official source parse failed",
    );
  });

  it("stages separate date-only general sales for each published venue", async () => {
    const index = `<div class="item">
      <a href="/sp/revue/2026/elisabeth/index.html"><p class="title">エリザベート</p></a>
      <dl><dt>宝塚大劇場</dt><dd>2026年10月17日～11月22日 一般前売：2026年9月26日</dd></dl>
      <dl><dt>東京宝塚劇場</dt><dd>2026年12月19日～2027年2月7日 一般前売：2026年11月15日</dd></dl>
      <dl><dt>主な出演者</dt><dd>出演者名</dd></dl>
    </div>`;
    const adapter = createTakarazukaGeneralSaleAdapter(
      async (_source, url): Promise<OfficialHtmlDocument> => ({
        url,
        body: index,
        observedAt: "2026-09-27T00:00:00.000Z",
        contentHash: "a".repeat(64),
        etag: null,
        lastModified: null,
      }),
    );
    const drafts = await adapter.acquire(source);
    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => draft.proposal)).toEqual([
      expect.objectContaining({
        eventSourceKey: "takarazuka:2026:elisabeth:takarazuka",
        sourceKey: "takarazuka:2026:elisabeth:takarazuka:general-sale",
        milestones: [
          { type: "sale_start", precision: "date", date: "2026-09-26" },
        ],
      }),
      expect.objectContaining({
        eventSourceKey: "takarazuka:2026:elisabeth:tokyo",
        sourceKey: "takarazuka:2026:elisabeth:tokyo:general-sale",
        milestones: [
          { type: "sale_start", precision: "date", date: "2026-11-15" },
        ],
      }),
    ]);
  });

  it("stages the observed friends and common-ID lotteries from a linked ticket page", async () => {
    const index = `<div class="item">
      <a href="/sp/revue/2026/elisabeth/index.html"><p class="title">『エリザベート』</p></a>
      <dl><dt>宝塚大劇場</dt><dd>2026年10月17日～11月22日 一般前売：2026年9月26日</dd></dl>
    </div>`;
    const detail = `<a href="/sp/revue/2026/elisabeth/ticket_takarazuka.html">チケット</a>`;
    const ticket = `<div class="set"><h4>架空の会場案内</h4><p class="txt">Fictional venue information.</p></div>
    <div class="set"><h4>宝塚友の会</h4><p class="txt">
      ■「第1抽選方式」<br>申込期間：8月8日（土）10:00〜8月9日（日）23:00<br>結果照会：8月12日（水）10:00〜<br>
      ■「第2抽選方式」<br>申込期間：8月14日（金）10:00〜8月15日（土）23:00<br>結果照会：8月18日（火）10:00〜<br>
      ■「第3抽選方式」<br>申込期間：8月19日（水）10:00〜8月20日（木）23:00<br>結果照会：8月23日（日）10:00〜
    </p></div><div class="set"><h4>宝塚歌劇共通ID＋（プラス）</h4><p class="txt">
      ■「抽選方式」<br>申込期間：8月25日（火）10:00〜8月26日（水）23:00<br>結果照会：8月29日（土）10:00〜
    </p></div>`;
    const fetched: string[] = [];
    const adapter = createTakarazukaGeneralSaleAdapter(
      async (_source, url): Promise<OfficialHtmlDocument> => {
        fetched.push(url);
        return {
          url,
          body: url.endsWith("ticket_takarazuka.html")
            ? ticket
            : url.endsWith("elisabeth/index.html")
              ? detail
              : index,
          observedAt: "2026-09-27T00:00:00.000Z",
          contentHash: "a".repeat(64),
          etag: null,
          lastModified: null,
        };
      },
    );
    const drafts = await adapter.acquire(source);
    expect(fetched).toHaveLength(3);
    expect(drafts).toHaveLength(5);
    expect(drafts.map((draft) => draft.proposal.sourceKey)).toEqual([
      "takarazuka:2026:elisabeth:takarazuka:general-sale",
      "takarazuka:2026:elisabeth:takarazuka:friends-lottery-1",
      "takarazuka:2026:elisabeth:takarazuka:friends-lottery-2",
      "takarazuka:2026:elisabeth:takarazuka:friends-lottery-3",
      "takarazuka:2026:elisabeth:takarazuka:common-id-plus-lottery",
    ]);
    expect(drafts[1]?.proposal).toEqual(
      expect.objectContaining({
        eventSourceKey: "takarazuka:2026:elisabeth:takarazuka",
        displayName: "宝塚友の会 第1抽選方式",
        sourceUrl:
          "https://kageki.hankyu.co.jp/sp/revue/2026/elisabeth/ticket_takarazuka.html",
        milestones: [
          {
            type: "application_open",
            precision: "datetime",
            at: "2026-08-08T10:00:00+09:00",
          },
          {
            type: "application_close",
            precision: "datetime",
            at: "2026-08-09T23:00:00+09:00",
          },
          {
            type: "result_announcement",
            precision: "datetime",
            at: "2026-08-12T10:00:00+09:00",
          },
        ],
      }),
    );
    expect(drafts[4]).toMatchObject({
      proposal: { displayName: "宝塚歌劇共通ID＋ 抽選方式" },
    });
    expect(drafts[1]).toMatchObject({
      evidenceLocator: { sectionLabel: "宝塚大劇場 / 宝塚友の会" },
    });
  });

  it("resolves December lotteries before a January general sale to the previous year", async () => {
    const index = `<div class="item"><a href="/sp/revue/2026/tenkyuunoartemis/index.html"><p class="title">『天穹のアルテミス』</p></a>
      <dl><dt>東京宝塚劇場</dt><dd>2027年2月13日～3月28日 一般前売：2027年1月17日</dd></dl></div>`;
    const adapter = createTakarazukaGeneralSaleAdapter(
      async (_source, url): Promise<OfficialHtmlDocument> => ({
        url,
        body: url.endsWith("ticket_tokyo.html")
          ? `<div class="set"><h4>宝塚友の会</h4><p class="txt">■「第1抽選方式」申込期間：12月5日（土）10:00〜12月6日（日）23:00 結果照会：12月9日（水）10:00〜</p></div>`
          : url.endsWith("tenkyuunoartemis/index.html")
            ? `<a href="/sp/revue/2026/tenkyuunoartemis/ticket_tokyo.html">チケット</a>`
            : index,
        observedAt: "2026-09-27T00:00:00.000Z",
        contentHash: "a".repeat(64),
        etag: null,
        lastModified: null,
      }),
    );
    const drafts = await adapter.acquire(source);
    expect(drafts).toHaveLength(2);
    expect(drafts[1]?.proposal).toMatchObject({
      milestones: [
        {
          type: "application_open",
          precision: "datetime",
          at: "2026-12-05T10:00:00+09:00",
        },
        {
          type: "application_close",
          precision: "datetime",
          at: "2026-12-06T23:00:00+09:00",
        },
        {
          type: "result_announcement",
          precision: "datetime",
          at: "2026-12-09T10:00:00+09:00",
        },
      ],
    });
  });

  it("holds lottery dates after the January general sale instead of assigning them to the prior year", async () => {
    const index = `<div class="item"><a href="/sp/revue/2026/tenkyuunoartemis/index.html"><p class="title">『天穹のアルテミス』</p></a>
      <dl><dt>東京宝塚劇場</dt><dd>2027年2月13日～3月28日 一般前売：2027年1月17日</dd></dl></div>`;
    const adapter = createTakarazukaGeneralSaleAdapter(
      async (_source, url): Promise<OfficialHtmlDocument> => ({
        url,
        body: url.endsWith("ticket_tokyo.html")
          ? `<div class="set"><h4>宝塚友の会</h4><p class="txt">■「第1抽選方式」申込期間：1月18日（月）10:00〜1月19日（火）23:00 結果照会：1月20日（水）10:00〜</p></div>`
          : url.endsWith("tenkyuunoartemis/index.html")
            ? `<a href="/sp/revue/2026/tenkyuunoartemis/ticket_tokyo.html">チケット</a>`
            : index,
        observedAt: "2026-09-27T00:00:00.000Z",
        contentHash: "a".repeat(64),
        etag: null,
        lastModified: null,
      }),
    );
    await expect(adapter.acquire(source)).rejects.toThrow(
      "Official source parse failed",
    );
  });

  it("holds a linked ticket page with an unreadable lottery time", async () => {
    const index = `<div class="item"><a href="/sp/revue/2026/elisabeth/index.html"><p class="title">『エリザベート』</p></a>
      <dl><dt>宝塚大劇場</dt><dd>2026年10月17日～11月22日 一般前売：2026年9月26日</dd></dl></div>`;
    const adapter = createTakarazukaGeneralSaleAdapter(
      async (_source, url): Promise<OfficialHtmlDocument> => ({
        url,
        body: url.endsWith("ticket_takarazuka.html")
          ? `<div class="set"><h4>宝塚友の会</h4><p class="txt">■「第1抽選方式」申込期間：8月8日（土）10:00〜8月9日（日）未定 結果照会：8月12日（水）10:00〜</p></div>`
          : url.endsWith("elisabeth/index.html")
            ? `<a href="/sp/revue/2026/elisabeth/ticket_takarazuka.html">チケット</a>`
            : index,
        observedAt: "2026-09-27T00:00:00.000Z",
        contentHash: "a".repeat(64),
        etag: null,
        lastModified: null,
      }),
    );
    await expect(adapter.acquire(source)).rejects.toMatchObject({
      name: "SourceParseFailure",
      canonicalUrl:
        "https://kageki.hankyu.co.jp/sp/revue/2026/elisabeth/ticket_takarazuka.html",
    });
  });

  it("holds a supported lottery section when its published text has no phase marker", async () => {
    const index = `<div class="item"><a href="/sp/revue/2027/fictionalwork/index.html"><p class="title">Fictional Work</p></a>
      <dl><dt>宝塚大劇場</dt><dd>2027年4月3日～5月16日 一般前売：2027年3月7日</dd></dl></div>`;
    const adapter = createTakarazukaGeneralSaleAdapter(
      async (_source, url): Promise<OfficialHtmlDocument> => ({
        url,
        body: url.endsWith("ticket_takarazuka.html")
          ? `<div class="set"><h4>宝塚友の会</h4><p class="txt">申込期間：6月3日まで</p></div>`
          : url.endsWith("fictionalwork/index.html")
            ? `<a href="/sp/revue/2027/fictionalwork/ticket_takarazuka.html">Ticket</a>`
            : index,
        observedAt: "2026-10-01T00:00:00.000Z",
        contentHash: "c".repeat(64),
        etag: null,
        lastModified: null,
      }),
    );

    await expect(adapter.acquire(source)).rejects.toMatchObject({
      name: "SourceParseFailure",
      canonicalUrl:
        "https://kageki.hankyu.co.jp/sp/revue/2027/fictionalwork/ticket_takarazuka.html",
    });
  });

  it("holds lottery evidence under an unrecognized ticket heading", async () => {
    const index = `<div class="item"><a href="/sp/revue/2027/fictionalwork/index.html"><p class="title">Fictional Work</p></a>
      <dl><dt>宝塚大劇場</dt><dd>2027年4月3日～5月16日 一般前売：2027年3月7日</dd></dl></div>`;
    const adapter = createTakarazukaGeneralSaleAdapter(
      async (_source, url): Promise<OfficialHtmlDocument> => ({
        url,
        body: url.endsWith("ticket_takarazuka.html")
          ? `<div class="set"><h4>架空の先行抽選</h4><p class="txt">受付情報を掲載</p></div>`
          : url.endsWith("fictionalwork/index.html")
            ? `<a href="/sp/revue/2027/fictionalwork/ticket_takarazuka.html">Ticket</a>`
            : index,
        observedAt: "2026-10-01T00:00:00.000Z",
        contentHash: "d".repeat(64),
        etag: null,
        lastModified: null,
      }),
    );

    await expect(adapter.acquire(source)).rejects.toMatchObject({
      name: "SourceParseFailure",
      canonicalUrl:
        "https://kageki.hankyu.co.jp/sp/revue/2027/fictionalwork/ticket_takarazuka.html",
    });
  });

  it("holds a supported lottery block whose text is empty", async () => {
    const index = `<div class="item"><a href="/sp/revue/2027/fictionalwork/index.html"><p class="title">Fictional Work</p></a>
      <dl><dt>宝塚大劇場</dt><dd>2027年4月3日～5月16日 一般前売：2027年3月7日</dd></dl></div>`;
    const adapter = createTakarazukaGeneralSaleAdapter(
      async (_source, url): Promise<OfficialHtmlDocument> => ({
        url,
        body: url.endsWith("ticket_takarazuka.html")
          ? `<div class="set"><h4>宝塚友の会</h4><p class="txt"></p></div>`
          : url.endsWith("fictionalwork/index.html")
            ? `<a href="/sp/revue/2027/fictionalwork/ticket_takarazuka.html">Ticket</a>`
            : index,
        observedAt: "2026-10-01T00:00:00.000Z",
        contentHash: "e".repeat(64),
        etag: null,
        lastModified: null,
      }),
    );

    await expect(adapter.acquire(source)).rejects.toMatchObject({
      name: "SourceParseFailure",
      canonicalUrl:
        "https://kageki.hankyu.co.jp/sp/revue/2027/fictionalwork/ticket_takarazuka.html",
    });
  });

  it("returns only the general sale when no supported lottery section is published", async () => {
    const index = `<div class="item"><a href="/sp/revue/2027/fictionalwork/index.html"><p class="title">Fictional Work</p></a>
      <dl><dt>宝塚大劇場</dt><dd>2027年4月3日～5月16日 一般前売：2027年3月7日</dd></dl></div>`;
    const adapter = createTakarazukaGeneralSaleAdapter(
      async (_source, url): Promise<OfficialHtmlDocument> => ({
        url,
        body: url.endsWith("ticket_takarazuka.html")
          ? `<div class="set"><h4>架空の会場案内</h4><p class="txt">Fictional venue information.</p></div>`
          : url.endsWith("fictionalwork/index.html")
            ? `<a href="/sp/revue/2027/fictionalwork/ticket_takarazuka.html">Ticket</a>`
            : index,
        observedAt: "2026-10-01T00:00:00.000Z",
        contentHash: "f".repeat(64),
        etag: null,
        lastModified: null,
      }),
    );

    const drafts = await adapter.acquire(source);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.proposal.sourceKey).toBe(
      "takarazuka:2027:fictionalwork:takarazuka:general-sale",
    );
  });
});

describe("observed unpublished common-ID announcement", () => {
  it("keeps the general sale and three London Friends lotteries without inventing common-ID dates", async () => {
    const drafts = await londonAdapter(
      () => londonFriends + unpublishedPlus,
    ).acquire(source);
    expect(drafts.map((d) => d.proposal.sourceKey)).toEqual([
      "takarazuka:2027:thelondonway:takarazuka:general-sale",
      "takarazuka:2027:thelondonway:takarazuka:friends-lottery-1",
      "takarazuka:2027:thelondonway:takarazuka:friends-lottery-2",
      "takarazuka:2027:thelondonway:takarazuka:friends-lottery-3",
    ]);
    expect(drafts[1]?.proposal).toMatchObject({
      milestones: [
        {
          type: "application_open",
          precision: "datetime",
          at: "2026-11-28T10:00:00+09:00",
        },
        {},
        {},
      ],
    });
    expect(drafts[3]?.proposal).toMatchObject({
      milestones: [
        {},
        {},
        {
          type: "result_announcement",
          precision: "datetime",
          at: "2026-12-13T10:00:00+09:00",
        },
      ],
    });
  });
  it("adds the ordinary stable common-ID identity when a later snapshot publishes complete facts", async () => {
    let plus = unpublishedPlus;
    const adapter = londonAdapter(() => londonFriends + plus);
    expect(await adapter.acquire(source)).toHaveLength(4);
    plus = publishedPlus;
    const next = await adapter.acquire(source);
    expect(next).toHaveLength(5);
    expect(next[4]?.proposal.sourceKey).toBe(
      "takarazuka:2027:thelondonway:takarazuka:common-id-plus-lottery",
    );
    expect(next[4]?.proposal).toMatchObject({
      milestones: [
        {
          type: "application_open",
          precision: "datetime",
          at: "2026-12-15T10:00:00+09:00",
        },
        {},
        {},
      ],
    });
  });
  it.each([
    unpublishedPlus.replace("詳細が決まり次第掲載いたします。", "未定です。"),
    unpublishedPlus.replace("</p>", "申込期間：12月15日10:00</p>"),
    unpublishedPlus.replace("</p>", "受付中止</p>"),
    unpublishedPlus.replace('<p class="txt">', '<p class="txt" hidden>'),
    unpublishedPlus.replace(
      "詳細が決まり次第掲載いたします。",
      "<s>詳細が決まり次第掲載いたします。</s>",
    ),
    unpublishedPlus.replace("<br>", '<br title="変更">'),
    unpublishedPlus.replace("<br>", ""),
    unpublishedPlus.replace("<br>", "<br><br>"),
    unpublishedPlus.replace(
      "詳細が決まり次第掲載いたします。</p>",
      "</p>詳細が決まり次第掲載いたします。",
    ),
    unpublishedPlus.replace(
      '<p class="txt">一般前売に先がけてチケット先行販売を実施いたします。',
      '一般前売に先がけてチケット先行販売を実施いたします。<p class="txt">',
    ),
    unpublishedPlus.replace("</p>", "</p><p>申込期間が変更されました。</p>"),
    unpublishedPlus.replace("</div>", "<h4>申込開始</h4></div>"),
    unpublishedPlus + unpublishedPlus,
    unpublishedPlus + publishedPlus,
    publishedPlus + unpublishedPlus,
    unpublishedPlus.replace("宝塚歌劇共通ID＋（プラス）", "宝塚友の会"),
    unpublishedPlus.replace('<p class="txt">', '<p class="txt unknown">'),
    unpublishedPlus.replace(
      "一般前売に先がけてチケット先行販売を実施いたします。<br>詳細が決まり次第掲載いたします。",
      "",
    ),
  ])("holds every unsupported or contradictory announcement", async (plus) => {
    await expect(
      londonAdapter(() => londonFriends + plus).acquire(source),
    ).rejects.toMatchObject({
      name: "SourceParseFailure",
      canonicalUrl:
        "https://kageki.hankyu.co.jp/sp/revue/2027/thelondonway/ticket_takarazuka.html",
    });
  });
  it("does not hide malformed published Friends facts next to the known unpublished notice", async () => {
    await expect(
      londonAdapter(
        () =>
          londonFriends.replace("11月29日（日）23:00", "11月29日（日）未定") +
          unpublishedPlus,
      ).acquire(source),
    ).rejects.toThrow("Official source parse failed");
  });
});
