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
import { calendarDate, tokyoDateTime } from "./japanese-date";

function fail(): never {
  throw new SourceParseFailure();
}
function attrs(node: HtmlNode, allowed: readonly string[]) {
  if ("attrs" in node && node.attrs.some(({ name }) => !allowed.includes(name)))
    fail();
}
function elements(node: HtmlNode): HtmlNode[] {
  if (!("childNodes" in node)) return [];
  if (
    node.childNodes.some(
      (child) =>
        child.nodeName === "#text" &&
        "value" in child &&
        child.value.trim() !== "",
    )
  )
    fail();
  return node.childNodes.filter((child) => elementName(child) !== null);
}
function classes(node: HtmlNode, allowed: readonly string[]) {
  if (
    (attribute(node, "class") ?? "")
      .split(/\s+/u)
      .filter(Boolean)
      .some((value) => !allowed.includes(value))
  )
    fail();
}
function hasElementChildren(node: HtmlNode): boolean {
  return (
    "childNodes" in node &&
    node.childNodes.some((child) => elementName(child) !== null)
  );
}

function scheduleRegion(document: HtmlNode): HtmlNode {
  const contents = descendants(
    document,
    (node) => attribute(node, "id") === "contents",
  );
  const [content] = contents;
  if (!content || contents.length !== 1) fail();
  const headings = descendants(content, (node) => elementName(node) === "h1");
  const [heading] = headings;
  if (
    !heading ||
    headings.length !== 1 ||
    normalizedText(heading) !== "公演日程"
  )
    fail();
  const sections = elements(content)
    .filter((node) => elementName(node) === "article")
    .flatMap(elements)
    .filter(
      (node) => elementName(node) === "section" && hasClass(node, "article02"),
    );
  const [section] = sections;
  if (!section || sections.length !== 1) fail();
  const regions = elements(section).filter(
    (node) => elementName(node) === "div" && hasClass(node, "table03"),
  );
  const [region] = regions;
  if (!region || regions.length !== 1) fail();
  return region;
}

function clock(hour: number, minute: number) {
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  )
    fail();
  return { hour, minute };
}
function resolveDate(text: string, startsOn: string, endsOn: string): string {
  const match = text.match(/^(\d{1,2})\s*[/.]\s*(\d{1,2})$/u);
  if (!match) fail();
  const candidates: string[] = [];
  for (const year of new Set([
    Number(startsOn.slice(0, 4)),
    Number(endsOn.slice(0, 4)),
  ])) {
    let candidate: string;
    try {
      candidate = calendarDate(year, Number(match[1]), Number(match[2]));
    } catch {
      continue;
    }
    if (candidate >= startsOn && candidate <= endsOn)
      candidates.push(candidate);
  }
  const [candidate] = candidates;
  if (!candidate || candidates.length !== 1) fail();
  return candidate;
}
function weekday(date: string): string {
  const value = "日月火水木金土"[new Date(`${date}T00:00:00Z`).getUTCDay()];
  if (value === undefined) fail();
  return value;
}
function span(node: HtmlNode): number {
  const value = attribute(node, "rowspan") ?? "1";
  if (!/^[12]$/u.test(value)) fail();
  return Number(value);
}
function headingAttrs(node: HtmlNode, allowSpan: boolean) {
  attrs(node, allowSpan ? ["width", "rowspan", "class"] : ["colspan"]);
  if (allowSpan) {
    classes(node, ["sat", "sun", "wed"]);
    const width = attribute(node, "width");
    if (width !== null && !/^\d+%?$/u.test(width)) fail();
  } else {
    const colspan = attribute(node, "colspan");
    if (colspan !== null && !/^[12]$/u.test(colspan)) fail();
  }
}

// Markers are retained until their suffix position and page legend are checked.
function fieldText(
  node: HtmlNode,
  colors: ReadonlySet<string> = new Set(),
): string {
  const visit = (child: HtmlNode): string => {
    if (child.nodeName === "#text" && "value" in child) {
      if (child.value.includes("●")) fail();
      return child.value;
    }
    if (child.nodeName === "#comment") return "";
    if (elementName(child) === "br") {
      attrs(child, []);
      return " ";
    }
    if (elementName(child) === "font") {
      attrs(child, ["color"]);
      const color = (attribute(child, "color") ?? "").toLowerCase();
      if (
        !colors.has(color) ||
        normalizedText(child) !== "●" ||
        hasElementChildren(child)
      )
        fail();
      return "●";
    }
    fail();
  };
  return ("childNodes" in node ? node.childNodes.map(visit).join("") : "")
    .replace(/\s+/gu, " ")
    .trim();
}

function noteLines(node: HtmlNode): string[] {
  attrs(node, ["class"]);
  classes(node, ["txt", "txt3"]);
  const visit = (child: HtmlNode): string => {
    if (child.nodeName === "#text" && "value" in child) {
      if (/[●\uE000\uE001]/u.test(child.value)) fail();
      return child.value.replace(/\s+/gu, " ");
    }
    if (child.nodeName === "#comment") return "";
    if (elementName(child) === "br") {
      attrs(child, []);
      return "\n";
    }
    if (elementName(child) === "font") {
      attrs(child, ["color"]);
      const color = (attribute(child, "color") ?? "").toLowerCase();
      if (
        !/^#[0-9a-f]{6}$/u.test(color) ||
        normalizedText(child) !== "●" ||
        hasElementChildren(child)
      )
        fail();
      return `\uE000${color}\uE001`;
    }
    if (elementName(child) === "a") {
      attrs(child, ["href", "target"]);
      if (
        !/^https:\/\/kageki\.hankyu\.co\.jp\/news\/\d{8}_\d+\.html$/u.test(
          attribute(child, "href") ?? "",
        ) ||
        normalizedText(child) !== "こちらのニュース" ||
        hasElementChildren(child) ||
        ![null, "_self"].includes(attribute(child, "target"))
      )
        fail();
      return "こちらのニュース";
    }
    fail();
  };
  return ("childNodes" in node ? node.childNodes.map(visit).join("") : "")
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
}

function frameContents(region: HtmlNode, startsOn: string, endsOn: string) {
  attrs(region, ["class"]);
  classes(region, ["table03"]);
  const tables: HtmlNode[] = [];
  let castColors = new Set<string>();
  let castLegendSeen = false;
  const privateNotes = new Map<string, { date: string; startsAt: string }>();
  const afterShowNotes = new Map<string, ReadonlySet<string>>();
  for (const child of elements(region)) {
    const tag = elementName(child);
    if (tag === "table") {
      tables.push(child);
      continue;
    }
    if (
      tag === "div" &&
      hasClass(child, "table01") &&
      hasClass(child, "list")
    ) {
      attrs(child, ["class"]);
      classes(child, ["table01", "list"]);
      const children = elements(child);
      if (
        children.length === 0 ||
        children.some((node) => elementName(node) !== "table")
      )
        fail();
      tables.push(...children);
      continue;
    }
    if (tag === "hr") {
      attrs(child, []);
      continue;
    }
    if (tag === "section" && hasClass(child, "linkset02")) {
      attrs(child, ["class"]);
      classes(child, ["linkset02", "mt30"]);
      if (
        normalizedText(child) !== "宝塚歌劇Webチケットサービス" ||
        descendants(child, (node) => elementName(node) === "table").length > 0
      )
        fail();
      continue;
    }
    if (tag !== "p") fail();
    const lines = noteLines(child);
    if (lines.length === 0) continue;
    if (
      lines[0] ===
      "◇この公演は役替わりがあります。こちらのニュースをご確認ください。"
    ) {
      if (
        castLegendSeen ||
        lines.length !== 4 ||
        lines[1] !== "＜役替わり日程＞"
      )
        fail();
      const performers = new Set<string>();
      const colors = new Set<string>();
      for (const line of lines.slice(2)) {
        const match = line.match(
          /^\uE000(#[0-9a-f]{6})\uE001＝ルドルフ：([\p{L}ー]+ [\p{L}ー]+)$/u,
        );
        const [, color, performer] = match ?? [];
        if (
          !color ||
          !performer ||
          colors.has(color) ||
          performers.has(performer)
        )
          fail();
        colors.add(color);
        performers.add(performer);
      }
      castLegendSeen = true;
      castColors = colors;
      continue;
    }
    for (const line of lines) {
      if (
        line ===
          "★印の公演は宝塚友の会優先公演となり、予定枚数に達しなかった場合にのみ、一般前売で販売いたします。" ||
        line ===
          "※一部の公演ならびに席種において、取り扱いがない場合がございます。" ||
        line ===
          "※今後、都合により開演時間等の変更が生じることがございますので、ご了承ください。（公演時間は休憩を含め約3時間です）"
      )
        continue;
      const afterShow = line.match(
        /^※(\d+) この公演は、鳳月杏、天紫珠李の退団公演となります。(\d{1,2})月(\d{1,2})日（([日月火水木金土])）(\d{1,2}):(\d{2})公演、(\d{1,2})月(\d{1,2})日（([日月火水木金土])）(\d{1,2}):(\d{2})公演終了後、引き続き、サヨナラショーを行います。$/u,
      );
      if (afterShow) {
        const id = afterShow[1];
        if (!id || privateNotes.has(id) || afterShowNotes.has(id)) fail();
        const starts: string[] = [];
        for (const offset of [2, 7]) {
          const date = resolveDate(
            `${afterShow[offset]}/${afterShow[offset + 1]}`,
            startsOn,
            endsOn,
          );
          if (weekday(date) !== afterShow[offset + 2]) fail();
          const time = clock(
            Number(afterShow[offset + 3]),
            Number(afterShow[offset + 4]),
          );
          starts.push(tokyoDateTime(date, time.hour, time.minute));
        }
        if ((starts[0] ?? "") >= (starts[1] ?? "")) fail();
        afterShowNotes.set(id, new Set(starts));
        continue;
      }
      const note = line.match(
        /^※(\d+) (\d{1,2})月(\d{1,2})日（([日月火水木金土])(?:・祝)?）(\d{1,2}):(\d{2})開演は三井住友カードと宝塚友の会の共同開催となり、予定枚数に達しなかった場合にのみ、一般前売で販売いたします。$/u,
      );
      if (!note) fail();
      const [, id, month, day, dayOfWeek, hour, minute] = note;
      if (id === undefined || privateNotes.has(id) || afterShowNotes.has(id))
        fail();
      const date = resolveDate(`${month}/${day}`, startsOn, endsOn);
      if (weekday(date) !== dayOfWeek) fail();
      const time = clock(Number(hour), Number(minute));
      privateNotes.set(id, {
        date,
        startsAt: tokyoDateTime(date, time.hour, time.minute),
      });
    }
  }
  if (tables.length === 0) fail();
  return { tables, castColors, privateNotes, afterShowNotes };
}

type Slot =
  | { kind: "empty" | "closed" }
  | { kind: "private"; noteId: string | null }
  | { kind: "public"; hour: number; minute: number; noteId: string | null };
function slot(node: HtmlNode, colors: ReadonlySet<string>): Slot {
  attrs(node, ["class"]);
  classes(node, ["red", "blue", "orange"]);
  let text = fieldText(node, colors);
  const marked = text.endsWith("●");
  if (marked) text = text.slice(0, -1).trimEnd();
  if (text.includes("●")) fail();
  let result: Slot;
  if (text === "") result = { kind: "empty" };
  else if (text === "休演日") result = { kind: "closed" };
  else if (/^貸切公演(?:\s*※\s*\d+)?$/u.test(text))
    result = {
      kind: "private",
      noteId: text.match(/※\s*(\d+)$/u)?.[1] ?? null,
    };
  else {
    const noteId = text.match(/\s*※\s*(\d+)$/u)?.[1] ?? null;
    const plain = text
      .replace(/\s*※\s*\d+$/u, "")
      .replace(/^★\s*/u, "")
      .replace(/\s*(?:\(新人公演\)|（新人公演）)$/u, "");
    const colon = plain.match(/^(\d{1,2})\s*[:：]\s*(\d{2})$/u);
    const japanese = plain.match(
      /^(午前|午後)?\s*(\d{1,2})時(?:\s*(\d{1,2})分)?$/u,
    );
    if (colon)
      result = {
        kind: "public",
        noteId,
        ...clock(Number(colon[1]), Number(colon[2])),
      };
    else if (japanese) {
      let hour = Number(japanese[2]);
      if (japanese[1] !== undefined && hour > 12) fail();
      if (japanese[1] === "午後" && hour < 12) hour += 12;
      if (japanese[1] === "午前" && hour === 12) hour = 0;
      result = {
        kind: "public",
        noteId,
        ...clock(hour, Number(japanese[3] ?? 0)),
      };
    } else fail();
  }
  if (marked && (result.kind === "empty" || result.kind === "closed")) fail();
  if (
    (hasClass(node, "red") && result.kind !== "closed") ||
    (hasClass(node, "blue") && result.kind !== "private") ||
    (hasClass(node, "orange") &&
      (result.kind !== "public" ||
        !/(?:\(新人公演\)|（新人公演）)$/u.test(text)))
  )
    fail();
  return result;
}

export function parseTakarazukaSchedule(
  html: string,
  startsOn: string,
  endsOn: string,
): readonly { readonly startsAt: string; readonly endsAt: null }[] {
  for (const value of [startsOn, endsOn]) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
    if (
      !match ||
      calendarDate(Number(match[1]), Number(match[2]), Number(match[3])) !==
        value
    )
      fail();
  }
  if (
    startsOn > endsOn ||
    Number(endsOn.slice(0, 4)) - Number(startsOn.slice(0, 4)) > 1
  )
    fail();
  const { tables, castColors, privateNotes, afterShowNotes } = frameContents(
    scheduleRegion(parseHtml(html)),
    startsOn,
    endsOn,
  );
  const occurrences: { startsAt: string; endsAt: null }[] = [];
  const starts = new Set<string>();
  const addOccurrence = (startsAt: string) => {
    if (starts.has(startsAt)) fail();
    starts.add(startsAt);
    occurrences.push({ startsAt, endsAt: null });
  };
  const privateSlots = new Map<string, string>();
  const afterShowSlots = new Map<string, Set<string>>();
  const days = new Map<string, { closed: boolean; performances: number }>();
  for (const table of tables) {
    attrs(table, ["class"]);
    classes(table, ["edgenone", "center"]);
    if (
      descendants(table, (node) => elementName(node) === "table").length !== 1
    )
      fail();
    let dated = false;
    const groups = elements(table);
    if (
      groups.length === 0 ||
      groups.some(
        (node) => !["thead", "tbody"].includes(elementName(node) ?? ""),
      )
    )
      fail();
    for (const group of groups) {
      attrs(group, []);
      let active: { date: string; remaining: number } | null = null;
      for (const row of elements(group)) {
        if (elementName(row) !== "tr") fail();
        attrs(row, []);
        const cells = elements(row);
        const [first, second] = cells;
        if (
          cells.some((node) => !["th", "td"].includes(elementName(node) ?? ""))
        )
          fail();
        if (
          cells.length === 2 &&
          first !== undefined &&
          second !== undefined &&
          cells.every((node) => elementName(node) === "th") &&
          fieldText(first) === "日付" &&
          fieldText(second) === "開演時間"
        ) {
          if (active && active.remaining > 0) fail();
          cells.forEach((node) => headingAttrs(node, false));
          active = null;
          continue;
        }
        const headings = cells.filter((node) => elementName(node) === "th");
        const [dateCell] = headings;
        const times = cells.filter((node) => elementName(node) === "td");
        if (headings.length > 0) {
          if (
            dateCell === undefined ||
            (active && active.remaining > 0) ||
            headings.length > 2 ||
            cells[0] !== headings[0] ||
            (headings.length === 2 && cells[1] !== headings[1]) ||
            times.length === 0
          )
            fail();
          headingAttrs(dateCell, true);
          const date = resolveDate(fieldText(dateCell), startsOn, endsOn);
          const rowSpan = span(dateCell);
          if (headings[1]) {
            headingAttrs(headings[1], true);
            if (
              fieldText(headings[1]) !== weekday(date) ||
              span(headings[1]) !== rowSpan
            )
              fail();
          }
          active = { date, remaining: rowSpan };
          dated = true;
        }
        const slots = times.map((node) => slot(node, castColors));
        if (!active || active.remaining === 0) {
          if (slots.some((value) => value.kind !== "empty")) fail();
          continue;
        }
        if (times.length === 0) fail();
        const day = days.get(active.date) ?? { closed: false, performances: 0 };
        for (const value of slots) {
          if (value.kind === "empty") continue;
          if (value.kind === "closed") {
            if (day.performances > 0) fail();
            day.closed = true;
            continue;
          }
          if (day.closed) fail();
          day.performances += 1;
          if (value.kind === "private" && value.noteId !== null) {
            if (privateSlots.has(value.noteId)) fail();
            const note = privateNotes.get(value.noteId);
            if (note === undefined || note.date !== active.date) fail();
            privateSlots.set(value.noteId, active.date);
            // The recognized dated note explicitly offers residual tickets
            // through general sale; this is the documented joint-show exception.
            addOccurrence(note.startsAt);
          }
          if (value.kind === "public") {
            const startsAt = tokyoDateTime(
              active.date,
              value.hour,
              value.minute,
            );
            if (value.noteId !== null) {
              if (!afterShowNotes.get(value.noteId)?.has(startsAt)) fail();
              const slots =
                afterShowSlots.get(value.noteId) ?? new Set<string>();
              slots.add(startsAt);
              afterShowSlots.set(value.noteId, slots);
            }
            addOccurrence(startsAt);
          }
        }
        days.set(active.date, day);
        active.remaining -= 1;
      }
      if (active && active.remaining !== 0) fail();
    }
    if (!dated) fail();
  }
  if (privateNotes.size !== privateSlots.size) fail();
  for (const [id, note] of privateNotes) {
    if (privateSlots.get(id) !== note.date || days.get(note.date)?.closed)
      fail();
  }
  for (const [id, note] of afterShowNotes) {
    if (afterShowSlots.get(id)?.size !== note.size) fail();
  }
  if (occurrences.length === 0) fail();
  return occurrences;
}
