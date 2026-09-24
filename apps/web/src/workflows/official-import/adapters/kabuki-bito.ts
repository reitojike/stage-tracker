import { createHash } from "node:crypto";
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
  enumerateDates,
  parseJapaneseClock,
  tokyoDateTime,
} from "./japanese-date";
import {
  parseKabukiDaySet,
  parseKabukiHeadlinePeriod,
  validateKabukiWeekdayAnnotation,
} from "./kabuki-headline-period";
import { parseKabukiVerifiedCalendar } from "./kabuki-verified-calendar";

const MAX_PLAYS_PER_SCAN = 30;
const KABUKIZA_997_UNTIMED_NOTE_SHA256 =
  "049963564e7bd7fdf688b23646c76335aeed9340c4fff07a76fe5152cb7b1182";

function parseKabukiPeriod(text: string): {
  startsOn: string;
  endsOn: string;
} | null {
  const normalized = text.replace(/\s+/gu, "");
  // A month-only teaser has no exact performance date to stage. It is still
  // counted against the index cap and may be revisited on a later weekly scan.
  if (/^\d{4}年\d{1,2}月$/u.test(normalized)) return null;
  const single = normalized.match(
    /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:[（(]([^）)]+)[）)])?$/u,
  );
  if (single !== null) {
    const date = calendarDate(
      Number(single[1]),
      Number(single[2]),
      Number(single[3]),
    );
    if (single[4] !== undefined)
      validateKabukiWeekdayAnnotation(date, single[4]);
    return { startsOn: date, endsOn: date };
  }
  const range = normalized.match(
    /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:[（(]([^）)]+)[）)])?[～〜](?:(\d{4})年)?(?:(\d{1,2})月)?(\d{1,2})日(?:[（(]([^）)]+)[）)])?$/u,
  );
  if (range === null) throw new SourceParseFailure();
  if (range[5] !== undefined && range[6] === undefined)
    throw new SourceParseFailure();
  const startYear = Number(range[1]);
  const startMonth = Number(range[2]);
  const startsOn = calendarDate(startYear, startMonth, Number(range[3]));
  const endMonth = Number(range[6] ?? range[2]);
  const endYear =
    range[5] === undefined && endMonth < startMonth
      ? startYear + 1
      : Number(range[5] ?? range[1]);
  const endsOn = calendarDate(endYear, endMonth, Number(range[7]));
  if (startsOn > endsOn) throw new SourceParseFailure();
  if (range[4] !== undefined)
    validateKabukiWeekdayAnnotation(startsOn, range[4]);
  if (range[8] !== undefined) validateKabukiWeekdayAnnotation(endsOn, range[8]);
  return { startsOn, endsOn };
}

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
  if (candidateItems.length === 0) throw new SourceParseFailure();
  const allPlayUrls = new Set<string>();
  const datedRowUrls = new Set<string>();
  const fullRowUrls = new Set<string>();
  const facts: KabukiIndexFact[] = [];
  for (const item of candidateItems) {
    const anchor = descendants(item, (node) => {
      const href = attribute(node, "href") ?? "";
      return (
        elementName(node) === "a" && /\/theaters\/[^/]+\/play\/\d+/u.test(href)
      );
    })[0];
    if (anchor === undefined) throw new SourceParseFailure();
    const href = attribute(anchor, "href") ?? "";
    const identity = href.match(/\/theaters\/([^/]+)\/play\/(\d+)/u);
    const canonicalUrl = assertAllowedSourceUrl(
      source,
      new URL(href, source.canonicalUrl).toString(),
    );
    allPlayUrls.add(canonicalUrl);
    const titleNode = descendants(item, (node) => hasClass(node, "ttl"))[0];
    const termNode = descendants(item, (node) => hasClass(node, "term"))[0];
    const theater = identity?.[1];
    const officialId = identity?.[2];
    if (theater === undefined || officialId === undefined)
      throw new SourceParseFailure();
    // The index repeats some productions in a teaser carousel without the
    // detailed title/term fields. Every teaser must have a full row below.
    if (titleNode === undefined && termNode === undefined) continue;
    if (titleNode === undefined || termNode === undefined)
      throw new SourceParseFailure();
    if (fullRowUrls.has(canonicalUrl)) throw new SourceParseFailure();
    fullRowUrls.add(canonicalUrl);
    const range = parseKabukiPeriod(normalizedText(termNode));
    if (range === null) continue;
    datedRowUrls.add(canonicalUrl);
    facts.push({
      officialId,
      theater,
      canonicalUrl,
      title: normalizedText(titleNode),
      ...range,
    });
  }
  if (
    allPlayUrls.size > MAX_PLAYS_PER_SCAN ||
    [...allPlayUrls].some((url) => !fullRowUrls.has(url)) ||
    datedRowUrls.size !== facts.length
  )
    throw new SourceParseFailure();
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

function dateForDayInRange(
  day: number,
  startsOn: string,
  endsOn: string,
): string {
  const matches = enumerateDates(startsOn, endsOn).filter(
    (date) => Number(date.slice(-2)) === day,
  );
  const date = matches[0];
  if (matches.length !== 1 || date === undefined)
    throw new SourceParseFailure();
  return date;
}

export function parseKabukiDetailedOccurrences(
  startsOn: string,
  endsOn: string,
  timetable: string,
  html = "",
): readonly { startsAt: string; endsAt: null }[] {
  // A calendar is authoritative only when both rendered views and the entire
  // headline can be verified together. Never expand its base times by default.
  if (
    descendants(
      parseHtml(html),
      (node) =>
        elementName(node) === "table" && hasClass(node, "type-calendar"),
    ).length > 0
  )
    return parseKabukiVerifiedCalendar(startsOn, endsOn, timetable, html);
  // Some short engagements publish each date/time directly in the headline.
  // Require every date and clock token to be paired. Varying daily tables are
  // not yet mapped to verified showtime columns and cannot be inferred here.
  const datedClock =
    /(\d{1,2})日(?:[（(]([^）)]+)[）)])?\s*(午前|午後)?\s*(\d{1,2})時(?:\s*(\d{1,2})分)?\s*[～〜]?/gu;
  const matches = [...timetable.matchAll(datedClock)];
  const allDates = timetable.match(/\d{1,2}日/gu) ?? [];
  const allClocks =
    timetable.match(/(?:午前|午後)?\s*\d{1,2}時(?:\s*\d{1,2}分)?/gu) ?? [];
  if (
    matches.length > 0 &&
    matches.length === allDates.length &&
    matches.length === allClocks.length &&
    timetable.replace(datedClock, "").replace(/[、，・／/\s～〜—－-]/gu, "") ===
      ""
  ) {
    const seen = new Set<string>();
    const coveredDates = new Set<string>();
    const occurrences = matches.map((match) => {
      const date = dateForDayInRange(Number(match[1]), startsOn, endsOn);
      if (match[2] !== undefined)
        validateKabukiWeekdayAnnotation(date, match[2]);
      const sourceHour = Number(match[4]);
      const sourceMinute = Number(match[5] ?? 0);
      if (
        sourceHour < (match[3] === undefined ? 0 : 1) ||
        sourceHour > (match[3] === undefined ? 23 : 12) ||
        sourceMinute > 59
      )
        throw new SourceParseFailure();
      coveredDates.add(date);
      const clock = parseJapaneseClock(
        `${match[3] ?? ""}${match[4]}時${match[5] ?? ""}分`,
      );
      if (clock === null) throw new SourceParseFailure();
      const startsAt = tokyoDateTime(date, clock.hour, clock.minute);
      if (seen.has(startsAt)) throw new SourceParseFailure();
      seen.add(startsAt);
      return { startsAt, endsAt: null };
    });
    if (
      enumerateDates(startsOn, endsOn).some((date) => !coveredDates.has(date))
    )
      throw new SourceParseFailure();
    return occurrences;
  }

  return parseKabukiHeadlinePeriod(startsOn, endsOn, timetable);
}

function detailText(html: string, className: string): string | null {
  const document = parseHtml(html);
  const node = descendants(document, (candidate) =>
    hasClass(candidate, className),
  )[0];
  return node === undefined ? null : normalizedText(node);
}

function verifiedDetailText(
  node: ReturnType<typeof parseHtml>,
  className: string,
): string {
  let ancestor: ReturnType<typeof parseHtml> | null = node;
  while (ancestor !== null) {
    if (
      ["del", "s", "strike"].includes(elementName(ancestor) ?? "") ||
      /(?:^|\s)(?:cancelled|canceled|deleted|struck|strikethrough|is-cancelled|is-canceled|is-deleted)(?:\s|$)/iu.test(
        attribute(ancestor, "class") ?? "",
      ) ||
      /(?:^|;)\s*text-decoration(?:-line)?\s*:\s*[^;]*\bline-through\b/iu.test(
        attribute(ancestor, "style") ?? "",
      )
    )
      throw new SourceParseFailure();
    ancestor = "parentNode" in ancestor ? ancestor.parentNode : null;
  }
  const classNames = (attribute(node, "class") ?? "")
    .split(/\s+/u)
    .filter(Boolean);
  if (
    elementName(node) !== "p" ||
    classNames.length < 1 ||
    classNames.length > 2 ||
    !classNames.includes(className) ||
    classNames.some((name) => name !== className && name !== "text") ||
    !("attrs" in node) ||
    node.attrs.length !== 1 ||
    !("childNodes" in node) ||
    node.childNodes.some(
      (child) =>
        child.nodeName !== "#text" &&
        !(
          elementName(child) === "br" &&
          "attrs" in child &&
          child.attrs.length === 0
        ),
    )
  )
    throw new SourceParseFailure();
  return normalizedText(node);
}

function verifiedDetailSchedule(html: string): {
  timetable: string;
  period: { startsOn: string; endsOn: string };
} {
  const document = parseHtml(html);
  const timetables = descendants(document, (node) =>
    hasClass(node, "type-timetable"),
  );
  const periods = descendants(
    document,
    (node) =>
      hasClass(node, "type-term") && /^\d{4}年/u.test(normalizedText(node)),
  );
  if (
    timetables.length !== 1 ||
    timetables[0] === undefined ||
    periods.length !== 1 ||
    periods[0] === undefined
  )
    throw new SourceParseFailure();
  const timetable = verifiedDetailText(timetables[0], "type-timetable");
  const period = parseKabukiPeriod(verifiedDetailText(periods[0], "type-term"));
  if (period === null) throw new SourceParseFailure();
  return { timetable, period };
}

function hasUnpublishedOpeningTime(
  timetable: string,
  html: string,
  startsOn: string,
  endsOn: string,
): boolean {
  const document = parseHtml(html);
  if (
    descendants(
      document,
      (node) =>
        (elementName(node) === "table" && hasClass(node, "type-calendar")) ||
        (elementName(node) === "section" &&
          attribute(node, "id") === "schedule"),
    ).length > 0
  )
    return false;
  // Exact dates are enough for an Event-only proposal, but only these observed
  // no-clock forms are understood. Unknown notices must reach the strict
  // parser and fail closed, not be classified by absence of blacklist tokens.
  if (timetable === "") return true;
  if (
    createHash("sha256").update(timetable).digest("hex") ===
    KABUKIZA_997_UNTIMED_NOTE_SHA256
  )
    return true;
  const rest = timetable.match(/^[【〖]休演[】〗](.+)$/u);
  if (rest !== null) {
    parseKabukiDaySet(rest[1] ?? "", startsOn, endsOn);
    return true;
  }
  return false;
}

export function createKabukiBitoAdapter(
  fetcher: OfficialHtmlFetcher = fetchOfficialHtml,
  pauseBetweenBatches: () => Promise<void> = () =>
    new Promise((resolve) => setTimeout(resolve, 1_000)),
): OfficialSourceAdapter {
  return {
    async acquire(source): Promise<readonly EventAcquisitionDraft[]> {
      const index = await fetcher(source, source.canonicalUrl);
      const facts = parseKabukiIndex(source, index.body);
      if (facts.length > MAX_PLAYS_PER_SCAN) throw new SourceParseFailure();
      const drafts: EventAcquisitionDraft[] = [];
      // A current index can contain dozens of plays. Avoid a simultaneous
      // burst against the official site even when the Cron itself is weekly.
      for (let offset = 0; offset < facts.length; offset += 2) {
        let firstFailure: { reason: unknown } | undefined;
        const settled = await Promise.allSettled(
          facts
            .slice(offset, offset + 2)
            .map(async (fact) => {
              const detail = await fetcher(source, fact.canonicalUrl);
              const finalPath = new URL(detail.url).pathname.match(
                /^\/theaters\/([^/]+)\/play\/(\d+)\/?$/u,
              );
              if (
                finalPath?.[1] !== fact.theater ||
                finalPath?.[2] !== fact.officialId
              )
                throw new SourceParseFailure();
              const { timetable, period } = verifiedDetailSchedule(detail.body);
              if (
                period.startsOn !== fact.startsOn ||
                period.endsOn !== fact.endsOn
              )
                throw new SourceParseFailure();
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
                  memo: /[【〖](?:休演|貸切)[】〗]/u.test(timetable)
                    ? "公式日程の休演・貸切日をOccurrence候補から除外"
                    : null,
                  sourceUrl: detail.url,
                  startsOn: fact.startsOn,
                  endsOn: fact.endsOn,
                  occurrences: hasUnpublishedOpeningTime(
                    timetable,
                    detail.body,
                    fact.startsOn,
                    fact.endsOn,
                  )
                    ? []
                    : [
                        ...parseKabukiDetailedOccurrences(
                          fact.startsOn,
                          fact.endsOn,
                          timetable,
                          detail.body,
                        ),
                      ],
                },
              };
            })
            .map((request) =>
              request.catch((reason: unknown) => {
                firstFailure ??= { reason };
                throw reason;
              }),
            ),
        );
        // A failed sibling must finish before the Workflow releases its lease
        // and retries; otherwise old and new attempts can overlap requests.
        // Preserve arrival order, not the input order returned by allSettled.
        if (firstFailure !== undefined) throw firstFailure.reason;
        drafts.push(
          ...settled.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : [],
          ),
        );
        if (offset + 2 < facts.length) await pauseBetweenBatches();
      }
      return drafts;
    },
  };
}
