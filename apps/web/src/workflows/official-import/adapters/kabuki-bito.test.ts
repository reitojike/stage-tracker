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
        `<p class="text type-timetable">昼の部 午前11時～</p><p class="text type-theater">歌舞伎座</p>
         <table><tr><th>1（木）</th><td>11：00</td></tr><tr><th>2（金）</th><td>11：00</td></tr></table>`,
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
        `<p class="text type-timetable">昼の部 午前11時～</p><p class="text type-theater">歌舞伎座</p>
         <table><tr><th>1（木）</th><td>11：00</td></tr><tr><th>2（金）</th><td>11：00</td></tr></table>`,
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

  it("uses daily table cells instead of inventing shows on closed or partial days", () => {
    const occurrences = parseKabukiDetailedOccurrences(
      `<table><tr><th>日</th><th>第一部</th><th>第二部</th></tr>
       <tr><th>1（木）</th><td>11：00</td><td>16：00</td></tr>
       <tr><th>3（土）</th><td>11：00</td><td>-</td></tr>
       <tr><th>4（日）</th><td>貸切</td><td>貸切</td></tr></table>`,
      "2026-10-01",
      "2026-10-04",
      "第一部 午前11時 第二部 午後4時",
    );
    expect(occurrences.map((item) => item.startsAt)).toEqual([
      "2026-10-01T11:00:00+09:00",
      "2026-10-01T16:00:00+09:00",
      "2026-10-03T11:00:00+09:00",
    ]);
  });

  it("maps explicit per-date headline times without expanding them across the range", () => {
    const occurrences = parseKabukiDetailedOccurrences(
      "<div></div>",
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
        "<div></div>",
        "2026-10-01",
        "2026-10-25",
        "第一部 午前11時 第二部 午後4時",
      ),
    ).toThrow(SourceParseFailure);
  });
});

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
