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
import { parseKabukiBaseTimes } from "./kabuki-headline-period";
import { calendarDate, enumerateDates, tokyoDateTime } from "./japanese-date";

type CalendarRows = Map<string, readonly string[]>;
const WEEKDAYS = "日月火水木金土";

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
  const clock = normalized.match(/^(\d{1,2}):(\d{2})$/u);
  if (clock === null) throw new SourceParseFailure();
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (hour > 23 || minute > 59) throw new SourceParseFailure();
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
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
    normalizedText(header[0] ?? table) !== "" ||
    labels.some(
      (label, index) => normalizedText(header[index + 1] ?? table) !== label,
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
    const day = normalizedText(fields[0] ?? row).match(
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
      fields.slice(1).map((cell) => token(normalizedText(cell))),
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
    normalizedText(header[0] ?? table) !== "" ||
    attribute(header[0] ?? table, "rowspan") !== "2" ||
    [...WEEKDAYS].some(
      (weekday, index) =>
        normalizedText(header[index + 1] ?? table) !== weekday,
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
      (pair > 0 && normalizedText(dayCells[0] ?? dateRow) !== "") ||
      spanTexts(timeCells[0] ?? timeRow, labels.length).some(
        (label, index) => label !== labels[index],
      )
    )
      throw new SourceParseFailure();
    dayCells.forEach(noSpan);
    timeCells.forEach(noSpan);
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const dayText = normalizedText(
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

export function parseKabukiVerifiedCalendar(
  startsOn: string,
  endsOn: string,
  timetable: string,
  html: string,
): readonly { startsAt: string; endsAt: null }[] {
  const dates = enumerateDates(startsOn, endsOn);
  if (startsOn.slice(0, 7) !== endsOn.slice(0, 7))
    throw new SourceParseFailure();
  const year = Number(startsOn.slice(0, 4));
  const month = Number(startsOn.slice(5, 7));
  const headline = timetable
    .trim()
    .match(/^(.*?)(?:【休演】|〖休演〗)日程詳細をご確認ください$/u);
  if (headline === null || /現地時間/u.test(timetable))
    throw new SourceParseFailure();
  const parts = parseKabukiBaseTimes(headline[1] ?? "");
  const labels = parts.map((part) => part.name);
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
  const sectionChildren = childElements(section);
  if (
    ("childNodes" in section &&
      section.childNodes.some(
        (child) => child.nodeName === "#text" && normalizedText(child) !== "",
      )) ||
    sectionChildren.length !== 5 ||
    elementName(sectionChildren[0] ?? section) !== "h3" ||
    normalizedText(sectionChildren[0] ?? section) !== "日程詳細" ||
    sectionChildren[1] !==
      headings.find((heading) => hasClass(heading, "view-pc")) ||
    sectionChildren[2] !== desktop ||
    sectionChildren[3] !==
      headings.find((heading) => hasClass(heading, "view-sp")) ||
    sectionChildren[4] !== mobile
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
  for (const [index, part] of parts.entries()) {
    const base = `${String(part.clock.hour).padStart(2, "0")}:${String(part.clock.minute).padStart(2, "0")}`;
    if (![...mobileRows.values()].some((cells) => cells[index] === base))
      throw new SourceParseFailure();
  }
  const occurrences = dates.flatMap((date) =>
    (mobileRows.get(date) ?? []).flatMap((cell) => {
      if (cell === "-" || cell === "貸切") return [];
      const [hour, minute] = cell.split(":").map(Number);
      return [
        {
          startsAt: tokyoDateTime(date, hour ?? -1, minute ?? -1),
          endsAt: null,
        },
      ];
    }),
  );
  if (occurrences.length === 0) throw new SourceParseFailure();
  return occurrences;
}
