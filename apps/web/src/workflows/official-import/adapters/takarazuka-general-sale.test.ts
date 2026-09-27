import { describe, expect, it } from "vitest";
import { getOfficialSource } from "../source-registry";
import { createTakarazukaGeneralSaleAdapter } from "./takarazuka-general-sale";
import type { OfficialHtmlDocument } from "./http";

const source = getOfficialSource("ticket.takarazuka.revue-general-sale");
if (source === null) throw new Error("test source missing");

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
    const ticket = `<div class="set"><h4>宝塚友の会</h4><p class="txt">
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
    await expect(adapter.acquire(source)).rejects.toThrow(
      "Official source parse failed",
    );
  });
});
