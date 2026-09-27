import {
  SourceParseFailure,
  type OfficialSourceAdapter,
  type TicketOpportunityAcquisitionDraft,
} from "../acquisition";
import {
  assertAllowedSourceUrl,
  type OfficialSourceDefinition,
} from "../source-registry";
import {
  attribute,
  descendants,
  elementName,
  hasClass,
  normalizedText,
  parseHtml,
} from "./html";
import { type OfficialHtmlFetcher, fetchOfficialHtml } from "./http";
import { calendarDate, tokyoDateTime } from "./japanese-date";
import { parseTakarazukaIndex } from "./takarazuka-revue";

interface AdvanceSale {
  readonly key: string;
  readonly displayName: string;
  readonly sectionLabel: string;
  readonly milestones: NonNullable<
    TicketOpportunityAcquisitionDraft["proposal"]["milestones"]
  >;
}

const MAX_REQUESTS = 30;

function ticketPageUrl(
  source: OfficialSourceDefinition,
  productionUrl: string,
  html: string,
  venueSlug: string,
): string | null {
  const ticketName = `ticket_${venueSlug}.html`;
  const links = new Set(
    descendants(parseHtml(html), (node) => elementName(node) === "a")
      .map((node) => attribute(node, "href"))
      .filter(
        (href): href is string =>
          href !== null && href.endsWith(`/${ticketName}`),
      )
      .map((href) =>
        assertAllowedSourceUrl(source, new URL(href, productionUrl).toString()),
      ),
  );
  if (links.size > 1) throw new SourceParseFailure();
  const url = [...links][0];
  if (url === undefined) return null;
  const productionPath = new URL(productionUrl).pathname.replace(
    /index\.html$/u,
    "",
  );
  if (!new URL(url).pathname.startsWith(productionPath))
    throw new SourceParseFailure();
  return url;
}

function datedClock(text: string, generalSaleOn: string): string {
  const match = text.match(
    /^(\d{1,2})月(\d{1,2})日(?:[（(][^）)]*[）)])?\s*(\d{1,2}):(\d{2})$/u,
  );
  if (match === null) throw new SourceParseFailure();
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year =
    Number(generalSaleOn.slice(0, 4)) -
    (month * 100 + day >
    Number(generalSaleOn.slice(5, 7)) * 100 + Number(generalSaleOn.slice(8, 10))
      ? 1
      : 0);
  const date = calendarDate(year, month, day);
  return tokyoDateTime(date, Number(match[3]), Number(match[4]));
}

function lotteryMilestones(
  text: string,
  generalSaleOn: string,
): AdvanceSale["milestones"] {
  const period = text.match(
    /申込期間[：:]\s*(\d{1,2}月\d{1,2}日(?:[（(][^）)]*[）)])?\s*\d{1,2}:\d{2})\s*[〜～~]\s*(\d{1,2}月\d{1,2}日(?:[（(][^）)]*[）)])?\s*\d{1,2}:\d{2})/u,
  );
  const result = text.match(
    /結果照会[：:]\s*(\d{1,2}月\d{1,2}日(?:[（(][^）)]*[）)])?\s*\d{1,2}:\d{2})\s*[〜～~]/u,
  );
  if (period === null || result === null) throw new SourceParseFailure();
  const open = datedClock(period[1] ?? "", generalSaleOn);
  const close = datedClock(period[2] ?? "", generalSaleOn);
  const announcement = datedClock(result[1] ?? "", generalSaleOn);
  if (
    !(open < close && close < announcement) ||
    announcement.slice(0, 10) > generalSaleOn
  )
    throw new SourceParseFailure();
  return [
    { type: "application_open", precision: "datetime", at: open },
    { type: "application_close", precision: "datetime", at: close },
    { type: "result_announcement", precision: "datetime", at: announcement },
  ];
}

function advanceSales(html: string, generalSaleOn: string): AdvanceSale[] {
  const document = parseHtml(html);
  const sections = descendants(document, (node) => hasClass(node, "set"));
  const sales: AdvanceSale[] = [];
  for (const section of sections) {
    const heading = descendants(
      section,
      (node) => elementName(node) === "h4",
    )[0];
    if (heading === undefined) continue;
    const sectionLabel = normalizedText(heading);
    if (
      sectionLabel !== "宝塚友の会" &&
      sectionLabel !== "宝塚歌劇共通ID＋（プラス）"
    )
      continue;
    const paragraph = descendants(
      section,
      (node) => elementName(node) === "p" && hasClass(node, "txt"),
    )[0];
    if (paragraph === undefined) throw new SourceParseFailure();
    const text = normalizedText(paragraph);
    const markers = [...text.matchAll(/■「([^」]+)」/gu)];
    if (markers.length === 0) continue;
    for (const [index, marker] of markers.entries()) {
      const phase = marker[1];
      const key =
        sectionLabel === "宝塚友の会"
          ? phase?.match(/^第([123])抽選方式$/u)?.[1]
          : phase === "抽選方式"
            ? "plus"
            : undefined;
      if (key === undefined) throw new SourceParseFailure();
      const start = (marker.index ?? 0) + marker[0].length;
      const end = markers[index + 1]?.index ?? text.length;
      const milestones = lotteryMilestones(
        text.slice(start, end),
        generalSaleOn,
      );
      sales.push({
        key:
          key === "plus" ? "common-id-plus-lottery" : `friends-lottery-${key}`,
        displayName:
          key === "plus"
            ? "宝塚歌劇共通ID＋ 抽選方式"
            : `宝塚友の会 第${key}抽選方式`,
        sectionLabel,
        milestones,
      });
    }
  }
  if (new Set(sales.map((sale) => sale.key)).size !== sales.length)
    throw new SourceParseFailure();
  return sales;
}

export function createTakarazukaGeneralSaleAdapter(
  fetcher: OfficialHtmlFetcher = fetchOfficialHtml,
): OfficialSourceAdapter {
  return {
    async acquire(
      source,
    ): Promise<readonly TicketOpportunityAcquisitionDraft[]> {
      let requests = 0;
      const read = (url: string) => {
        requests += 1;
        if (requests > MAX_REQUESTS) throw new SourceParseFailure();
        return fetcher(source, url);
      };
      const index = await read(source.canonicalUrl);
      const productions = parseTakarazukaIndex(source, index.body, {
        strictGeneralSale: true,
      });
      const drafts: TicketOpportunityAcquisitionDraft[] = [];
      for (const production of productions) {
        const detail = await read(production.canonicalUrl);
        for (const venue of production.venues) {
          const eventSourceKey = `takarazuka:${production.year}:${production.workSlug}:${venue.venueSlug}`;
          const eventReference = {
            title: production.title,
            venue: venue.venue,
            startsOn: venue.startsOn,
            endsOn: venue.endsOn,
          };
          if (venue.generalSaleOn !== null) {
            const sourceKey = `${eventSourceKey}:general-sale`;
            drafts.push({
              candidateKind: "ticket_opportunity",
              canonicalUrl: index.url,
              officialExternalId: sourceKey,
              observedAt: index.observedAt,
              contentHash: index.contentHash,
              etag: index.etag,
              lastModified: index.lastModified,
              evidenceLocator: {
                sectionLabel: venue.venue,
                rowLabel: "一般前売",
              },
              eventReference,
              proposal: {
                eventSourceKey,
                sourceKey,
                displayName: "一般前売",
                sourceUrl: index.url,
                targetScope: "event_wide",
                milestones: [
                  {
                    type: "sale_start",
                    precision: "date",
                    date: venue.generalSaleOn,
                  },
                ],
              },
            });
          }
          const ticketUrl = ticketPageUrl(
            source,
            detail.url,
            detail.body,
            venue.venueSlug,
          );
          if (ticketUrl === null) continue;
          if (venue.generalSaleOn === null) throw new SourceParseFailure();
          const ticket = await read(ticketUrl);
          for (const sale of advanceSales(ticket.body, venue.generalSaleOn)) {
            const sourceKey = `${eventSourceKey}:${sale.key}`;
            drafts.push({
              candidateKind: "ticket_opportunity",
              canonicalUrl: ticket.url,
              officialExternalId: sourceKey,
              observedAt: ticket.observedAt,
              contentHash: ticket.contentHash,
              etag: ticket.etag,
              lastModified: ticket.lastModified,
              evidenceLocator: {
                sectionLabel: `${venue.venue} / ${sale.sectionLabel}`,
                rowLabel: sale.displayName,
              },
              eventReference,
              proposal: {
                eventSourceKey,
                sourceKey,
                displayName: sale.displayName,
                sourceUrl: ticket.url,
                targetScope: "event_wide",
                milestones: sale.milestones,
              },
            });
          }
        }
      }
      return drafts;
    },
  };
}
