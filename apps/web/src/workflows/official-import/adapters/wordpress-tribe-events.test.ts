import { describe, expect, it } from "vitest";
import { getOfficialSource } from "../source-registry";
import type { OfficialHtmlDocument } from "./http";
import { createWordpressTribeEventsAdapter } from "./wordpress-tribe-events";

const kyurushite = getOfficialSource("event.kyurushite.schedule");
const chumtoto = getOfficialSource("event.chumtoto.schedule");
if (kyurushite === null || chumtoto === null)
  throw new Error("test source missing");

function event(origin: string, id: number) {
  return {
    id,
    status: "publish",
    url: `${origin}/event/${id}/`,
    title: "Physical &amp; live",
    all_day: true,
    start_date: "2026-10-10 00:00:00",
    end_date: "2026-10-10 23:59:59",
    timezone: "Asia/Tokyo",
    hide_from_listings: false,
    venue: { venue: "Test Hall" },
  };
}

function document(url: string, body: unknown): OfficialHtmlDocument {
  return {
    url,
    body: JSON.stringify(body),
    observedAt: "2026-09-23T00:00:00.000Z",
    contentHash: "a".repeat(64),
    etag: null,
    lastModified: null,
  };
}

describe("WordPress Tribe Events family adapter", () => {
  it.each([
    [kyurushite, "kyurushite", "きゅるりんってしてみて"],
    [chumtoto, "chumtoto", "ChumToto"],
  ] as const)(
    "reuses the public API for %s without inventing all-day occurrence times",
    async (source, groupKey, groupName) => {
      const adapter = createWordpressTribeEventsAdapter(async (_source, url) =>
        document(url, {
          events: [event(source.allowedOrigin, 101)],
          total: 1,
          total_pages: 1,
        }),
      );

      const [draft] = await adapter.acquire(source);
      expect(draft?.candidateKind).toBe("event");
      if (draft?.candidateKind !== "event")
        throw new Error("event draft missing");
      expect(draft.officialExternalId).toBe("101");
      expect(draft.proposal).toMatchObject({
        sourceKey: `tribe:${new URL(source.canonicalUrl).hostname}:101`,
        title: "Physical & live",
        venue: "Test Hall",
        startsOn: "2026-10-10",
        endsOn: "2026-10-10",
        occurrences: [],
        groups: [{ key: groupKey, displayName: groupName }],
      });
    },
  );

  it("preserves explicit Tokyo time and paginates without duplicate IDs", async () => {
    const requests: string[] = [];
    const timed = {
      ...event(chumtoto.allowedOrigin, 102),
      all_day: false,
      start_date: "2026-10-11 18:30:00",
      end_date: "2026-10-11 20:00:00",
      venue: [],
    };
    const adapter = createWordpressTribeEventsAdapter(async (_source, url) => {
      requests.push(url);
      return document(url, {
        events: [
          requests.length === 1 ? event(chumtoto.allowedOrigin, 101) : timed,
        ],
        total: 2,
        total_pages: 2,
        next_rest_url:
          requests.length === 1
            ? `${chumtoto.allowedOrigin}/wp-json/tribe/events/v1/events/?page=2`
            : null,
      });
    });

    const drafts = await adapter.acquire(chumtoto);
    expect(requests).toHaveLength(2);
    expect(drafts).toHaveLength(2);
    expect(drafts[1]?.proposal).toMatchObject({
      venue: null,
      occurrences: [
        {
          doorsAt: null,
          startsAt: "2026-10-11T18:30:00+09:00",
          endsAt: "2026-10-11T20:00:00+09:00",
        },
      ],
    });
  });

  it("keeps an event hash stable when another API event changes", async () => {
    const acquire = async (otherTitle: string) => {
      const adapter = createWordpressTribeEventsAdapter(async (_source, url) =>
        document(url, {
          events: [
            event(kyurushite.allowedOrigin, 101),
            { ...event(kyurushite.allowedOrigin, 102), title: otherTitle },
          ],
          total: 2,
          total_pages: 1,
        }),
      );
      return adapter.acquire(kyurushite);
    };
    const first = await acquire("Another show");
    const second = await acquire("Updated show");
    expect(first[0]?.contentHash).toBe(second[0]?.contentHash);
    expect(first[1]?.contentHash).not.toBe(second[1]?.contentHash);
  });

  it("fails closed on a duplicate event ID across pages", async () => {
    let page = 0;
    const adapter = createWordpressTribeEventsAdapter(async (_source, url) => {
      page += 1;
      return document(url, {
        events: [event(chumtoto.allowedOrigin, 101)],
        total: 2,
        total_pages: 2,
        next_rest_url:
          page === 1
            ? `${chumtoto.allowedOrigin}/wp-json/tribe/events/v1/events/?page=2`
            : null,
      });
    });
    await expect(adapter.acquire(chumtoto)).rejects.toThrow();
  });

  it.each([
    {
      name: "foreign event URL",
      changed: { url: "https://attacker.example/event/101/" },
    },
    { name: "unknown timezone", changed: { timezone: "UTC" } },
    {
      name: "mismatched permalink ID",
      changed: { url: `${kyurushite.allowedOrigin}/event/202/` },
    },
    { name: "invalid date", changed: { start_date: "2026-02-30 00:00:00" } },
    { name: "unpublished event", changed: { status: "draft" } },
  ])("fails closed on $name", async ({ changed }) => {
    const adapter = createWordpressTribeEventsAdapter(async (_source, url) =>
      document(url, {
        events: [{ ...event(kyurushite.allowedOrigin, 101), ...changed }],
        total: 1,
        total_pages: 1,
        next_rest_url: null,
      }),
    );
    await expect(adapter.acquire(kyurushite)).rejects.toThrow();
  });

  it("fails closed if pagination claims more events but has no next page", async () => {
    const adapter = createWordpressTribeEventsAdapter(async (_source, url) =>
      document(url, {
        events: [event(kyurushite.allowedOrigin, 101)],
        total: 2,
        total_pages: 2,
        next_rest_url: null,
      }),
    );
    await expect(adapter.acquire(kyurushite)).rejects.toThrow();
  });

  it("rejects an API-provided next URL outside the collection path", async () => {
    const adapter = createWordpressTribeEventsAdapter(async (_source, url) =>
      document(url, {
        events: [event(kyurushite.allowedOrigin, 101)],
        total: 2,
        total_pages: 2,
        next_rest_url: `${kyurushite.allowedOrigin}/wp-json/tribe/events/v1/events/101/`,
      }),
    );
    await expect(adapter.acquire(kyurushite)).rejects.toThrow();
  });
});
