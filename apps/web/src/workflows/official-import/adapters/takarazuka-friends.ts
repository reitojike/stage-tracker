import {
  SourceParseFailure,
  type OfficialSourceAdapter,
  type TicketOpportunityAcquisitionDraft,
} from "../acquisition";
import {
  type StructuredPdfProvider,
  type TakarazukaFriendsExtraction,
} from "./firecrawl-pdf";
import { type OfficialPdfFetcher, fetchOfficialPdf } from "./pdf";
import { slug, tokyoDateTime } from "./japanese-date";

type TicketMilestone =
  | {
      readonly type:
        | "application_open"
        | "application_close"
        | "result_announcement"
        | "sale_start";
      readonly precision: "date";
      readonly date: string;
    }
  | {
      readonly type:
        | "application_open"
        | "application_close"
        | "result_announcement"
        | "sale_start";
      readonly precision: "datetime";
      readonly at: string;
    };

function milestone(
  type: TicketMilestone["type"],
  date: string | null,
  time: string | null,
): TicketMilestone | null {
  if (date === null) return null;
  if (time === null) return { type, precision: "date", date };
  const [hour, minute] = time.split(":").map(Number);
  if (hour === undefined || minute === undefined)
    throw new SourceParseFailure();
  return {
    type,
    precision: "datetime",
    at: tokyoDateTime(date, hour, minute),
  };
}

function milestonesFor(
  opportunity: TakarazukaFriendsExtraction["productions"][number]["opportunities"][number],
): readonly TicketMilestone[] {
  return [
    milestone(
      "application_open",
      opportunity.applicationStartDate,
      opportunity.applicationStartTime,
    ),
    milestone(
      "application_close",
      opportunity.applicationEndDate,
      opportunity.applicationEndTime,
    ),
    milestone(
      "result_announcement",
      opportunity.resultAnnouncementDate,
      opportunity.resultAnnouncementTime,
    ),
    milestone(
      "sale_start",
      opportunity.saleStartDate,
      opportunity.saleStartTime,
    ),
  ].filter((value): value is TicketMilestone => value !== null);
}

export function takarazukaFriendsDrafts(
  extraction: TakarazukaFriendsExtraction,
  document: {
    readonly url: string;
    readonly observedAt: string;
    readonly contentHash: string;
    readonly etag: string | null;
    readonly lastModified: string | null;
  },
): readonly TicketOpportunityAcquisitionDraft[] {
  const seen = new Set<string>();
  const drafts: TicketOpportunityAcquisitionDraft[] = [];
  for (const production of extraction.productions) {
    const year = production.startsOn.slice(0, 4);
    const productionSlug = slug(production.title);
    const venueSlug = slug(production.venue);
    for (const opportunity of production.opportunities) {
      const sourceKey = `takarazuka:tomonokai:${year}:${productionSlug}:${venueSlug}:${opportunity.phase}`;
      if (seen.has(sourceKey)) throw new SourceParseFailure();
      seen.add(sourceKey);
      drafts.push({
        candidateKind: "ticket_opportunity",
        canonicalUrl: document.url,
        officialExternalId: sourceKey,
        observedAt: document.observedAt,
        contentHash: document.contentHash,
        etag: document.etag,
        lastModified: document.lastModified,
        evidenceLocator: {
          pdfPageNumber: opportunity.evidencePageNumber,
          sectionLabel: `${production.venue} / ${production.title}`,
          rowLabel: opportunity.displayName,
        },
        eventReference: {
          title: production.title,
          venue: production.venue,
          startsOn: production.startsOn,
          endsOn: production.endsOn,
        },
        proposal: {
          eventSourceKey: `unresolved:takarazuka:${year}:${productionSlug}:${venueSlug}`,
          sourceKey,
          displayName: opportunity.displayName,
          sourceUrl: document.url,
          targetScope: "event_wide",
          milestones: [...milestonesFor(opportunity)],
        },
      });
    }
  }
  return drafts;
}

export function createTakarazukaFriendsAdapter(
  provider: StructuredPdfProvider,
  fetcher: OfficialPdfFetcher = fetchOfficialPdf,
): OfficialSourceAdapter {
  return {
    async acquire(source) {
      const document = await fetcher(source, source.canonicalUrl);
      const extraction = await provider.extractTakarazukaFriends(document.body);
      return takarazukaFriendsDrafts(extraction, document);
    },
  };
}
