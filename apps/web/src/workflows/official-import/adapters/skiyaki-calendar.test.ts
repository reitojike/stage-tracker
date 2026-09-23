import { describe, expect, it } from "vitest";
import { getOfficialSource } from "../source-registry";
import {
  createSkiyakiCalendarAdapter,
  parseSkiyakiCalendar,
} from "./skiyaki-calendar";
import type { OfficialHtmlDocument } from "./http";

const source = getOfficialSource("event.cynhn.calendar");
if (source === null) throw new Error("test source missing");

describe("SKIYAKI calendar parser", () => {
  it.each([
    {
      sourceId: "event.meme-tokyo.calendar",
      rawDate: "2026年 09月 05日",
      group: { key: "meme-tokyo", displayName: "MEME TOKYO." },
    },
    {
      sourceId: "event.arcana-project.calendar",
      rawDate: "2026-09-05",
      group: { key: "arcana-project", displayName: "ARCANA PROJECT" },
    },
  ])(
    "reuses the family adapter for $sourceId",
    async ({ sourceId, rawDate, group }) => {
      const additionalSource = getOfficialSource(sourceId);
      if (additionalSource === null) throw new Error("test source missing");
      const adapter = createSkiyakiCalendarAdapter(async (_source, url) =>
        document(
          url,
          url === additionalSource.canonicalUrl
            ? `<li class="list-group-item"><time datetime="${rawDate}"></time><a href="/contents/101" class="tag-event"><span class="fc-event-inner">Physical live</span></a></li>`
            : `<meta property="og:description" content="会場：Test Hall OPEN 18:00 START 19:00">`,
        ),
      );

      const [draft] = await adapter.acquire(additionalSource);
      expect(draft?.candidateKind).toBe("event");
      if (draft?.candidateKind !== "event")
        throw new Error("event draft missing");
      expect(draft.proposal.sourceKey).toBe(
        `skiyaki:${new URL(additionalSource.canonicalUrl).hostname}:101`,
      );
      expect(draft.proposal.startsOn).toBe("2026-09-05");
      expect(draft.proposal.groups).toEqual([group]);
      expect(draft.proposal.occurrences).toEqual([
        {
          doorsAt: "2026-09-05T18:00:00+09:00",
          startsAt: "2026-09-05T19:00:00+09:00",
          endsAt: null,
        },
      ]);
    },
  );

  it("fails closed on an invalid Japanese calendar date", () => {
    const memeSource = getOfficialSource("event.meme-tokyo.calendar");
    if (memeSource === null) throw new Error("test source missing");
    expect(() =>
      parseSkiyakiCalendar(
        memeSource,
        `<li class="list-group-item tag-event"><time datetime="2026年 02月 30日"></time><a href="/contents/101">Invalid day</a></li>`,
      ),
    ).toThrow();
  });

  it("uses the host and stable content id without inventing a missing time", async () => {
    const adapter = createSkiyakiCalendarAdapter(async (_source, url) => {
      const body =
        url === source.canonicalUrl
          ? `<li class="list-group-item tag-live"><time datetime="2026-10-10"></time><a href="/contents/101"><span class="fc-event-inner">Physical live</span></a></li>`
          : `<meta property="og:description" content="会場：Spotify O-WEST">`;
      return document(url, body);
    });
    const [draft] = await adapter.acquire(source);
    expect(draft?.candidateKind).toBe("event");
    if (draft?.candidateKind !== "event")
      throw new Error("event draft missing");
    expect(draft.proposal.sourceKey).toBe("skiyaki:cynhn.com:101");
    expect(draft.proposal.occurrences).toEqual([]);
  });

  it("separates physical, online, media, and release rows with stable content ids", () => {
    const facts = parseSkiyakiCalendar(
      source,
      `
      <ul>
        <li class="list-group-item tag-live"><time datetime="2026-10-10"></time><a href="/contents/101"><span class="fc-event-inner">Physical live</span></a></li>
        <li class="list-group-item tag-live_stream"><time datetime="2026-10-11"></time><a href="/contents/102"><span class="fc-event-inner">Stream</span></a></li>
        <li class="list-group-item tag-media"><time datetime="2026-10-12"></time><a href="/contents/103"><span class="fc-event-inner">Radio</span></a></li>
        <li class="list-group-item tag-release"><time datetime="2026-10-13"></time><a href="/contents/104"><span class="fc-event-inner">New release</span></a></li>
      </ul>`,
    );
    expect(
      facts.map(({ officialId, relevance }) => ({ officialId, relevance })),
    ).toEqual([
      { officialId: "101", relevance: "physical_event" },
      { officialId: "102", relevance: "online_only" },
      { officialId: "103", relevance: "media" },
      { officialId: "104", relevance: "release" },
    ]);
  });

  it("fails closed when calendar rows exist but required identity facts are malformed", () => {
    expect(() =>
      parseSkiyakiCalendar(
        source,
        `<li class="list-group-item tag-live"><a href="/contents/nope">broken</a></li>`,
      ),
    ).toThrow();
  });
});

function document(url: string, body: string): OfficialHtmlDocument {
  return {
    url,
    body,
    observedAt: "2026-09-22T00:00:00.000Z",
    contentHash: "c".repeat(64),
    etag: null,
    lastModified: null,
  };
}
