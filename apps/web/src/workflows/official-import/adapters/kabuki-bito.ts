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
  parseJapaneseDateRange,
  tokyoDateTime,
} from "./japanese-date";

const MAX_PLAYS_PER_SCAN = 30;

function parseKabukiPeriod(text: string): {
  startsOn: string;
  endsOn: string;
} | null {
  const normalized = text.replace(/\s+/gu, "");
  // A month-only teaser has no exact performance date to stage. It is still
  // counted against the index cap and may be revisited on a later weekly scan.
  if (/^\d{4}年\d{1,2}月$/u.test(normalized)) return null;
  const single = normalized.match(
    /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:[（(][^）)]*[）)])?$/u,
  );
  if (single !== null) {
    const date = calendarDate(
      Number(single[1]),
      Number(single[2]),
      Number(single[3]),
    );
    return { startsOn: date, endsOn: date };
  }
  return parseJapaneseDateRange(normalized);
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

function parseVerifiedBaseTimes(
  base: string,
): readonly { name: string; clock: { hour: number; minute: number } }[] {
  const partPattern =
    /([昼夜朝]の部|第(?:[一二三四五六]|[1-6])部)\s*((?:午前|午後)\s*\d{1,2}時(?:\s*\d{1,2}分)?)\s*[～〜]/gu;
  const partMatches = [...base.matchAll(partPattern)];
  const parts =
    partMatches.length === 0
      ? (() => {
          if (
            !/^(?:午前|午後)\s*\d{1,2}時(?:\s*\d{1,2}分)?\s*[～〜]$/u.test(
              base.trim(),
            )
          )
            throw new SourceParseFailure();
          const clock = parseJapaneseClock(base);
          if (clock === null) throw new SourceParseFailure();
          return [{ name: "単独", clock }];
        })()
      : partMatches.map((match) => {
          const clock = parseJapaneseClock(match[2] ?? "");
          if (clock === null || match[1] === undefined)
            throw new SourceParseFailure();
          return { name: match[1], clock };
        });
  if (partMatches.length > 0 && base.replace(partPattern, "").trim() !== "")
    throw new SourceParseFailure();
  if (new Set(parts.map((part) => part.name)).size !== parts.length)
    throw new SourceParseFailure();
  if (
    new Set(parts.map((part) => `${part.clock.hour}:${part.clock.minute}`))
      .size !== parts.length
  )
    throw new SourceParseFailure();
  return parts;
}

function parseVerifiedMobileCalendar(
  html: string,
  startsOn: string,
  endsOn: string,
  timetable: string,
): {
  occurrences: readonly { startsAt: string; endsAt: null }[];
  hasExclusions: boolean;
  timetableSuffix: string;
  hasStarredCell: boolean;
} | null {
  const document = parseHtml(html);
  const calendars = descendants(
    document,
    (node) =>
      elementName(node) === "table" &&
      hasClass(node, "type-calendar") &&
      hasClass(node, "view-sp"),
  );
  if (calendars.length === 0) return null;
  const calendar = calendars[0];
  if (calendars.length !== 1 || calendar === undefined)
    throw new SourceParseFailure();
  const rows = descendants(calendar, (node) => elementName(node) === "tr");
  const cells = (row: (typeof rows)[number]) =>
    descendants(
      row,
      (node) => elementName(node) === "th" || elementName(node) === "td",
    );
  const header = rows[0];
  if (header === undefined) throw new SourceParseFailure();
  const headerCells = cells(header);
  const firstHeaderCell = headerCells[0];
  if (firstHeaderCell === undefined) throw new SourceParseFailure();
  const parts = headerCells.slice(1).map(normalizedText);
  const timetableStart =
    timetable.search(/[【〖]|※|終演予定時間：|昼の部では/u);
  const headline =
    timetableStart < 0 ? timetable : timetable.slice(0, timetableStart);
  const headlineParts = parseVerifiedBaseTimes(headline);
  if (
    headerCells.length < 2 ||
    headerCells.length > 5 ||
    headerCells.some((cell) => elementName(cell) !== "th") ||
    normalizedText(firstHeaderCell) !== "" ||
    parts.some(
      (part) =>
        !/^(?:[昼夜朝]の部|第(?:[一二三四五六]|[1-6])部|\d{1,2}[:：]\d{2})$/u.test(
          part,
        ),
    ) ||
    new Set(parts).size !== parts.length
  )
    throw new SourceParseFailure();
  if (headlineParts.length !== parts.length) throw new SourceParseFailure();
  const usedHeadlineParts = new Set<number>();
  const expectedClocks = parts.map((part) => {
    const numeric = /^\d{1,2}[:：]\d{2}$/u.test(part);
    const headerClock = numeric ? parseJapaneseClock(part) : null;
    const matching = headlineParts
      .map((item, index) => ({ item, index }))
      .filter(({ item }) =>
        numeric
          ? headerClock !== null &&
            item.clock.hour === headerClock.hour &&
            item.clock.minute === headerClock.minute
          : item.name === part,
      );
    const selected = matching[0];
    if (
      matching.length !== 1 ||
      selected === undefined ||
      usedHeadlineParts.has(selected.index)
    )
      throw new SourceParseFailure();
    usedHeadlineParts.add(selected.index);
    return selected.item.clock;
  });

  const dates = enumerateDates(startsOn, endsOn);
  if (rows.length !== dates.length + 1) throw new SourceParseFailure();
  const seenDates = new Set<string>();
  const seenStarts = new Set<string>();
  const occurrences: { startsAt: string; endsAt: null }[] = [];
  let hasExclusions = false;
  let hasStarredCell = false;
  const weekdays = "日月火水木金土";
  for (const row of rows.slice(1)) {
    const rowCells = cells(row);
    const dayCell = rowCells[0];
    if (dayCell === undefined) throw new SourceParseFailure();
    const day = normalizedText(dayCell).match(
      /^(\d{1,2})[（(]([日月火水木金土])[）)]$/u,
    );
    if (
      rowCells.length !== headerCells.length ||
      elementName(dayCell) !== "th" ||
      rowCells.slice(1).some((cell) => elementName(cell) !== "td") ||
      day === null
    )
      throw new SourceParseFailure();
    const date = dateForDayInRange(Number(day[1]), startsOn, endsOn);
    if (
      seenDates.has(date) ||
      weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()] !== day[2]
    )
      throw new SourceParseFailure();
    seenDates.add(date);
    for (const [index, cell] of rowCells.slice(1).entries()) {
      const rawValue = normalizedText(cell);
      const starred = rawValue.endsWith("★");
      const value = starred ? rawValue.slice(0, -1) : rawValue;
      if (starred) {
        hasStarredCell = true;
        const part = parts[index];
        if (
          part === undefined ||
          !normalizedText(document).includes(
            `★${day[1]}日（${day[2]}）${part}は「着物で歌舞伎」`,
          )
        )
          throw new SourceParseFailure();
      }
      if (
        value === "-" ||
        value === "--" ||
        value === "貸切" ||
        value === "休演"
      ) {
        hasExclusions = true;
        continue;
      }
      const expected = expectedClocks[index];
      if (expected === undefined) throw new SourceParseFailure();
      // A/B and Aプロ/Bプロ denote cast/program variants; 〇 marks a show.
      // The labeled part's headline time is authoritative for those cells.
      const clock = /^(?:[AB](?:プロ)?|〇)$/u.test(value)
        ? expected
        : /^\d{1,2}[:：]\d{2}$/u.test(value)
          ? parseJapaneseClock(value)
          : null;
      if (
        clock === null ||
        clock.hour !== expected.hour ||
        clock.minute !== expected.minute
      )
        throw new SourceParseFailure();
      const startsAt = tokyoDateTime(date, clock.hour, clock.minute);
      if (seenStarts.has(startsAt)) throw new SourceParseFailure();
      seenStarts.add(startsAt);
      occurrences.push({ startsAt, endsAt: null });
    }
  }
  if (seenDates.size !== dates.length || occurrences.length === 0)
    throw new SourceParseFailure();
  return {
    occurrences,
    hasExclusions,
    timetableSuffix:
      timetableStart < 0 ? "" : timetable.slice(timetableStart).trim(),
    hasStarredCell,
  };
}

function calendarUsesOnlyVerifiedTableNotes(
  suffix: string,
  hasStarredCell: boolean,
): boolean {
  if (suffix === "") return true;
  // These exact notices defer the day-by-day exceptions to the complete table.
  // Other suffixes must pass the same parsed headline/table agreement check.
  const deferred = suffix.match(
    /^[【〖](?:休演・貸切|休演|貸切)[】〗]日程詳細をご確認ください(?:\s+(.+))?$/u,
  );
  const note = deferred === null ? suffix : (deferred[1] ?? "");
  if (deferred !== null && note === "") return true;
  if (note === "※当初の発表から公演日程を変更しております")
    return deferred === null;
  if (
    /^※\d{1,2}日（[日月火水木金土]）第(?:[一二三四五六]|[1-6])部は「着物で歌舞伎」です。皆様、お着物でご観劇ください$/u.test(
      note,
    )
  )
    return hasStarredCell;
  return false;
}

function parseVerifiedHeadlineSchedule(
  startsOn: string,
  endsOn: string,
  timetable: string,
): readonly { startsAt: string; endsAt: null }[] {
  const morningOnly = timetable.match(
    /※(\d{1,2}日(?:[（(][^）)]+[）)])?)は、午前の部のみ1回公演$/u,
  );
  const scheduleText =
    morningOnly === null
      ? timetable
      : timetable.slice(0, morningOnly.index ?? timetable.length).trim();
  // Non-schedule notes may mention school groups, curtain times, or staging.
  // Never let another rest-day/private marker hide in an ignored note.
  const noteStart = scheduleText.search(
    /※下記日程は学校団体様がいらっしゃいます|終演予定時間：|昼の部では、古式に則り、|※開場は開演の1時間前を予定/u,
  );
  const schedule =
    noteStart < 0 ? scheduleText : scheduleText.slice(0, noteStart);
  const notes = noteStart < 0 ? "" : scheduleText.slice(noteStart);
  const markers = [...schedule.matchAll(/[【〖](休演|貸切)[】〗]/gu)];
  const base = schedule.slice(0, markers[0]?.index ?? schedule.length);
  const parts = parseVerifiedBaseTimes(base);

  const weekdays = "日月火水木金土";
  const parseDays = (value: string): Set<string> => {
    const datePattern = /(\d{1,2})日(?:[（(]([^）)]+)[）)])?/gu;
    const matches = [...value.matchAll(datePattern)];
    if (
      matches.length === 0 ||
      value.replace(datePattern, "").replace(/[、，\s]/gu, "") !== ""
    )
      throw new SourceParseFailure();
    const dates = matches.map((match) => {
      const date = dateForDayInRange(Number(match[1]), startsOn, endsOn);
      if (match[2] !== undefined) {
        const dayNames = [...match[2]].filter((name) =>
          weekdays.includes(name),
        );
        if (
          dayNames.length !== 1 ||
          dayNames[0] !== weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()]
        )
          throw new SourceParseFailure();
      }
      return date;
    });
    if (new Set(dates).size !== dates.length) throw new SourceParseFailure();
    return new Set(dates);
  };

  // Informational notes are accepted only as fully parsed, known forms. A
  // later cancellation or schedule change must never hide in a note suffix.
  let remainingNotes = notes.trim();
  if (remainingNotes.startsWith("※下記日程は学校団体様がいらっしゃいます")) {
    remainingNotes = remainingNotes.slice(
      "※下記日程は学校団体様がいらっしゃいます".length,
    );
    const curtainStart = remainingNotes.indexOf("終演予定時間：");
    const schoolDates = remainingNotes
      .slice(0, curtainStart < 0 ? undefined : curtainStart)
      .trim();
    const labels = [
      ...schoolDates.matchAll(
        /([昼夜朝]の部|第(?:[一二三四五六]|[1-6])部)[:：]/gu,
      ),
    ];
    if (
      labels.length === 0 ||
      schoolDates.slice(0, labels[0]?.index ?? 0).trim() !== ""
    )
      throw new SourceParseFailure();
    const seenLabels = new Set<string>();
    for (const [index, label] of labels.entries()) {
      const name = label[1];
      if (
        name === undefined ||
        !parts.some((part) => part.name === name) ||
        seenLabels.has(name)
      )
        throw new SourceParseFailure();
      seenLabels.add(name);
      parseDays(
        schoolDates.slice(
          (label.index ?? 0) + label[0].length,
          labels[index + 1]?.index ?? schoolDates.length,
        ),
      );
    }
    remainingNotes =
      curtainStart < 0 ? "" : remainingNotes.slice(curtainStart).trim();
  }
  if (remainingNotes.startsWith("終演予定時間：")) {
    const estimateCaveat = "※終演予定時間は変更になる可能性があります";
    if (remainingNotes.endsWith(estimateCaveat))
      remainingNotes = remainingNotes.slice(0, -estimateCaveat.length).trim();
    const curtainParts = remainingNotes
      .slice("終演予定時間：".length)
      .split(/[／/]/u);
    const seenLabels = new Set<string>();
    for (const item of curtainParts) {
      const match = item
        .trim()
        .match(
          /^([昼夜朝]の部|第(?:[一二三四五六]|[1-6])部)\s*((?:午前|午後)\s*\d{1,2}時(?:\s*\d{1,2}分)?)頃$/u,
        );
      const name = match?.[1];
      if (
        name === undefined ||
        !parts.some((part) => part.name === name) ||
        seenLabels.has(name) ||
        parseJapaneseClock(match?.[2] ?? "") === null
      )
        throw new SourceParseFailure();
      seenLabels.add(name);
    }
    if (seenLabels.size !== parts.length) throw new SourceParseFailure();
    remainingNotes = "";
  }
  if (remainingNotes !== "" && remainingNotes !== "※開場は開演の1時間前を予定")
    throw new SourceParseFailure();

  let closed = new Set<string>();
  const privateByPart = new Map<string, Set<string>>();
  for (const [index, marker] of markers.entries()) {
    const next = markers[index + 1];
    const content = schedule
      .slice(
        (marker.index ?? 0) + marker[0].length,
        next?.index ?? schedule.length,
      )
      .trim();
    if (marker[1] === "休演") {
      if (closed.size > 0) throw new SourceParseFailure();
      closed = parseDays(content);
      continue;
    }
    if (marker[1] !== "貸切" || privateByPart.size > 0)
      throw new SourceParseFailure();
    const withoutNote = content.replace(/^※幕見席は営業\s*/u, "");
    const partLabels = [
      ...withoutNote.matchAll(
        /([昼夜朝]の部|第(?:[一二三四五六]|[1-6])部)[:：]/gu,
      ),
    ];
    if (partLabels.length === 0 && parts.length === 1) {
      privateByPart.set(parts[0]?.name ?? "", parseDays(withoutNote));
      continue;
    }
    if (
      partLabels.length === 0 ||
      withoutNote.slice(0, partLabels[0]?.index ?? 0).trim() !== ""
    )
      throw new SourceParseFailure();
    for (const [partIndex, label] of partLabels.entries()) {
      const name = label[1];
      if (
        name === undefined ||
        !parts.some((part) => part.name === name) ||
        privateByPart.has(name)
      )
        throw new SourceParseFailure();
      const afterLabel = (label.index ?? 0) + label[0].length;
      const dateText = withoutNote.slice(
        afterLabel,
        partLabels[partIndex + 1]?.index ?? withoutNote.length,
      );
      privateByPart.set(name, parseDays(dateText));
    }
  }
  if (morningOnly !== null) {
    const morningParts = parts.filter((part) => part.clock.hour < 12);
    if (parts.length !== 2 || morningParts.length !== 1)
      throw new SourceParseFailure();
    const exceptionDates = parseDays(morningOnly[1] ?? "");
    if (exceptionDates.size !== 1) throw new SourceParseFailure();
    const afternoon = parts.find((part) => part !== morningParts[0]);
    if (afternoon === undefined || privateByPart.has(afternoon.name))
      throw new SourceParseFailure();
    privateByPart.set(afternoon.name, exceptionDates);
  }
  if (markers.some((marker) => marker[1] === "休演") && closed.size === 0)
    throw new SourceParseFailure();

  const occurrences = enumerateDates(startsOn, endsOn).flatMap((date) =>
    closed.has(date)
      ? []
      : parts.flatMap((part) =>
          privateByPart.get(part.name)?.has(date)
            ? []
            : [
                {
                  startsAt: tokyoDateTime(
                    date,
                    part.clock.hour,
                    part.clock.minute,
                  ),
                  endsAt: null,
                },
              ],
        ),
  );
  if (occurrences.length === 0) throw new SourceParseFailure();
  return occurrences;
}

function parseKabukiDetailedSchedule(
  html: string,
  startsOn: string,
  endsOn: string,
  timetable: string,
  theater?: string,
): {
  occurrences: readonly { startsAt: string; endsAt: null }[];
  hasCalendarExclusions: boolean;
} {
  if (/現地時間/u.test(timetable)) throw new SourceParseFailure();
  const calendar = parseVerifiedMobileCalendar(
    html,
    startsOn,
    endsOn,
    timetable,
  );
  if (calendar !== null) {
    if (
      theater === "kabukiza" ||
      !calendarUsesOnlyVerifiedTableNotes(
        calendar.timetableSuffix,
        calendar.hasStarredCell,
      )
    ) {
      const headline = parseVerifiedHeadlineSchedule(
        startsOn,
        endsOn,
        timetable,
      );
      if (
        calendar.occurrences.length !== headline.length ||
        calendar.occurrences.some(
          (item, index) => item.startsAt !== headline[index]?.startsAt,
        )
      )
        throw new SourceParseFailure();
    }
    return {
      occurrences: calendar.occurrences,
      hasCalendarExclusions: calendar.hasExclusions,
    };
  }
  // Some short engagements publish each date/time directly in the headline.
  // Require every date and clock token to be paired. Varying daily tables are
  // not yet mapped to verified showtime columns and cannot be inferred here.
  const datedClock =
    /(\d{1,2})日(?:[（(][^）)]*[）)])?\s*(午前|午後)?\s*(\d{1,2})時(?:\s*(\d{1,2})分)?\s*[～〜]?/gu;
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
      coveredDates.add(date);
      const clock = parseJapaneseClock(
        `${match[2] ?? ""}${match[3]}時${match[4] ?? ""}分`,
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
    return { occurrences, hasCalendarExclusions: false };
  }

  return {
    occurrences: parseVerifiedHeadlineSchedule(startsOn, endsOn, timetable),
    hasCalendarExclusions: false,
  };
}

export function parseKabukiDetailedOccurrences(
  html: string,
  startsOn: string,
  endsOn: string,
  timetable: string,
  theater?: string,
): readonly { startsAt: string; endsAt: null }[] {
  return parseKabukiDetailedSchedule(html, startsOn, endsOn, timetable, theater)
    .occurrences;
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
              const timetable = detailText(detail.body, "type-timetable");
              if (timetable === null) throw new SourceParseFailure();
              const venue = detailText(detail.body, "type-theater");
              const schedule = parseKabukiDetailedSchedule(
                detail.body,
                fact.startsOn,
                fact.endsOn,
                timetable,
                fact.theater,
              );
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
                  memo:
                    /[【〖](?:休演|貸切)[】〗]/u.test(timetable) ||
                    schedule.hasCalendarExclusions
                      ? "公式日程の休演・貸切等をOccurrence候補から除外"
                      : null,
                  sourceUrl: detail.url,
                  startsOn: fact.startsOn,
                  endsOn: fact.endsOn,
                  occurrences: [...schedule.occurrences],
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
