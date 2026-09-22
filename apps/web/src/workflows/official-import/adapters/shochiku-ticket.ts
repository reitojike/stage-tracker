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
import {
  calendarDate,
  parseJapaneseClock,
  slug,
  tokyoDateTime,
} from "./japanese-date";

const SCHEDULE_PAGES = [
  "https://www1.ticket-web-shochiku.com/t/info/sale_schedule_east.html",
  "https://www1.ticket-web-shochiku.com/t/info/sale_schedule_west.html",
] as const;

type TicketMilestone =
  | {
      readonly type: "sale_start";
      readonly precision: "date";
      readonly date: string;
    }
  | {
      readonly type: "sale_start";
      readonly precision: "datetime";
      readonly at: string;
    }
  | {
      readonly type: "sale_start";
      readonly precision: "window";
      readonly startsAt: string;
      readonly endsAt: string;
    };

export interface ShochikuTicketFact {
  readonly title: string;
  readonly venue: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly displayName: string;
  readonly rowText: string;
  readonly milestone: TicketMilestone | null;
}

function isHtmlNode(value: unknown): value is HtmlNode {
  return typeof value === "object" && value !== null && "nodeName" in value;
}

function parent(node: HtmlNode): HtmlNode | null {
  const candidate: unknown = Reflect.get(node, "parentNode");
  return isHtmlNode(candidate) ? candidate : null;
}

function closest(node: HtmlNode, predicate: (node: HtmlNode) => boolean) {
  let cursor: HtmlNode | null = node;
  while (cursor !== null) {
    if (predicate(cursor)) return cursor;
    cursor = parent(cursor);
  }
  return null;
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

function dateForSale(
  text: string,
  performanceStartsOn: string,
  performanceEndsOn: string = performanceStartsOn,
): string | null {
  const normalized = text.normalize("NFKC");
  const dateMatch = normalized.match(
    /(?:(\d{4})年)?\s*(\d{1,2})月\s*(\d{1,2})日/u,
  );
  if (dateMatch === null) return null;
  const explicitYear = dateMatch[1];
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  if (explicitYear !== undefined) {
    return calendarDate(Number(explicitYear), month, day);
  }
  const performanceYear = Number(performanceStartsOn.slice(0, 4));
  const sameYear = calendarDate(performanceYear, month, day);
  return sameYear <= performanceEndsOn
    ? sameYear
    : calendarDate(performanceYear - 1, month, day);
}

export function parseShochikuSaleMilestone(
  text: string,
  performanceStartsOn: string,
  performanceEndsOn: string = performanceStartsOn,
): TicketMilestone | null {
  const date = dateForSale(text, performanceStartsOn, performanceEndsOn);
  if (date === null) return null;
  const clockMatches = [
    ...text
      .normalize("NFKC")
      .matchAll(
        /(?:(?:午前|午後)?\s*\d{1,2}時(?:\s*\d{1,2}分)?|\d{1,2}\s*[:：]\s*\d{2})/gu,
      ),
  ];
  const clocks = clockMatches.flatMap((match) => {
    const parsed = parseJapaneseClock(match[0]);
    return parsed === null ? [] : [parsed];
  });
  const [firstClock, secondClock] = clocks;
  if (firstClock !== undefined && secondClock !== undefined) {
    return {
      type: "sale_start",
      precision: "window",
      startsAt: tokyoDateTime(date, firstClock.hour, firstClock.minute),
      endsAt: tokyoDateTime(date, secondClock.hour, secondClock.minute),
    };
  }
  if (firstClock !== undefined) {
    return {
      type: "sale_start",
      precision: "datetime",
      at: tokyoDateTime(date, firstClock.hour, firstClock.minute),
    };
  }
  return { type: "sale_start", precision: "date", date };
}

export function parseShochikuSchedule(
  html: string,
): readonly ShochikuTicketFact[] {
  const document = parseHtml(html);
  const all = descendants(document, () => true);
  const performanceTitles = all.filter(
    (node) => elementName(node) === "h4" && hasClass(node, "performance-title"),
  );
  const facts: ShochikuTicketFact[] = [];
  for (const titleNode of performanceTitles) {
    const titleIndex = all.indexOf(titleNode);
    const venueNode = all
      .slice(0, titleIndex)
      .reverse()
      .find(
        (node) =>
          elementName(node) === "h4" &&
          hasClass(node, "page-block__title") &&
          hasClass(node, "title3"),
      );
    const block = closest(titleNode, (node) =>
      hasClass(node, "performance__body"),
    );
    if (venueNode === undefined || block === null) continue;
    const periodNode = descendants(
      block,
      (node) => elementName(node) === "p" && hasClass(node, "agenda_size"),
    )[0];
    const periodText =
      periodNode === undefined ? "" : normalizedText(periodNode);
    const periodMatch = periodText
      .normalize("NFKC")
      .match(
        /(\d{4})年(\d{1,2})月(\d{1,2})日[^0-9]*(?:(\d{4})年)?(?:(\d{1,2})月)?(\d{1,2})日/u,
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
    const endsOn = calendarDate(endYear, endMonth, Number(periodMatch[6]));
    const title = normalizedText(titleNode);
    const venue = headingLabel(venueNode);
    for (const row of descendants(
      block,
      (node) => elementName(node) === "tr",
    )) {
      const heading = descendants(row, (node) => elementName(node) === "th")[0];
      const value = descendants(row, (node) => elementName(node) === "td")[0];
      if (heading === undefined || value === undefined) continue;
      const displayName = normalizedText(heading);
      const rowText = normalizedText(value);
      if (displayName === "" || rowText === "") continue;
      facts.push({
        title,
        venue,
        startsOn,
        endsOn,
        displayName,
        rowText,
        milestone: parseShochikuSaleMilestone(rowText, startsOn, endsOn),
      });
    }
  }
  if (performanceTitles.length > 0 && facts.length === 0) {
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

export function createShochikuTicketAdapter(
  fetcher: OfficialHtmlFetcher = fetchOfficialHtml,
): OfficialSourceAdapter {
  return {
    async acquire(source) {
      const documents = await Promise.all(
        SCHEDULE_PAGES.map((url) => fetcher(source, url)),
      );
      const contentHash = hashOfficialDocuments(documents);
      return documents.flatMap((document) =>
        parseShochikuSchedule(document.body).map((fact) =>
          draftFor(document, fact, contentHash),
        ),
      );
    },
  };
}
