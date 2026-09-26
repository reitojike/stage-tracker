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
        `<dl class="revueInfo accordion"><dt class="acc-trigger">東京宝塚劇場 [東京都]</dt>
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
        `<dl class="revueInfo accordion"><dt class="acc-trigger">東京宝塚劇場 [東京都]</dt>
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
            ? `<a href="schedule_tokyo.html">日程</a>`
            : `<table><tr><th>4/3</th><td>13:30</td></tr></table>`;
      return document(url, body);
    });
    await expect(adapter.acquire(source)).rejects.toThrow(
      "Official source parse failed",
    );
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
        `<a href="schedule_tokyo.html">日程</a><a href="schedule_tokyo.html">日程</a>`,
      ],
      [scheduleUrl, `<table><tr><th>9/12</th><td>13:30</td></tr></table>`],
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
        `<a href="schedule_tokyo.html">東京公演日程</a>`,
      ],
      [
        "https://kageki.hankyu.co.jp/sp/revue/2026/ponoichizoku/schedule_tokyo.html",
        `<table><tr><th>9/12</th><td>13:30</td></tr></table>`,
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
    expect(draft.proposal.occurrences).toEqual([
      { startsAt: "2026-09-12T13:30:00+09:00", endsAt: null },
    ]);
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
      `<table><tr><th>9/12</th><td>13:30</td><td>貸切公演</td></tr><tr><th>9/13</th><td>11:00</td><td>15:30</td></tr></table>`,
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
        "<table><tr><th>9/12</th><td>休演日</td></tr></table>",
        "2026-09-12",
        "2026-09-12",
      ),
    ).toThrow();
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
