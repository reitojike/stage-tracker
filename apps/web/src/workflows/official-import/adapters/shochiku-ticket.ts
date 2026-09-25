import {
  SourceParseFailure,
  type OfficialSourceAdapter,
  type TicketOpportunityAcquisitionDraft,
} from "../acquisition";
import {
  descendants,
  elementName,
  hasClass,
  normalizedText,
  textContent,
  type HtmlNode,
  parseHtml,
} from "./html";
import {
  type OfficialHtmlDocument,
  type OfficialHtmlFetcher,
  fetchOfficialHtml,
  hashOfficialDocuments,
} from "./http";
import { calendarDate, slug } from "./japanese-date";
import {
  acquireKabukiGeneralSales,
  type KabukiTicketIdentity,
} from "./kabuki-ticket-sales";
import {
  parseShochikuSaleMilestone,
  type TicketMilestone,
} from "./ticket-sale-date";
export { parseShochikuSaleMilestone } from "./ticket-sale-date";

const SCHEDULE_PAGES = [
  "https://www1.ticket-web-shochiku.com/t/info/sale_schedule_east.html",
  "https://www1.ticket-web-shochiku.com/t/info/sale_schedule_west.html",
] as const;

export interface ShochikuTicketFact {
  readonly title: string;
  readonly venue: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly displayName: string;
  readonly rowText: string;
  readonly milestone: TicketMilestone | null;
}

function headingLabel(node: HtmlNode): string {
  if (!("childNodes" in node)) return normalizedText(node);
  const directText = node.childNodes
    .filter((child) => child.nodeName === "#text")
    .map(textContent)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  return directText === "" ? normalizedText(node) : directText;
}

export function parseShochikuSchedule(
  html: string,
): readonly ShochikuTicketFact[] {
  const document = parseHtml(html);
  const all = descendants(document, () => true);
  const isPerformanceTitle = (node: HtmlNode) =>
    elementName(node) === "h4" && hasClass(node, "performance-title");
  const isVenueHeading = (node: HtmlNode) =>
    elementName(node) === "h4" &&
    hasClass(node, "page-block__title") &&
    hasClass(node, "title3");
  const performanceTitles = all.filter(isPerformanceTitle);
  const facts: ShochikuTicketFact[] = [];
  for (const titleNode of performanceTitles) {
    const titleIndex = all.indexOf(titleNode);
    const nextBoundary = all.findIndex(
      (node, index) =>
        index > titleIndex &&
        (isPerformanceTitle(node) || isVenueHeading(node)),
    );
    const section = all.slice(
      titleIndex + 1,
      nextBoundary === -1 ? undefined : nextBoundary,
    );
    const venueNode = all.slice(0, titleIndex).reverse().find(isVenueHeading);
    const periodNodes = section.filter(
      (node) => elementName(node) === "p" && hasClass(node, "agenda_size"),
    );
    const periodNode = periodNodes[0];
    if (
      venueNode === undefined ||
      periodNodes.length !== 1 ||
      periodNode === undefined
    ) {
      throw new SourceParseFailure();
    }
    const periodText = normalizedText(periodNode);
    // An observed month-only teaser cannot be associated with a dated Event.
    if (
      /^\d{4}年\d{1,2}月[～〜~]\d{1,2}月/u.test(periodText.normalize("NFKC"))
    ) {
      continue;
    }
    const periodMatch = periodText
      .normalize("NFKC")
      .match(
        /^(\d{4})年(\d{1,2})月(\d{1,2})日?(?:\([^)]+\))?(?:(?:～|〜|~|・)(?:(\d{4})年)?(?:(\d{1,2})月)?(\d{1,2})日?(?:\([^)]+\))?)?(?:\s*\d{1,2}:\d{2}開演)?$/u,
      );
    if (periodMatch === null) throw new SourceParseFailure();
    const startsOn = calendarDate(
      Number(periodMatch[1]),
      Number(periodMatch[2]),
      Number(periodMatch[3]),
    );
    let endYear = Number(periodMatch[4] ?? periodMatch[1]);
    const endMonth = Number(periodMatch[5] ?? periodMatch[2]);
    if (periodMatch[4] === undefined && endMonth < Number(periodMatch[2])) {
      endYear += 1;
    }
    const endsOn = calendarDate(
      endYear,
      endMonth,
      Number(periodMatch[6] ?? periodMatch[3]),
    );
    if (endsOn < startsOn) throw new SourceParseFailure();
    const title = normalizedText(titleNode);
    const venue = headingLabel(venueNode);
    for (const row of section.filter((node) => elementName(node) === "tr")) {
      const heading = descendants(row, (node) => elementName(node) === "th")[0];
      const value = descendants(row, (node) => elementName(node) === "td")[0];
      if (heading === undefined || value === undefined) continue;
      const displayName = normalizedText(heading);
      const rowText = normalizedText(value);
      if (displayName === "" || rowText === "") continue;
      const milestone = parseShochikuSaleMilestone(rowText, startsOn, endsOn);
      // The observed magazine-delivery opening has no published start date.
      // Do not turn its application deadline into a sale start candidate.
      if (milestone === null && rowText.includes("到着後")) continue;
      if (milestone === null) throw new SourceParseFailure();
      facts.push({
        title,
        venue,
        startsOn,
        endsOn,
        displayName,
        rowText,
        milestone,
      });
    }
  }
  if (performanceTitles.length === 0 || facts.length === 0) {
    throw new SourceParseFailure();
  }
  return facts;
}

function draftFor(
  document: OfficialHtmlDocument,
  fact: ShochikuTicketFact,
  contentHash: string,
): TicketOpportunityAcquisitionDraft {
  const year = fact.startsOn.slice(0, 4);
  const identity = `${year}:${slug(fact.venue)}:${slug(fact.title)}:${slug(fact.displayName)}`;
  return {
    candidateKind: "ticket_opportunity",
    canonicalUrl: document.url,
    officialExternalId: identity,
    observedAt: document.observedAt,
    contentHash,
    etag: document.etag,
    lastModified: document.lastModified,
    evidenceLocator: {
      sectionLabel: `${fact.venue} / ${fact.title}`,
      rowLabel: fact.displayName,
    },
    eventReference: {
      title: fact.title,
      venue: fact.venue,
      startsOn: fact.startsOn,
      endsOn: fact.endsOn,
    },
    proposal: {
      eventSourceKey: `unresolved:shochiku:${year}:${slug(fact.venue)}:${slug(fact.title)}`,
      sourceKey: `shochiku:${identity}`,
      displayName: fact.displayName,
      sourceUrl: document.url,
      targetScope: "event_wide",
      milestones: fact.milestone === null ? [] : [fact.milestone],
    },
  };
}

function comparable(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/^劇場\s*[:：]\s*/u, "")
    .replace(/[^\p{Letter}\p{Number}]/gu, "")
    .replace(/^京都四條南座/u, "南座");
}

function samePerformance(
  left: TicketOpportunityAcquisitionDraft["eventReference"],
  right: TicketOpportunityAcquisitionDraft["eventReference"],
): boolean {
  if (left === undefined || right === undefined) return false;
  const leftTitle = comparable(left.title);
  const rightTitle = comparable(right.title);
  return (
    left.startsOn === right.startsOn &&
    left.endsOn === right.endsOn &&
    comparable(left.venue ?? "") === comparable(right.venue ?? "") &&
    (leftTitle === rightTitle ||
      (leftTitle.length >= 5 &&
        rightTitle.length >= 5 &&
        (leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle))))
  );
}

function milestoneDay(
  milestone: NonNullable<
    TicketOpportunityAcquisitionDraft["proposal"]["milestones"]
  >[number],
): string {
  return milestone.precision === "date"
    ? milestone.date
    : milestone.precision === "datetime"
      ? milestone.at.slice(0, 10)
      : milestone.startsAt.slice(0, 10);
}

function mergeGeneralSales(
  detailed: readonly TicketOpportunityAcquisitionDraft[],
  preliminary: readonly TicketOpportunityAcquisitionDraft[],
  identities: readonly KabukiTicketIdentity[],
): readonly TicketOpportunityAcquisitionDraft[] {
  const remaining = new Set(preliminary);
  const merged = detailed.map((draft) => {
    if (!/^(?:一般販売|一般発売)$/u.test(draft.proposal.displayName))
      return draft;
    const matches = identities.filter((identity) =>
      samePerformance(draft.eventReference, identity.eventReference),
    );
    const match = matches[0];
    if (matches.length !== 1 || match === undefined) return draft;
    const preliminaryMatch = preliminary.find(
      (candidate) => candidate.officialExternalId === match.officialExternalId,
    );
    if (preliminaryMatch !== undefined) remaining.delete(preliminaryMatch);
    const detailedMilestone = draft.proposal.milestones?.[0];
    const preliminaryMilestone = preliminaryMatch?.proposal.milestones?.[0];
    if (
      preliminaryMatch !== undefined &&
      detailedMilestone !== undefined &&
      preliminaryMilestone !== undefined &&
      milestoneDay(detailedMilestone) === milestoneDay(preliminaryMilestone) &&
      detailedMilestone.precision === "date" &&
      preliminaryMilestone.precision === "datetime"
    )
      return preliminaryMatch;
    return {
      ...draft,
      officialExternalId: match.officialExternalId,
      eventReference: match.eventReference,
      proposal: {
        ...draft.proposal,
        eventSourceKey: match.eventSourceKey,
        sourceKey: `shochiku:${match.officialExternalId}`,
      },
    };
  });
  return [...merged, ...remaining];
}

export function createShochikuTicketAdapter(
  fetcher: OfficialHtmlFetcher = fetchOfficialHtml,
): OfficialSourceAdapter {
  return {
    async acquire(source, reportHeldPage) {
      const documents = await Promise.all(
        SCHEDULE_PAGES.map((url) => fetcher(source, url)),
      );
      const contentHash = hashOfficialDocuments(documents);
      const detailed = documents.flatMap((document) =>
        parseShochikuSchedule(document.body).map((fact) =>
          draftFor(document, fact, contentHash),
        ),
      );
      const preliminary = await acquireKabukiGeneralSales(
        fetcher,
        reportHeldPage,
      );
      return mergeGeneralSales(
        detailed,
        preliminary.drafts,
        preliminary.identities,
      );
    },
  };
}
