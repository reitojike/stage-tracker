import { describe, expect, it } from "vitest";
import { SourceParseFailure } from "../acquisition";
import type { TicketOpportunityAcquisitionDraft } from "../acquisition";
import { getOfficialSource } from "../source-registry";
import { parseKabukiGeneralSale } from "./kabuki-ticket-sales";
import { createShochikuTicketAdapter } from "./shochiku-ticket";
import type { OfficialHtmlDocument } from "./http";

const source = getOfficialSource("ticket.shochiku.schedule");
if (source === null) throw new Error("ticket source missing");

const detail = `<p class="type-term text blue">10月14日（水）チケット発売予定</p>
  <p class="type-theater">歌舞伎座</p>
  <section id="ticket"><div class="wrap-tct-free-playcts">10月14日（水）10：00よりWeb・電話受付開始！</div>
  <ul><li><div class="box-f2bd">※窓口販売・お引取りは、10月16日（金）10：00～</div></li></ul></section>`;

function document(url: string, body: string): OfficialHtmlDocument {
  return {
    url,
    body,
    observedAt: "2026-09-25T00:00:00.000Z",
    contentHash: "a".repeat(64),
    etag: null,
    lastModified: null,
  };
}

describe("Kabuki preliminary ticket sales", () => {
  it("prefers the explicit general-sale clock over the date-only headline", () => {
    expect(parseKabukiGeneralSale(detail, "2026-11-01", "2026-11-25")).toEqual({
      type: "sale_start",
      precision: "datetime",
      at: "2026-10-14T10:00:00+09:00",
    });
    expect(
      parseKabukiGeneralSale(
        `<p class="type-term text blue">10月14日（水）チケット発売予定</p>`,
        "2026-11-01",
        "2026-11-25",
      ),
    ).toEqual({ type: "sale_start", precision: "date", date: "2026-10-14" });
  });

  it("holds conflicting headline and ticket-section dates", () => {
    expect(() =>
      parseKabukiGeneralSale(
        detail.replace(
          "10月14日（水）チケット発売予定",
          "10月15日（木）チケット発売予定",
        ),
        "2026-11-01",
        "2026-11-25",
      ),
    ).toThrow(SourceParseFailure);
  });

  it("holds sale text when its observed HTML structure changes", () => {
    expect(() =>
      parseKabukiGeneralSale(
        detail.replace('class="type-term text blue"', 'class="unknown"'),
        "2026-11-01",
        "2026-11-25",
      ),
    ).toThrow(SourceParseFailure);
    expect(() =>
      parseKabukiGeneralSale(
        detail.replace('<section id="ticket">', '<section id="elsewhere">'),
        "2026-11-01",
        "2026-11-25",
      ),
    ).toThrow(SourceParseFailure);
  });

  it("retains the precise Kabuki start until Shochiku publishes a different date", async () => {
    const index = `<li class="item"><a href="/theaters/kabukiza/play/986"><h3 class="ttl">吉例顔見世大歌舞伎</h3></a><p class="term">2026年11月1日（日）～25日（水）</p></li>`;
    const east = `<h4 class="page-block__title title3">歌舞伎座</h4>
      <div class="performance__body"><h4 class="performance-title">吉例顔見世大歌舞伎</h4>
      <p class="agenda_size">2026年11月1日（日）～25日（水）</p>
      <table><tr><th>一般販売</th><td>10月14日（水）～</td></tr>
      <tr><th>松竹歌舞伎会会員</th><td>10月13日（火）～</td></tr></table></div>`;
    const west = `<h4 class="page-block__title title3">南座</h4>
      <div class="performance__body"><h4 class="performance-title">別公演</h4>
      <p class="agenda_size">2026年11月1日（日）</p>
      <table><tr><th>一般販売</th><td>10月1日～</td></tr></table></div>`;
    const pages = new Map([
      ["https://www.kabuki-bito.jp/schedule/", index],
      ["https://www.kabuki-bito.jp/theaters/kabukiza/play/986", detail],
      [
        "https://www1.ticket-web-shochiku.com/t/info/sale_schedule_east.html",
        east,
      ],
      [
        "https://www1.ticket-web-shochiku.com/t/info/sale_schedule_west.html",
        west,
      ],
    ]);
    const adapter = createShochikuTicketAdapter(async (_source, url) => {
      const body = pages.get(url);
      if (body === undefined) throw new Error(`unexpected URL ${url}`);
      return document(url, body);
    });
    const drafts = await adapter.acquire(source);
    const general = drafts
      .filter(
        (draft): draft is TicketOpportunityAcquisitionDraft =>
          draft.candidateKind === "ticket_opportunity",
      )
      .filter(
        (draft) =>
          draft.eventReference?.title === "吉例顔見世大歌舞伎" &&
          draft.proposal.displayName === "一般販売",
      );
    expect(general).toHaveLength(1);
    expect(general[0]?.proposal.milestones).toEqual([
      {
        type: "sale_start",
        precision: "datetime",
        at: "2026-10-14T10:00:00+09:00",
      },
    ]);
    expect(general[0]?.canonicalUrl).toContain("kabuki-bito.jp");
    expect(
      drafts.some(
        (draft) =>
          draft.candidateKind === "ticket_opportunity" &&
          draft.proposal.displayName === "松竹歌舞伎会会員",
      ),
    ).toBe(true);

    pages.set(
      "https://www1.ticket-web-shochiku.com/t/info/sale_schedule_east.html",
      east.replace("10月14日（水）～", "10月15日（木）～"),
    );
    const revised = (await adapter.acquire(source)).filter(
      (draft): draft is TicketOpportunityAcquisitionDraft =>
        draft.candidateKind === "ticket_opportunity" &&
        draft.eventReference?.title === "吉例顔見世大歌舞伎" &&
        draft.proposal.displayName === "一般販売",
    );
    expect(revised).toHaveLength(1);
    expect(revised[0]?.proposal.milestones).toEqual([
      { type: "sale_start", precision: "date", date: "2026-10-15" },
    ]);
    expect(revised[0]?.canonicalUrl).toContain("ticket-web-shochiku.com");
    expect(revised[0]?.proposal.sourceKey).toBe(general[0]?.proposal.sourceKey);
  });
});
