import {
  type OfficialSourceAdapter,
  type TicketOpportunityAcquisitionDraft,
} from "../acquisition";
import { type OfficialHtmlFetcher, fetchOfficialHtml } from "./http";
import { parseTakarazukaIndex } from "./takarazuka-revue";

export function createTakarazukaGeneralSaleAdapter(
  fetcher: OfficialHtmlFetcher = fetchOfficialHtml,
): OfficialSourceAdapter {
  return {
    async acquire(
      source,
    ): Promise<readonly TicketOpportunityAcquisitionDraft[]> {
      const index = await fetcher(source, source.canonicalUrl);
      const productions = parseTakarazukaIndex(source, index.body);
      const drafts: TicketOpportunityAcquisitionDraft[] = [];
      for (const production of productions) {
        for (const venue of production.venues) {
          if (venue.generalSaleOn === null) continue;
          const eventSourceKey = `takarazuka:${production.year}:${production.workSlug}:${venue.venueSlug}`;
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
            eventReference: {
              title: production.title,
              venue: venue.venue,
              startsOn: venue.startsOn,
              endsOn: venue.endsOn,
            },
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
      }
      return drafts;
    },
  };
}
