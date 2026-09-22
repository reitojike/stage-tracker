import {
  SourceParseFailure,
  type EventAcquisitionDraft,
  type OfficialSourceAdapter,
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
import {
  type OfficialHtmlFetcher,
  fetchOfficialHtml,
  hashOfficialDocuments,
} from "./http";
import { parseJapaneseClock, tokyoDateTime } from "./japanese-date";

export type SkiyakiCalendarRelevance =
  "physical_event" | "online_only" | "media" | "release" | "other";

export interface SkiyakiCalendarFact {
  readonly officialId: string;
  readonly canonicalUrl: string;
  readonly date: string;
  readonly title: string;
  readonly relevance: SkiyakiCalendarRelevance;
}

function classify(classes: readonly string[]): SkiyakiCalendarRelevance {
  const joined = classes.join(" ").toLowerCase();
  if (/live_stream|stream|配信/u.test(joined)) return "online_only";
  if (/media|tv|radio|web/u.test(joined)) return "media";
  if (/release|リリース/u.test(joined)) return "release";
  if (/tag-live(?:\s|$)|tag-event(?:\s|$)|\bevent\b/u.test(joined)) {
    return "physical_event";
  }
  return "other";
}

export function parseSkiyakiCalendar(
  source: OfficialSourceDefinition,
  html: string,
): readonly SkiyakiCalendarFact[] {
  const document = parseHtml(html);
  const rows = descendants(document, (node) =>
    hasClass(node, "list-group-item"),
  );
  const candidateRows = rows.filter(
    (row) =>
      descendants(row, (node) =>
        /^\/contents\//u.test(attribute(node, "href") ?? ""),
      ).length > 0,
  );
  const facts = candidateRows.flatMap((row): SkiyakiCalendarFact[] => {
    const time = descendants(row, (node) => elementName(node) === "time")[0];
    const anchor = descendants(row, (node) => {
      if (elementName(node) !== "a") return false;
      return /^\/contents\/\d+(?:[/?#]|$)/u.test(attribute(node, "href") ?? "");
    })[0];
    if (time === undefined || anchor === undefined) return [];
    const rawDate = attribute(time, "datetime") ?? "";
    const date = rawDate.match(/^\d{4}-\d{2}-\d{2}/u)?.[0];
    const href = attribute(anchor, "href") ?? "";
    const officialId = href.match(/^\/contents\/(\d+)/u)?.[1];
    const titleNode = descendants(row, (node) =>
      hasClass(node, "fc-event-inner"),
    )[0];
    const title = normalizedText(titleNode ?? anchor);
    if (date === undefined || officialId === undefined || title === "")
      return [];
    const classes = descendants(row, () => true).flatMap((node) =>
      (attribute(node, "class") ?? "").split(/\s+/u),
    );
    return [
      {
        officialId,
        canonicalUrl: assertAllowedSourceUrl(
          source,
          new URL(href, source.canonicalUrl).toString(),
        ),
        date,
        title,
        relevance: classify(classes),
      },
    ];
  });
  if (candidateRows.length !== facts.length) throw new SourceParseFailure();
  return facts;
}

function metaContent(html: string, property: string): string | null {
  const document = parseHtml(html);
  const node = descendants(
    document,
    (candidate) =>
      elementName(candidate) === "meta" &&
      (attribute(candidate, "property") === property ||
        attribute(candidate, "name") === property),
  )[0];
  return node === undefined ? null : attribute(node, "content");
}

function parseDetail(
  html: string,
  date: string,
): {
  readonly venue: string | null;
  readonly occurrences: readonly {
    readonly doorsAt: string | null;
    readonly startsAt: string;
    readonly endsAt: null;
  }[];
} {
  const description = metaContent(html, "og:description") ?? "";
  const venue =
    description.match(/(?:会場|VENUE)\s*[：:]\s*([^\n／|]+)/iu)?.[1]?.trim() ??
    null;
  const startText =
    description.match(/(?:START|開演)\s*[：:]?\s*([^\s／|]+)/iu)?.[1] ?? "";
  const doorsText =
    description.match(/(?:OPEN|開場)\s*[：:]?\s*([^\s／|]+)/iu)?.[1] ?? "";
  const startClock = parseJapaneseClock(startText);
  if (startClock === null) return { venue, occurrences: [] };
  const doorsClock = parseJapaneseClock(doorsText);
  return {
    venue,
    occurrences: [
      {
        doorsAt:
          doorsClock === null
            ? null
            : tokyoDateTime(date, doorsClock.hour, doorsClock.minute),
        startsAt: tokyoDateTime(date, startClock.hour, startClock.minute),
        endsAt: null,
      },
    ],
  };
}

function groupFor(source: OfficialSourceDefinition) {
  if (source.id === "event.cynhn.calendar") {
    return [{ key: "cynhn", displayName: "CYNHN" }];
  }
  if (source.id === "event.meme-tokyo.calendar") {
    return [{ key: "meme-tokyo", displayName: "MEME TOKYO" }];
  }
  if (source.id === "event.arcana-project.calendar") {
    return [{ key: "arcana-project", displayName: "ARCANA PROJECT" }];
  }
  return undefined;
}

export function createSkiyakiCalendarAdapter(
  fetcher: OfficialHtmlFetcher = fetchOfficialHtml,
): OfficialSourceAdapter {
  return {
    async acquire(source): Promise<readonly EventAcquisitionDraft[]> {
      const index = await fetcher(source, source.canonicalUrl);
      const facts = parseSkiyakiCalendar(source, index.body).filter(
        (fact) => fact.relevance === "physical_event",
      );
      return Promise.all(
        facts.map(async (fact) => {
          const detail = await fetcher(source, fact.canonicalUrl);
          const parsed = parseDetail(detail.body, fact.date);
          const groups = groupFor(source);
          return {
            candidateKind: "event" as const,
            canonicalUrl: detail.url,
            officialExternalId: fact.officialId,
            observedAt: detail.observedAt,
            contentHash: hashOfficialDocuments([index, detail]),
            etag: detail.etag,
            lastModified: detail.lastModified,
            evidenceLocator: {
              rowLabel: fact.date,
              fragmentId: fact.officialId,
            },
            proposal: {
              sourceKey: `skiyaki:${new URL(source.canonicalUrl).hostname}:${fact.officialId}`,
              title: fact.title,
              venue: parsed.venue,
              sourceUrl: detail.url,
              startsOn: fact.date,
              endsOn: fact.date,
              occurrences: [...parsed.occurrences],
              ...(groups === undefined ? {} : { groups }),
            },
          };
        }),
      );
    },
  };
}
