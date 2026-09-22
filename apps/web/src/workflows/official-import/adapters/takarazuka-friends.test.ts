import { describe, expect, it, vi } from "vitest";
import { ProviderUnavailableFailure, SourceParseFailure } from "../acquisition";
import { getOfficialSource } from "../source-registry";
import {
  createFirecrawlPdfProvider,
  parseFirecrawlTakarazukaResponse,
} from "./firecrawl-pdf";
import { takarazukaFriendsDrafts } from "./takarazuka-friends";

const source = getOfficialSource("ticket.takarazuka-friends.schedule-pdf");
if (source === null) throw new Error("test source missing");

const extraction = {
  productions: [
    {
      title: "Example Production",
      venue: "宝塚大劇場",
      startsOn: "2026-10-01",
      endsOn: "2026-11-10",
      opportunities: [
        {
          phase: "lottery1" as const,
          displayName: "第1抽選方式",
          applicationStartDate: "2026-08-12",
          applicationEndDate: "2026-08-14",
          resultAnnouncementDate: null,
          saleStartDate: null,
          evidencePageNumber: 1,
        },
        {
          phase: "general_sale" as const,
          displayName: "一般前売",
          applicationStartDate: null,
          applicationEndDate: null,
          resultAnnouncementDate: null,
          saleStartDate: "2026-09-26",
          evidencePageNumber: 1,
        },
      ],
    },
  ],
};

describe("Takarazuka Friends PDF adapter", () => {
  it("separates phases and maps date-only facts without inventing times", () => {
    const drafts = takarazukaFriendsDrafts(extraction, {
      url: source.canonicalUrl,
      observedAt: "2026-09-22T00:00:00.000Z",
      contentHash: "a".repeat(64),
      etag: null,
      lastModified: null,
    });
    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.proposal).toMatchObject({
      displayName: "第1抽選方式",
      milestones: [
        {
          type: "application_open",
          precision: "date",
          date: "2026-08-12",
        },
        {
          type: "application_close",
          precision: "date",
          date: "2026-08-14",
        },
      ],
    });
    expect(
      JSON.stringify(
        drafts.flatMap((draft) => draft.proposal.milestones ?? []),
      ),
    ).not.toContain("T00:00");
    expect(drafts[1]?.proposal).toMatchObject({
      displayName: "一般前売",
      milestones: [
        {
          type: "sale_start",
          precision: "date",
          date: "2026-09-26",
        },
      ],
    });
    expect(drafts[0]?.proposal.sourceKey).not.toBe(
      drafts[1]?.proposal.sourceKey,
    );
  });

  it("accepts only strict schema-shaped provider output", () => {
    expect(
      parseFirecrawlTakarazukaResponse({
        success: true,
        data: { json: extraction },
      }),
    ).toEqual(extraction);
    expect(() =>
      parseFirecrawlTakarazukaResponse({
        success: true,
        data: {
          json: {
            ...extraction,
            productions: [
              { ...extraction.productions[0], inventedTime: "10:00" },
            ],
          },
        },
      }),
    ).toThrow(SourceParseFailure);
    expect(() =>
      parseFirecrawlTakarazukaResponse({
        success: true,
        data: {
          json: {
            productions: [
              {
                ...extraction.productions[0],
                opportunities: [
                  {
                    ...extraction.productions[0]?.opportunities[0],
                    evidencePageNumber: 51,
                  },
                ],
              },
            ],
          },
        },
      }),
    ).toThrow(SourceParseFailure);
  });

  it("bounds Firecrawl v2 parse and fails closed without a credential", async () => {
    const transport = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(init?.headers).toEqual({ Authorization: "Bearer secret" });
        if (!(init?.body instanceof FormData)) throw new Error("missing form");
        const options = init.body.get("options");
        expect(typeof options).toBe("string");
        if (typeof options !== "string") throw new Error("missing options");
        expect(JSON.parse(options)).toMatchObject({
          formats: [{ type: "json" }],
          parsers: [{ type: "pdf", maxPages: 50, pages: true, blocks: true }],
        });
        return new Response(
          JSON.stringify({ success: true, data: { json: extraction } }),
          { status: 200 },
        );
      },
    );
    await expect(
      createFirecrawlPdfProvider("secret", transport).extractTakarazukaFriends(
        new TextEncoder().encode("synthetic"),
      ),
    ).resolves.toEqual(extraction);
    expect(transport).toHaveBeenCalledOnce();
    await expect(
      createFirecrawlPdfProvider(undefined).extractTakarazukaFriends(
        new Uint8Array(),
      ),
    ).rejects.toBeInstanceOf(ProviderUnavailableFailure);
  });
});
