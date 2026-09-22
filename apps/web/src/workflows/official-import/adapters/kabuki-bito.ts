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
import {
  enumerateDates,
  parseJapaneseClock,
  parseJapaneseDateRange,
  tokyoDateTime,
} from "./japanese-date";

export interface KabukiIndexFact {
  readonly officialId: string;
  readonly theater: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly startsOn: string;
  readonly endsOn: string;
}

export function parseKabukiIndex(
  source: OfficialSourceDefinition,
  html: string,
): readonly KabukiIndexFact[] {
  const document = parseHtml(html);
  const items = descendants(document, (node) => hasClass(node, "item"));
  const candidateItems = items.filter(
    (item) =>
      descendants(item, (node) =>
        /\/theaters\/[^/]+\/play\//u.test(attribute(node, "href") ?? ""),
      ).length > 0,
  );
  const facts = candidateItems.flatMap((item): KabukiIndexFact[] => {
    const anchor = descendants(item, (node) => {
      const href = attribute(node, "href") ?? "";
      return (
        elementName(node) === "a" && /\/theaters\/[^/]+\/play\/\d+/u.test(href)
      );
    })[0];
    if (anchor === undefined) return [];
    const href = attribute(anchor, "href") ?? "";
    const identity = href.match(/\/theaters\/([^/]+)\/play\/(\d+)/u);
    const titleNode = descendants(item, (node) => hasClass(node, "ttl"))[0];
    const termNode = descendants(item, (node) => hasClass(node, "term"))[0];
    const theater = identity?.[1];
    const officialId = identity?.[2];
    if (
      theater === undefined ||
      officialId === undefined ||
      titleNode === undefined ||
      termNode === undefined
    )
      return [];
    let range: { startsOn: string; endsOn: string };
    try {
      range = parseJapaneseDateRange(normalizedText(termNode));
    } catch {
      return [];
    }
    return [
      {
        officialId,
        theater,
        canonicalUrl: assertAllowedSourceUrl(
          source,
          new URL(href, source.canonicalUrl).toString(),
        ),
        title: normalizedText(titleNode),
        ...range,
      },
    ];
  });
  if (candidateItems.length !== facts.length) throw new SourceParseFailure();
  return facts;
}

function markedDays(text: string, marker: "休演" | "貸切"): Set<number> {
  const section =
    text.match(new RegExp(`【${marker}】([^【]+)`, "u"))?.[1] ?? "";
  return new Set(
    [...section.matchAll(/(\d{1,2})日/gu)].map((match) => Number(match[1])),
  );
}

export function expandKabukiSchedule(
  startsOn: string,
  endsOn: string,
  timetable: string,
): readonly { readonly startsAt: string; readonly endsAt: null }[] {
  const partMatches = [
    ...timetable.matchAll(
      /(?:^|[／/\s])([^【／/\n]{0,20}?の部)\s*(午前|午後)?\s*(\d{1,2})時(?:\s*(\d{1,2})分)?/gu,
    ),
  ];
  const clocks = partMatches.map((match) =>
    parseJapaneseClock(`${match[2] ?? ""}${match[3]}時${match[4] ?? ""}分`),
  );
  if (clocks.length === 0 || clocks.some((clock) => clock === null)) {
    throw new SourceParseFailure();
  }
  const excludedDays = new Set([
    ...markedDays(timetable, "休演"),
    ...markedDays(timetable, "貸切"),
  ]);
  return enumerateDates(startsOn, endsOn).flatMap((date) => {
    if (excludedDays.has(Number(date.slice(-2)))) return [];
    return clocks.map((clock) => {
      if (clock === null) throw new SourceParseFailure();
      return {
        startsAt: tokyoDateTime(date, clock.hour, clock.minute),
        endsAt: null,
      };
    });
  });
}

function detailText(html: string, className: string): string | null {
  const document = parseHtml(html);
  const node = descendants(document, (candidate) =>
    hasClass(candidate, className),
  )[0];
  return node === undefined ? null : normalizedText(node);
}

export function createKabukiBitoAdapter(
  fetcher: OfficialHtmlFetcher = fetchOfficialHtml,
): OfficialSourceAdapter {
  return {
    async acquire(source): Promise<readonly EventAcquisitionDraft[]> {
      const index = await fetcher(source, source.canonicalUrl);
      const facts = parseKabukiIndex(source, index.body);
      return Promise.all(
        facts.map(async (fact) => {
          const detail = await fetcher(source, fact.canonicalUrl);
          const timetable = detailText(detail.body, "type-timetable");
          if (timetable === null) throw new SourceParseFailure();
          const venue = detailText(detail.body, "type-theater");
          return {
            candidateKind: "event" as const,
            canonicalUrl: detail.url,
            officialExternalId: fact.officialId,
            observedAt: detail.observedAt,
            contentHash: hashOfficialDocuments([index, detail]),
            etag: detail.etag,
            lastModified: detail.lastModified,
            evidenceLocator: {
              sectionLabel: "公演情報",
              fragmentId: fact.officialId,
            },
            proposal: {
              sourceKey: `kabuki-bito:${fact.theater}:play:${fact.officialId}`,
              title: fact.title,
              venue,
              memo: /【(?:休演|貸切)】/u.test(timetable)
                ? "公式日程の休演・貸切日をOccurrence候補から除外"
                : null,
              sourceUrl: detail.url,
              startsOn: fact.startsOn,
              endsOn: fact.endsOn,
              occurrences: [
                ...expandKabukiSchedule(fact.startsOn, fact.endsOn, timetable),
              ],
            },
          };
        }),
      );
    },
  };
}
