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

type Occurrence = { readonly startsAt: string; readonly endsAt: string | null };

function children(node: HtmlNode, tag: string): HtmlNode[] {
  return "childNodes" in node
    ? node.childNodes.filter((child) => elementName(child) === tag)
    : [];
}

function clockMinutes(hour: string, minute: string): number | null {
  const hours = Number(hour);
  const minutes = Number(minute);
  if (hours < 1 || hours > 12 || minutes > 59) return null;
  return (hours % 12) * 60 + minutes;
}

function nextClock(clock: number, after: number): number | null {
  const candidates = [clock, clock + 12 * 60, clock + 24 * 60];
  return candidates.find((candidate) => candidate >= after) ?? null;
}

function verifiedTimeText(node: HtmlNode): string | null {
  if (
    !("childNodes" in node) ||
    node.childNodes.some((child) => child.nodeName !== "#text")
  )
    return null;
  let ancestor: HtmlNode | null = node;
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
      return null;
    ancestor = "parentNode" in ancestor ? ancestor.parentNode : null;
  }
  return normalizedText(node);
}

function partTimes(part: HtmlNode): { start: number; end: number } | null {
  const headers = children(part, "dt");
  const contents = children(part, "dd");
  const header = headers[0];
  const content = contents[0];
  if (
    headers.length !== 1 ||
    contents.length !== 1 ||
    header === undefined ||
    content === undefined
  )
    return null;
  if (
    !/^(?:[昼夜朝]の部|第(?:[一二三四五六]|[1-6])部)$/u.test(
      normalizedText(header),
    )
  )
    return null;
  const lists = descendants(
    content,
    (node) => elementName(node) === "ul" && hasClass(node, "type-program"),
  );
  const list = lists[0];
  if (lists.length !== 1 || list === undefined) return null;
  const entries = children(list, "li");
  let first: number | null = null;
  let previousEnd: number | null = null;
  for (const entry of entries) {
    if (hasClass(entry, "type-interlude")) continue;
    const clocks = descendants(
      entry,
      (node) => elementName(node) === "time" && hasClass(node, "time"),
    );
    const time = clocks[0];
    if (clocks.length !== 1 || time === undefined) return null;
    const text = verifiedTimeText(time);
    if (text === null) return null;
    const match = text
      .normalize("NFKC")
      .match(/^(\d{1,2}):(\d{2})\s*[-−–—]\s*(\d{1,2}):(\d{2})$/u);
    if (match === null) return null;
    const startClock = clockMinutes(match[1] ?? "", match[2] ?? "");
    const endClock = clockMinutes(match[3] ?? "", match[4] ?? "");
    if (startClock === null || endClock === null) return null;
    if (first === null) first = startClock;
    const start = nextClock(startClock, previousEnd ?? first);
    const end = start === null ? null : nextClock(endClock, start + 1);
    if (
      start === null ||
      end === null ||
      (previousEnd !== null && start - previousEnd > 3 * 60) ||
      end - start > 6 * 60 ||
      end - first > 12 * 60
    )
      return null;
    previousEnd = end;
  }
  return first === null || previousEnd === null
    ? null
    : { start: first, end: previousEnd };
}

/** Exact act-by-act timetable ends only. Unknown layouts leave existing end data untouched. */
export function withKabukiPerformanceEnds<T extends Occurrence>(
  html: string,
  occurrences: readonly T[],
): { occurrences: T[]; verified: boolean } {
  const unchanged = { occurrences: [...occurrences], verified: false };
  const document = parseHtml(html);
  // A dated calendar can vary the program without changing its opening clock.
  // Its end cannot be projected to every matching clock from one timetable.
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
  const sections = descendants(
    document,
    (node) =>
      elementName(node) === "section" && attribute(node, "id") === "timetable",
  );
  const section = sections[0];
  if (sections.length !== 1 || section === undefined) return unchanged;
  const headings = children(section, "h3");
  const notes = children(section, "div");
  const parts = children(section, "dl");
  const tags =
    "childNodes" in section
      ? section.childNodes.map(elementName).filter((name) => name !== null)
      : [];
  if (
    headings.length !== 1 ||
    headings[0] === undefined ||
    normalizedText(headings[0]) !== "上演時間" ||
    notes.length > 1 ||
    parts.length === 0 ||
    parts.some((part) => !hasClass(part, "type-part")) ||
    tags.some((tag) => !["h3", "dl", "div"].includes(tag))
  )
    return unchanged;
  const note = notes[0] === undefined ? "" : normalizedText(notes[0]);
  if (
    note !== "" &&
    !/^(?:※\d{1,2}月\d{1,2}日時点での予定\s*)?※上演時間は変更になる可能性があります$/u.test(
      note,
    )
  )
    return unchanged;
  const parsed = parts.map(partTimes);
  if (parsed.some((part) => part === null)) return unchanged;

  // The first act must agree with one and only one published opening clock.
  // This also keeps a 12-hour timetable from silently assigning an end to
  // the wrong morning/evening performance.
  const openingClocks = new Set(
    occurrences.map((occurrence) => occurrence.startsAt.slice(11, 16)),
  );
  const ends = new Map<string, number>();
  for (const part of parsed) {
    if (part === null) return unchanged;
    const matches = [...openingClocks].filter((clock) => {
      const minutes = Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
      return minutes % (12 * 60) === part.start;
    });
    const match = matches[0];
    if (matches.length !== 1 || match === undefined || ends.has(match))
      return unchanged;
    const opening = Number(match.slice(0, 2)) * 60 + Number(match.slice(3));
    ends.set(match, opening + (part.end - part.start));
  }
  if (ends.size !== openingClocks.size) return unchanged;
  return {
    verified: true,
    occurrences: occurrences.map((occurrence) => {
      const endMinutes = ends.get(occurrence.startsAt.slice(11, 16));
      if (endMinutes === undefined) return occurrence;
      const startDate = occurrence.startsAt.slice(0, 10);
      const endDate = new Date(`${startDate}T00:00:00Z`);
      endDate.setUTCDate(endDate.getUTCDate() + Math.floor(endMinutes / 1440));
      return {
        ...occurrence,
        endsAt: tokyoDateTime(
          endDate.toISOString().slice(0, 10),
          Math.floor(endMinutes / 60) % 24,
          endMinutes % 60,
        ),
      };
    }),
  };
}
