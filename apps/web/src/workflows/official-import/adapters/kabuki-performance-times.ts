import { SourceParseFailure } from "../acquisition";
import {
  attribute,
  descendants,
  elementName,
  hasClass,
  normalizedText,
  parseHtml,
  type HtmlNode,
} from "./html";
import { tokyoDateTime } from "./japanese-date";
import type { KabukiHeadlinePart } from "./kabuki-headline-period";

type Occurrence = { readonly startsAt: string; readonly endsAt: string | null };

// Support only the observed timetable shape. Extra text or elements hold the
// page rather than projecting one end across every date.
function elements(node: HtmlNode): HtmlNode[] | null {
  if (!("childNodes" in node)) return null;
  if (
    node.childNodes.some(
      (child) => elementName(child) === null && normalizedText(child) !== "",
    )
  )
    return null;
  return node.childNodes.filter((child) => elementName(child) !== null);
}

function clock(value: string): number | null {
  const match = value.normalize("NFKC").match(/^(\d{1,2}):(\d{2})$/u);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  return match !== null && hour >= 1 && hour <= 12 && minute <= 59
    ? (hour % 12) * 60 + minute
    : null;
}

function nextClock(value: number, after: number): number {
  let result = value;
  while (result < after) result += 12 * 60;
  return result;
}

function partEnd(part: HtmlNode, opening: number): number | null {
  const partElements = elements(part);
  const [header, content] = partElements ?? [];
  if (
    partElements?.length !== 2 ||
    header === undefined ||
    content === undefined ||
    elementName(header) !== "dt" ||
    elementName(content) !== "dd"
  )
    return null;
  const headerElements = elements(header);
  const label = headerElements?.[0];
  if (
    headerElements?.length !== 1 ||
    label === undefined ||
    elementName(label) !== "span" ||
    !("childNodes" in label) ||
    label.childNodes.some((child) => child.nodeName !== "#text")
  )
    return null;
  const contentElements = elements(content);
  const [list] = contentElements ?? [];
  if (
    contentElements?.length !== 1 ||
    list === undefined ||
    elementName(list) !== "ul" ||
    !hasClass(list, "type-program")
  )
    return null;
  const entries = elements(list);
  if (entries === null || entries.length === 0) return null;

  let previousEnd = opening;
  let acts = 0;
  for (const [index, entry] of entries.entries()) {
    if (elementName(entry) !== "li") return null;
    const children = elements(entry);
    if (children === null) return null;
    if (hasClass(entry, "type-interlude")) {
      if (
        acts === 0 ||
        index === entries.length - 1 ||
        !/^幕間\s*\d+分$/u.test(normalizedText(entry)) ||
        children.length !== 1 ||
        children[0] === undefined ||
        elementName(children[0]) !== "span"
      )
        return null;
      continue;
    }
    const times = children.filter(
      (child) => elementName(child) === "time" && hasClass(child, "time"),
    );
    const titles = children.filter(
      (child) => elementName(child) === "p" && hasClass(child, "playname"),
    );
    const time = times[0];
    if (
      times.length !== 1 ||
      time === undefined ||
      titles.length > 1 ||
      titles.some((title) => /※/u.test(normalizedText(title))) ||
      children.some((child) => child !== time && !titles.includes(child)) ||
      !("childNodes" in time) ||
      time.childNodes.some((child) => child.nodeName !== "#text")
    )
      return null;
    const match = normalizedText(time)
      .normalize("NFKC")
      .match(/^(\d{1,2}:\d{2})\s*[-−–—]\s*(\d{1,2}:\d{2})$/u);
    const startClock = clock(match?.[1] ?? "");
    const endClock = clock(match?.[2] ?? "");
    if (startClock === null || endClock === null || startClock === endClock)
      return null;
    const start = nextClock(startClock, previousEnd);
    const end = nextClock(endClock, start + 1);
    if ((acts === 0 && start !== opening) || end >= 24 * 60) return null;
    previousEnd = end;
    acts++;
  }
  return previousEnd;
}

/** Observed act-by-act format only; unknown layouts hold the source page. */
export function withKabukiPerformanceEnds<T extends Occurrence>(
  html: string,
  occurrences: readonly T[],
  headlineParts: readonly KabukiHeadlinePart[] | null,
): { occurrences: T[]; verified: boolean } {
  const unchanged = { occurrences: [...occurrences], verified: false };
  const document = parseHtml(html);
  const sections = descendants(
    document,
    (node) =>
      elementName(node) === "section" && attribute(node, "id") === "timetable",
  );
  if (sections.length === 0) {
    if (
      descendants(
        document,
        (node) =>
          elementName(node) === "h3" && normalizedText(node) === "上演時間",
      ).length > 0
    )
      throw new SourceParseFailure();
    return unchanged;
  }
  if (sections.length !== 1 || headlineParts === null)
    throw new SourceParseFailure();
  // A dated calendar may assign different programs to the same opening clock.
  if (
    descendants(
      document,
      (node) =>
        (elementName(node) === "table" && hasClass(node, "type-calendar")) ||
        (elementName(node) === "section" &&
          attribute(node, "id") === "schedule"),
    ).length > 0
  )
    return unchanged;
  const section = sections[0];
  if (section === undefined) throw new SourceParseFailure();
  const sectionElements = elements(section);
  const parts = sectionElements?.filter((node) => elementName(node) === "dl");
  const notes = sectionElements?.filter((node) => elementName(node) === "div");
  if (
    sectionElements === null ||
    sectionElements[0] === undefined ||
    elementName(sectionElements[0]) !== "h3" ||
    normalizedText(sectionElements[0]) !== "上演時間" ||
    parts?.length !== headlineParts.length ||
    (notes?.length ?? 0) > 1 ||
    sectionElements.some(
      (node) => !["h3", "dl", "div"].includes(elementName(node) ?? ""),
    ) ||
    parts.some((node) => !hasClass(node, "type-part"))
  )
    throw new SourceParseFailure();
  const note = notes?.[0] === undefined ? "" : normalizedText(notes[0]);
  if (
    note !== "" &&
    !/^(?:※\d{1,2}月\d{1,2}日時点での予定\s*)?※上演時間は変更になる可能性があります$/u.test(
      note,
    )
  )
    throw new SourceParseFailure();

  const ends = new Map<string, number>();
  for (const [index, part] of parts.entries()) {
    const headline = headlineParts[index];
    const header = elements(part)?.[0];
    if (
      headline === undefined ||
      header === undefined ||
      normalizedText(header) !== headline.name
    )
      throw new SourceParseFailure();
    const opening = headline.clock.hour * 60 + headline.clock.minute;
    const end = partEnd(part, opening);
    const label = `${String(headline.clock.hour).padStart(2, "0")}:${String(headline.clock.minute).padStart(2, "0")}`;
    if (end === null || ends.has(label)) throw new SourceParseFailure();
    ends.set(label, end);
  }
  if (
    occurrences.some(
      (occurrence) => !ends.has(occurrence.startsAt.slice(11, 16)),
    )
  )
    throw new SourceParseFailure();
  return {
    verified: true,
    occurrences: occurrences.map((occurrence) => {
      const minutes = ends.get(occurrence.startsAt.slice(11, 16));
      if (minutes === undefined) return occurrence;
      return {
        ...occurrence,
        endsAt: tokyoDateTime(
          occurrence.startsAt.slice(0, 10),
          Math.floor(minutes / 60),
          minutes % 60,
        ),
      };
    }),
  };
}
