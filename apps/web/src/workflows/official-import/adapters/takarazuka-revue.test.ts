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
