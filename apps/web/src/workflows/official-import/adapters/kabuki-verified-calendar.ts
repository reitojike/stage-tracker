import { createHash } from "node:crypto";
import { SourceParseFailure } from "../acquisition";
import {
  attribute,
  descendants,
  elementName,
  hasClass,
  normalizedText,
  parseHtml,
  textContent,
  type HtmlNode,
} from "./html";
import {
  parseKabukiBaseTimes,
  parseKabukiDaySet,
  type KabukiHeadlinePart,
} from "./kabuki-headline-period";
import { calendarDate, enumerateDates, tokyoDateTime } from "./japanese-date";

type CalendarRows = Map<string, readonly string[]>;
const WEEKDAYS = "日月火水木金土";
// Fingerprints of observed non-scheduling prose on the named major-theater
// pages. These are exact exceptions, not a grammar for arbitrary footnotes.
const KABUKIZA_986_PRESHOW_NOTE_SHA256 =
  "d2251fede6f8a365da2c23a9516d0a2803c5d7684bc3668b93c6aba7a14216a5";
const MINAMIZA_965_FOOTER_SHA256 =
  "1c24f0451a9051d7386d62205cc8f4eea04d0f2db08fbfd34f1988c80ad4484b";
const CELL_CLASSES = new Set([
  "",
  "th",
  "th type-sun",
  "th type-sat",
  "td",
  "td type-sun",
  "td type-sat",
  "td type-weekday",
  "' . th type-day type-sun . '",
  "' . th type-day type-sat . '",
  "' . th type-day type-weekday . '",
]);

function unique(nodes: readonly HtmlNode[]): HtmlNode {
  if (nodes.length !== 1 || nodes[0] === undefined)
    throw new SourceParseFailure();
  return nodes[0];
}

function childElements(node: HtmlNode): HtmlNode[] {
  return "childNodes" in node
    ? node.childNodes.filter((child) => elementName(child) !== null)
    : [];
}

function onlyChildren(node: HtmlNode, tagName: string): HtmlNode[] {
  if (!("childNodes" in node)) throw new SourceParseFailure();
  const elements: HtmlNode[] = [];
  for (const child of node.childNodes) {
    if (child.nodeName === "#text" && normalizedText(child) === "") continue;
    if (elementName(child) !== tagName) throw new SourceParseFailure();
    elements.push(child);
  }
  return elements;
}

function tableRows(table: HtmlNode): HtmlNode[] {
  if (!("childNodes" in table)) throw new SourceParseFailure();
  const sections = table.childNodes.filter((child) => {
    if (child.nodeName === "#text" && normalizedText(child) === "")
      return false;
    return true;
  });
  if (
    (sections.length !== 1 && sections.length !== 2) ||
    elementName(sections[sections.length - 1] ?? table) !== "tbody" ||
    (sections.length === 2 && elementName(sections[0] ?? table) !== "thead")
  )
    throw new SourceParseFailure();
  const head =
    sections.length === 2 ? onlyChildren(sections[0] ?? table, "tr") : [];
  if (sections.length === 2 && head.length !== 1)
    throw new SourceParseFailure();
  const body = onlyChildren(sections[sections.length - 1] ?? table, "tr");
  return [...head, ...body];
}

function assertCalendarMarkup(
  table: HtmlNode,
  view: "view-pc" | "view-sp",
): void {
  for (const node of descendants(table, () => true)) {
    if (node.nodeName === "#text") continue;
    const tag = elementName(node);
    const attrs = "attrs" in node ? node.attrs : [];
    const classes = attribute(node, "class") ?? "";
    const expectedTableClasses = new Set([
      `table type-calendar ${view}`,
      `type-calendar ${view}`,
    ]);
    if (
      (tag === "table" &&
        (!expectedTableClasses.has(classes) || attrs.length !== 1)) ||
      ((tag === "thead" || tag === "tbody" || tag === "br") &&
        attrs.length !== 0) ||
      (tag === "tr" &&
        (!["", "tr", "type-day", "tr type-day"].includes(classes) ||
          attrs.length !== (classes === "" ? 0 : 1))) ||
      ((tag === "th" || tag === "td") &&
        (!CELL_CLASSES.has(classes) ||
          attrs.some(
            (attr) =>
              (attr.name !== "class" &&
                !(
                  tag === "th" &&
                  attr.name === "rowspan" &&
                  attr.value === "2"
                )) ||
              (attr.name === "class" && !CELL_CLASSES.has(attr.value)),
          ) ||
          attrs.filter((attr) => attr.name === "class").length !==
            (classes === "" ? 0 : 1))) ||
      (tag === "span" &&
        (view !== "view-pc" ||
          classes !== "span" ||
          attrs.length !== 1 ||
          ("childNodes" in node &&
            node.childNodes.some((child) => child.nodeName !== "#text")))) ||
      !["table", "thead", "tbody", "tr", "th", "td", "span", "br"].includes(
        tag ?? "",
      )
    )
      throw new SourceParseFailure();
  }
}

function plainCellText(cell: HtmlNode, allowBreak = false): string {
  if (
    !("childNodes" in cell) ||
    cell.childNodes.some(
      (child) =>
        child.nodeName !== "#text" &&
        !(allowBreak && elementName(child) === "br"),
    ) ||
    (allowBreak &&
      cell.childNodes.filter((child) => elementName(child) === "br").length !==
        1)
  )
    throw new SourceParseFailure();
  return normalizedText(cell);
}

function cells(row: HtmlNode): HtmlNode[] {
  return descendants(row, (node) =>
    ["th", "td"].includes(elementName(node) ?? ""),
  );
}

function noSpan(cell: HtmlNode): void {
  if (
    attribute(cell, "rowspan") !== null ||
    attribute(cell, "colspan") !== null
  )
    throw new SourceParseFailure();
}

function token(value: string): string {
  const normalized = value.replace(/：/gu, ":");
  if (normalized === "-" || normalized === "貸切") return normalized;
  if (["〇", "○", "A", "B", "Aプロ", "Bプロ"].includes(normalized))
    return normalized === "○" ? "〇" : normalized;
  const clock = normalized.match(/^(\d{1,2}):(\d{2})(★)?$/u);
  if (clock === null) throw new SourceParseFailure();
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (hour > 23 || minute > 59) throw new SourceParseFailure();
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}${clock[3] ?? ""}`;
}

function dateForDay(day: number, year: number, month: number): string {
  return calendarDate(year, month, day);
}

function parseMobile(
  table: HtmlNode,
  dates: readonly string[],
  labels: readonly string[],
  year: number,
  month: number,
): CalendarRows {
  const rows = tableRows(table);
  if (rows.length !== dates.length + 1) throw new SourceParseFailure();
  const header = cells(rows[0] ?? table);
  if (
    header.length !== labels.length + 1 ||
    header.some((cell) => elementName(cell) !== "th") ||
    plainCellText(header[0] ?? table) !== "" ||
    labels.some(
      (label, index) => plainCellText(header[index + 1] ?? table) !== label,
    )
  )
    throw new SourceParseFailure();
  header.forEach(noSpan);
  const result: CalendarRows = new Map();
  for (const [index, row] of rows.slice(1).entries()) {
    const fields = cells(row);
    if (
      fields.length !== labels.length + 1 ||
      elementName(fields[0] ?? row) !== "th" ||
      fields.slice(1).some((cell) => elementName(cell) !== "td")
    )
      throw new SourceParseFailure();
    fields.forEach(noSpan);
    const day = plainCellText(fields[0] ?? row, true).match(
      /^(\d{1,2})[（(]([日月火水木金土])[）)]$/u,
    );
    if (day === null) throw new SourceParseFailure();
    const date = dateForDay(Number(day[1]), year, month);
    if (
      date !== dates[index] ||
      day[2] !== WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]
    )
      throw new SourceParseFailure();
    result.set(
      date,
      fields.slice(1).map((cell) => token(plainCellText(cell))),
    );
  }
  return result;
}

function spanTexts(cell: HtmlNode, count: number): string[] {
  const spans = descendants(cell, (node) => elementName(node) === "span");
  if (
    spans.length !== count ||
    spans.some((span) => !hasClass(span, "span")) ||
    textContent(cell).replace(/\s+/gu, "") !==
      spans.map(textContent).join("").replace(/\s+/gu, "")
  )
    throw new SourceParseFailure();
  return spans.map(normalizedText);
}

function parseDesktop(
  table: HtmlNode,
  labels: readonly string[],
  year: number,
  month: number,
): CalendarRows {
  const rows = tableRows(table);
  if (rows.length < 3 || rows.length % 2 !== 1) throw new SourceParseFailure();
  const header = cells(rows[0] ?? table);
  if (
    header.length !== 8 ||
    header.some((cell) => elementName(cell) !== "th") ||
    plainCellText(header[0] ?? table) !== "" ||
    attribute(header[0] ?? table, "rowspan") !== "2" ||
    [...WEEKDAYS].some(
      (weekday, index) => plainCellText(header[index + 1] ?? table) !== weekday,
    )
  )
    throw new SourceParseFailure();
  header.slice(1).forEach(noSpan);
  const result: CalendarRows = new Map();
  for (let pair = 0; pair < (rows.length - 1) / 2; pair += 1) {
    const dateRow = rows[pair * 2 + 1] ?? table;
    const timeRow = rows[pair * 2 + 2] ?? table;
    if (!hasClass(dateRow, "type-day") || hasClass(timeRow, "type-day"))
      throw new SourceParseFailure();
    const dayCells = cells(dateRow);
    const timeCells = cells(timeRow);
    if (
      dayCells.length !== (pair === 0 ? 7 : 8) ||
      timeCells.length !== 8 ||
      timeCells.some((cell) => elementName(cell) !== "td") ||
      (pair > 0 && plainCellText(dayCells[0] ?? dateRow) !== "") ||
      spanTexts(timeCells[0] ?? timeRow, labels.length).some(
        (label, index) => label !== labels[index],
      )
    )
      throw new SourceParseFailure();
    dayCells.forEach(noSpan);
    timeCells.forEach(noSpan);
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const dayText = plainCellText(
        dayCells[weekday + (pair === 0 ? 0 : 1)] ?? dateRow,
      );
      const timeCell = timeCells[weekday + 1] ?? timeRow;
      if (dayText === "") {
        if (normalizedText(timeCell) !== "") throw new SourceParseFailure();
        continue;
      }
      if (!/^\d{1,2}$/u.test(dayText)) throw new SourceParseFailure();
      const date = dateForDay(Number(dayText), year, month);
      if (
        result.has(date) ||
        new Date(`${date}T00:00:00Z`).getUTCDay() !== weekday
      )
        throw new SourceParseFailure();
      result.set(date, spanTexts(timeCell, labels.length).map(token));
    }
  }
  return result;
}

function validateSchoolGroupNote(
  note: string,
  partNames: readonly string[],
  startsOn: string,
  endsOn: string,
): void {
  const prefix = "※下記日程は学校団体様がいらっしゃいます";
  if (!note.startsWith(prefix)) throw new SourceParseFailure();
  const entries = note.slice(prefix.length).trim();
  const labels = [
    ...entries.matchAll(/([昼夜朝]の部|第(?:[一二三四五六]|[1-6])部)[:：]/gu),
  ];
  if (
    labels.length === 0 ||
    entries.slice(0, labels[0]?.index ?? 0).trim() !== "" ||
    new Set(labels.map((label) => label[1])).size !== labels.length
  )
    throw new SourceParseFailure();
  for (const [index, label] of labels.entries()) {
    if (!partNames.includes(label[1] ?? "")) throw new SourceParseFailure();
    parseKabukiDaySet(
      entries.slice(
        (label.index ?? 0) + label[0].length,
        labels[index + 1]?.index ?? entries.length,
      ),
      startsOn,
      endsOn,
    );
  }
}

function validateCalendarNotes(
  note: string,
  rows: CalendarRows,
  parts: ReturnType<typeof parseKabukiBaseTimes>,
  startsOn: string,
  endsOn: string,
): string | null {
  let remainder = note.trim();
  const revisedPeriodNote = "※当初の発表から公演日程を変更しております";
  if (remainder.startsWith(revisedPeriodNote))
    remainder = remainder.slice(revisedPeriodNote.length).trim();

  const marked = [...rows].flatMap(([date, cells]) =>
    cells.flatMap((cell, index) =>
      cell.endsWith("★") ? [{ date, part: parts[index]?.name }] : [],
    ),
  );
  const detail = remainder.match(
    /^[【〖](?:休演|休演・貸切)[】〗]日程詳細をご確認ください(?:\s*(※下記日程は学校団体様がいらっしゃいます.+))?$/u,
  );
  if (detail !== null) {
    if (marked.length !== 0) throw new SourceParseFailure();
    if (detail[1] !== undefined)
      validateSchoolGroupNote(
        detail[1],
        parts.map((part) => part.name),
        startsOn,
        endsOn,
      );
    return null;
  }

  // A marked numeric clock is still an explicit clock. Only the verified
  // non-scheduling note may accompany it; a new note must be reviewed first.
  const markedDetail = remainder.match(
    /^[【〖](?:休演|休演・貸切)[】〗]日程詳細をご確認ください\s*(※.+)$/u,
  );
  if (markedDetail !== null && marked.length === 1) {
    const info = (markedDetail[1] ?? "").match(
      /^※(\d{1,2})日[（(]([日月火水木金土])[）)](.+?)は(.{1,180})$/u,
    );
    const markedCell = marked[0];
    const date = markedCell?.date ?? "";
    const body = info?.[4] ?? "";
    if (
      info === null ||
      markedCell?.part !== info[3] ||
      Number(date.slice(-2)) !== Number(info[1]) ||
      WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] !== info[2] ||
      body !== "「着物で歌舞伎」です。皆様、お着物でご観劇ください"
    )
      throw new SourceParseFailure();
    return `★${(markedDetail[1] ?? "").slice(1)}`;
  }

  const explicit = remainder.match(
    /^[【〖]休演[】〗](.+?)[【〖]貸切[】〗]※幕見席は営業\s*(.+)$/u,
  );
  if (explicit === null || marked.length !== 0) throw new SourceParseFailure();
  const closed = parseKabukiDaySet(explicit[1] ?? "", startsOn, endsOn);
  let privateText = explicit[2] ?? "";
  const informationalPrefix = "昼の部では、古式に則り、";
  const informationalAt = privateText.indexOf(informationalPrefix);
  if (informationalAt >= 0) {
    const informational = privateText.slice(informationalAt);
    privateText = privateText.slice(0, informationalAt).trim();
    const daytime = parts.find((part) => part.name === "昼の部");
    if (
      daytime?.clock.hour !== 11 ||
      daytime.clock.minute !== 0 ||
      createHash("sha256").update(informational).digest("hex") !==
        KABUKIZA_986_PRESHOW_NOTE_SHA256
    )
      throw new SourceParseFailure();
  }
  const labels = [
    ...privateText.matchAll(
      /([昼夜朝]の部|第(?:[一二三四五六]|[1-6])部)[:：]/gu,
    ),
  ];
  if (
    labels.length === 0 ||
    privateText.slice(0, labels[0]?.index ?? 0).trim() !== "" ||
    new Set(labels.map((label) => label[1])).size !== labels.length
  )
    throw new SourceParseFailure();
  const privateByPart = new Map<string, Set<string>>();
  for (const [index, label] of labels.entries()) {
    const name = label[1] ?? "";
    if (!parts.some((part) => part.name === name))
      throw new SourceParseFailure();
    privateByPart.set(
      name,
      parseKabukiDaySet(
        privateText.slice(
          (label.index ?? 0) + label[0].length,
          labels[index + 1]?.index ?? privateText.length,
        ),
        startsOn,
        endsOn,
      ),
    );
  }
  for (const [date, cells] of rows) {
    if (closed.has(date) !== cells.every((cell) => cell === "-"))
      throw new SourceParseFailure();
    for (const [index, part] of parts.entries()) {
      if (
        (privateByPart.get(part.name)?.has(date) ?? false) ===
        (cells[index] === "貸切")
      )
        continue;
      throw new SourceParseFailure();
    }
  }
  return null;
}

export function parseKabukiVerifiedCalendar(
  startsOn: string,
  endsOn: string,
  timetable: string,
  html: string,
): {
  readonly occurrences: readonly { startsAt: string; endsAt: null }[];
  readonly hasAnnotation: boolean;
  readonly headlineParts: readonly KabukiHeadlinePart[];
  readonly hasOnlyHeadlineClocks: boolean;
} {
  const dates = enumerateDates(startsOn, endsOn);
  if (startsOn.slice(0, 7) !== endsOn.slice(0, 7))
    throw new SourceParseFailure();
  const year = Number(startsOn.slice(0, 4));
  const month = Number(startsOn.slice(5, 7));
  const markerAt = [...timetable.matchAll(/[【〖※]/gu)][0]?.index;
  if (markerAt === undefined || /現地時間/u.test(timetable))
    throw new SourceParseFailure();
  const parts = parseKabukiBaseTimes(timetable.slice(0, markerAt));
  const note = timetable.slice(markerAt);
  const labels = parts.map((part) =>
    part.name === "単独"
      ? `${String(part.clock.hour).padStart(2, "0")}：${String(part.clock.minute).padStart(2, "0")}`
      : part.name,
  );
  const document = parseHtml(html);
  const section = unique(
    descendants(
      document,
      (node) =>
        elementName(node) === "section" && attribute(node, "id") === "schedule",
    ),
  );
  const tables = descendants(
    section,
    (node) => elementName(node) === "table" && hasClass(node, "type-calendar"),
  );
  const allCalendars = descendants(
    document,
    (node) => elementName(node) === "table" && hasClass(node, "type-calendar"),
  );
  const headings = descendants(section, (node) => elementName(node) === "h4");
  if (
    tables.length !== 2 ||
    allCalendars.length !== 2 ||
    allCalendars.some((table) => !tables.includes(table))
  )
    throw new SourceParseFailure();
  const expectedHeading = `${year}年${month}月`;
  const mobile = unique(tables.filter((table) => hasClass(table, "view-sp")));
  const desktop = unique(tables.filter((table) => hasClass(table, "view-pc")));
  assertCalendarMarkup(mobile, "view-sp");
  assertCalendarMarkup(desktop, "view-pc");
  const sectionChildren = childElements(section);
  const footer = sectionChildren[5];
  const footerText = footer === undefined ? null : normalizedText(footer);
  if (
    ("childNodes" in section &&
      section.childNodes.some(
        (child) => child.nodeName === "#text" && normalizedText(child) !== "",
      )) ||
    (sectionChildren.length !== 5 && sectionChildren.length !== 6) ||
    elementName(sectionChildren[0] ?? section) !== "h3" ||
    normalizedText(sectionChildren[0] ?? section) !== "日程詳細" ||
    sectionChildren[1] !==
      headings.find((heading) => hasClass(heading, "view-pc")) ||
    sectionChildren[2] !== desktop ||
    sectionChildren[3] !==
      headings.find((heading) => hasClass(heading, "view-sp")) ||
    sectionChildren[4] !== mobile ||
    (footer !== undefined &&
      (elementName(footer) !== "p" || !hasClass(footer, "schedule-footer")))
  )
    throw new SourceParseFailure();
  for (const view of ["view-sp", "view-pc"]) {
    if (
      normalizedText(
        unique(headings.filter((heading) => hasClass(heading, view))),
      ) !== expectedHeading
    )
      throw new SourceParseFailure();
  }
  const mobileRows = parseMobile(mobile, dates, labels, year, month);
  const desktopRows = parseDesktop(desktop, labels, year, month);
  if (desktopRows.size !== mobileRows.size) throw new SourceParseFailure();
  for (const [date, cells] of mobileRows) {
    const other = desktopRows.get(date);
    if (
      other === undefined ||
      other.length !== cells.length ||
      cells.some((cell, index) => cell !== other[index])
    )
      throw new SourceParseFailure();
  }
  const annotationFooter = validateCalendarNotes(
    note,
    mobileRows,
    parts,
    startsOn,
    endsOn,
  );
  const knownFooter =
    footerText === "※貸切公演が入る場合があります" ||
    (footerText !== null &&
      createHash("sha256").update(footerText).digest("hex") ===
        MINAMIZA_965_FOOTER_SHA256);
  if (
    (annotationFooter !== null && footerText !== annotationFooter) ||
    (annotationFooter === null && footerText !== null && !knownFooter)
  )
    throw new SourceParseFailure();
  for (const [index, part] of parts.entries()) {
    const base = `${String(part.clock.hour).padStart(2, "0")}:${String(part.clock.minute).padStart(2, "0")}`;
    const values = [...mobileRows.values()].map((cells) => cells[index]);
    const symbols = ["〇", "A", "B", "Aプロ", "Bプロ"];
    const hasSymbol = values.some((value) => symbols.includes(value ?? ""));
    if (!hasSymbol && !values.includes(base)) throw new SourceParseFailure();
  }
  const occurrences = dates.flatMap((date) =>
    (mobileRows.get(date) ?? []).flatMap((cell, index) => {
      if (cell === "-" || cell === "貸切") return [];
      const clock = /^\d{2}:\d{2}★?$/u.test(cell)
        ? cell.replace(/★$/u, "").split(":").map(Number)
        : [parts[index]?.clock.hour, parts[index]?.clock.minute];
      const [hour, minute] = clock;
      return [
        {
          startsAt: tokyoDateTime(date, hour ?? -1, minute ?? -1),
          endsAt: null,
        },
      ];
    }),
  );
  if (occurrences.length === 0) throw new SourceParseFailure();
  const hasOnlyHeadlineClocks = [...mobileRows.values()].every((cells) =>
    cells.every((cell, index) => {
      const clock = parts[index]?.clock;
      if (clock === undefined) return false;
      const headlineClock = `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`;
      return (
        cell === "-" ||
        cell === "貸切" ||
        cell === headlineClock ||
        cell === `${headlineClock}★`
      );
    }),
  );
  return {
    occurrences,
    hasAnnotation: annotationFooter !== null,
    headlineParts: parts,
    hasOnlyHeadlineClocks,
  };
}
