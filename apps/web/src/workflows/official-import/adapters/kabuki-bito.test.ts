import { describe, expect, it, vi } from "vitest";
import { getOfficialSource } from "../source-registry";
import {
  createKabukiBitoAdapter,
  expandKabukiSchedule,
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
        `<p class="text type-timetable">昼の部 午前11時～</p><p class="text type-theater">歌舞伎座</p>`,
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
        `<p class="text type-timetable">昼の部 午前11時～</p><p class="text type-theater">歌舞伎座</p>`,
      );
    }, pause);

    expect(await adapter.acquire(source)).toHaveLength(5);
    expect(peak).toBe(2);
    expect(pause).toHaveBeenCalledTimes(2);
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

  it("rejects a timetable without deterministic part times", () => {
    expect(() =>
      expandKabukiSchedule("2026-10-01", "2026-10-02", "時間未定"),
    ).toThrow();
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
