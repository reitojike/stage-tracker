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
  calendarDate,
  parseJapaneseClock,
  parseJapaneseDateRange,
  slug,
  tokyoDateTime,
} from "./japanese-date";

interface TakarazukaVenueFact {
  readonly venue: string;
  readonly venueSlug: string;
  readonly startsOn: string;
  readonly endsOn: string;
}

export interface TakarazukaProductionFact {
  readonly year: string;
  readonly workSlug: string;
  readonly title: string;
  readonly canonicalUrl: string;
  readonly venues: readonly TakarazukaVenueFact[];
}

function venueSlug(venue: string): string {
  if (venue.includes("東京宝塚劇場")) return "tokyo";
  if (venue.includes("宝塚大劇場")) return "takarazuka";
  return slug(venue);
}

export function parseTakarazukaIndex(
  source: OfficialSourceDefinition,
  html: string,
): readonly TakarazukaProductionFact[] {
  const document = parseHtml(html);
  const items = descendants(document, (node) => hasClass(node, "item"));
  const candidateItems = items.filter(
    (item) =>
      descendants(item, (node) =>
        /\/sp\/revue\//u.test(attribute(node, "href") ?? ""),
      ).length > 0,
  );
  const facts = candidateItems.flatMap((item): TakarazukaProductionFact[] => {
    const anchor = descendants(item, (node) => {
      const href = attribute(node, "href") ?? "";
      return (
        elementName(node) === "a" &&
        /\/sp\/revue\/\d{4}\/[^/]+\/index\.html/u.test(href)
      );
    })[0];
    if (anchor === undefined) return [];
    const href = attribute(anchor, "href") ?? "";
    const identity = href.match(/\/sp\/revue\/(\d{4})\/([^/]+)\/index\.html/u);
    const year = identity?.[1];
    const workSlug = identity?.[2];
    const titleNode = descendants(item, (node) => hasClass(node, "title"))[0];
    if (year === undefined || workSlug === undefined || titleNode === undefined)
      return [];
    const venues = descendants(
      item,
      (node) => elementName(node) === "dl",
    ).flatMap((dl): TakarazukaVenueFact[] => {
      const dt = descendants(dl, (node) => elementName(node) === "dt")[0];
      const dd = descendants(dl, (node) => elementName(node) === "dd")[0];
      if (dt === undefined || dd === undefined) return [];
      const venue = normalizedText(dt);
      try {
        return [
          {
            venue,
            venueSlug: venueSlug(venue),
            ...parseJapaneseDateRange(normalizedText(dd)),
          },
        ];
      } catch {
        return [];
      }
    });
    if (venues.length === 0) return [];
    return [
      {
        year,
        workSlug,
        title: normalizedText(titleNode),
        canonicalUrl: assertAllowedSourceUrl(
          source,
          new URL(href, source.canonicalUrl).toString(),
        ),
        venues,
      },
    ];
  });
  if (candidateItems.length !== facts.length) throw new SourceParseFailure();
  return facts;
}

function scheduleVenueSlug(href: string): string | null {
  if (/schedule_tokyo\.html/u.test(href)) return "tokyo";
  if (/schedule_takarazuka\.html/u.test(href)) return "takarazuka";
  if (/schedule\.html/u.test(href)) return "single";
  return null;
}

export function parseTakarazukaSchedule(
  html: string,
  startsOn: string,
  endsOn: string,
): readonly { readonly startsAt: string; readonly endsAt: null }[] {
  const document = parseHtml(html);
  const rows = descendants(document, (node) => elementName(node) === "tr");
  const occurrences: { startsAt: string; endsAt: null }[] = [];
  let activeMonthDay: { month: number; day: number } | null = null;
  for (const row of rows) {
    const heading = descendants(row, (node) => elementName(node) === "th")[0];
    const dateMatch =
      heading === undefined
        ? null
        : normalizedText(heading).match(/(\d{1,2})\s*[/.]\s*(\d{1,2})/u);
    if (dateMatch !== null)
      activeMonthDay = {
        month: Number(dateMatch[1]),
        day: Number(dateMatch[2]),
      };
    if (activeMonthDay === null) continue;
    const monthDay = activeMonthDay;
    for (const cell of descendants(row, (node) => elementName(node) === "td")) {
      const text = normalizedText(cell);
      if (text === "" || /休演日|貸切公演/u.test(text)) continue;
      const clock = parseJapaneseClock(text);
      if (clock === null) continue;
      const candidateYears = [
        ...new Set([Number(startsOn.slice(0, 4)), Number(endsOn.slice(0, 4))]),
      ];
      const date = candidateYears
        .map((year) => calendarDate(year, monthDay.month, monthDay.day))
        .find((candidate) => candidate >= startsOn && candidate <= endsOn);
      if (date === undefined) throw new SourceParseFailure();
      occurrences.push({
        startsAt: tokyoDateTime(date, clock.hour, clock.minute),
        endsAt: null,
      });
    }
  }
  if (rows.length > 0 && occurrences.length === 0)
    throw new SourceParseFailure();
  return occurrences;
}

export function createTakarazukaRevueAdapter(
  fetcher: OfficialHtmlFetcher = fetchOfficialHtml,
): OfficialSourceAdapter {
  return {
    async acquire(source): Promise<readonly EventAcquisitionDraft[]> {
      const index = await fetcher(source, source.canonicalUrl);
      const productions = parseTakarazukaIndex(source, index.body);
      const drafts: EventAcquisitionDraft[] = [];
      for (const production of productions) {
        const detail = await fetcher(source, production.canonicalUrl);
        const detailDocument = parseHtml(detail.body);
        const scheduleLinks = descendants(detailDocument, (node) => {
          const href = attribute(node, "href") ?? "";
          return (
            elementName(node) === "a" &&
            /schedule(?:_[a-z-]+)?\.html/u.test(href)
          );
        });
        for (const link of scheduleLinks) {
          const href = attribute(link, "href") ?? "";
          const linkVenueSlug = scheduleVenueSlug(href);
          const venue =
            linkVenueSlug === "single" && production.venues.length === 1
              ? production.venues[0]
              : production.venues.find(
                  (candidate) => candidate.venueSlug === linkVenueSlug,
                );
          if (venue === undefined) continue;
          const scheduleUrl = assertAllowedSourceUrl(
            source,
            new URL(href, detail.url).toString(),
          );
          const schedule = await fetcher(source, scheduleUrl);
          drafts.push({
            candidateKind: "event",
            canonicalUrl: schedule.url,
            officialExternalId: `${production.year}:${production.workSlug}:${venue.venueSlug}`,
            observedAt: schedule.observedAt,
            contentHash: hashOfficialDocuments([index, detail, schedule]),
            etag: schedule.etag,
            lastModified: schedule.lastModified,
            evidenceLocator: { sectionLabel: venue.venue },
            proposal: {
              sourceKey: `takarazuka:${production.year}:${production.workSlug}:${venue.venueSlug}`,
              title: production.title,
              venue: venue.venue,
              sourceUrl: schedule.url,
              startsOn: venue.startsOn,
              endsOn: venue.endsOn,
              occurrences: [
                ...parseTakarazukaSchedule(
                  schedule.body,
                  venue.startsOn,
                  venue.endsOn,
                ),
              ],
            },
          });
        }
      }
      return drafts;
    },
  };
}
