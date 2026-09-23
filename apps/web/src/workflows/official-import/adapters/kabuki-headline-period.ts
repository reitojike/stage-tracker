import { SourceParseFailure } from "../acquisition";
import {
  enumerateDates,
  parseJapaneseClock,
  tokyoDateTime,
} from "./japanese-date";

type Clock = { hour: number; minute: number };
type Part = { name: string; clock: Clock };

function dateForDayInRange(
  day: number,
  startsOn: string,
  endsOn: string,
): string {
  const matches = enumerateDates(startsOn, endsOn).filter(
    (date) => Number(date.slice(-2)) === day,
  );
  if (matches.length !== 1 || matches[0] === undefined)
    throw new SourceParseFailure();
  return matches[0];
}

function parseDays(
  value: string,
  startsOn: string,
  endsOn: string,
): Set<string> {
  const pattern = /(\d{1,2})日(?:[（(]([^）)]+)[）)])?/gu;
  const matches = [...value.matchAll(pattern)];
  if (
    matches.length === 0 ||
    value.replace(pattern, "").replace(/[、，\s]/gu, "") !== ""
  )
    throw new SourceParseFailure();
  const weekdays = "日月火水木金土";
  const dates = matches.map((match) => {
    const date = dateForDayInRange(Number(match[1]), startsOn, endsOn);
    if (match[2] !== undefined) {
      const annotation = match[2].match(
        /^([日月火水木金土])$|^祝・([日月火水木金土])$/u,
      );
      const dayName = annotation?.[1] ?? annotation?.[2];
      if (
        dayName === undefined ||
        dayName !== weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()]
      )
        throw new SourceParseFailure();
    }
    return date;
  });
  if (new Set(dates).size !== dates.length) throw new SourceParseFailure();
  return new Set(dates);
}

function parseBaseTimes(base: string): readonly Part[] {
  const pattern =
    /([昼夜朝]の部|第(?:[一二三四五六]|[1-6])部)\s*((?:午前|午後)\s*\d{1,2}時(?:\s*\d{1,2}分)?)\s*[～〜]/gu;
  const matches = [...base.matchAll(pattern)];
  const parts: Part[] = [];
  if (matches.length === 0) {
    if (
      !/^(?:午前|午後)\s*\d{1,2}時(?:\s*\d{1,2}分)?\s*[～〜]$/u.test(
        base.trim(),
      )
    )
      throw new SourceParseFailure();
    const clock = parseJapaneseClock(base);
    if (clock === null) throw new SourceParseFailure();
    parts.push({ name: "単独", clock });
  } else {
    // Only separators and whitespace may remain between fully parsed parts.
    if (base.replace(pattern, "").replace(/[／/\s]/gu, "") !== "")
      throw new SourceParseFailure();
    for (const match of matches) {
      const clock = parseJapaneseClock(match[2] ?? "");
      if (clock === null || match[1] === undefined)
        throw new SourceParseFailure();
      parts.push({ name: match[1], clock });
    }
  }
  if (
    new Set(parts.map((part) => part.name)).size !== parts.length ||
    new Set(parts.map((part) => `${part.clock.hour}:${part.clock.minute}`))
      .size !== parts.length
  )
    throw new SourceParseFailure();
  return parts;
}

export function parseKabukiHeadlinePeriod(
  startsOn: string,
  endsOn: string,
  timetable: string,
): readonly { startsAt: string; endsAt: null }[] {
  if (/現地時間/u.test(timetable)) throw new SourceParseFailure();
  const morningOnly = timetable.match(
    /※(\d{1,2}日(?:[（(][^）)]+[）)])?)は、午前の部のみ1回公演$/u,
  );
  let schedule =
    morningOnly === null
      ? timetable.trim()
      : timetable.slice(0, morningOnly.index ?? timetable.length).trim();
  const doorNote = "※開場は開演の1時間前を予定";
  if (schedule.endsWith(doorNote))
    schedule = schedule.slice(0, -doorNote.length).trim();
  const markers = [...schedule.matchAll(/[【〖](休演|貸切)[】〗]/gu)];
  const parts = parseBaseTimes(
    schedule.slice(0, markers[0]?.index ?? schedule.length),
  );

  let closed = new Set<string>();
  let hasClosure = false;
  const privateByPart = new Map<string, Set<string>>();
  let hasPrivate = false;
  for (const [index, marker] of markers.entries()) {
    const content = schedule
      .slice(
        (marker.index ?? 0) + marker[0].length,
        markers[index + 1]?.index ?? schedule.length,
      )
      .trim();
    if (marker[1] === "休演") {
      if (hasClosure) throw new SourceParseFailure();
      hasClosure = true;
      closed = parseDays(content, startsOn, endsOn);
      continue;
    }
    if (marker[1] !== "貸切" || hasPrivate) throw new SourceParseFailure();
    hasPrivate = true;
    const privateText = content.replace(/^※幕見席は営業\s*/u, "");
    const labels = [
      ...privateText.matchAll(
        /([昼夜朝]の部|第(?:[一二三四五六]|[1-6])部)[:：]/gu,
      ),
    ];
    if (labels.length === 0 && parts.length === 1) {
      privateByPart.set(
        parts[0]?.name ?? "",
        parseDays(privateText, startsOn, endsOn),
      );
      continue;
    }
    if (
      labels.length === 0 ||
      privateText.slice(0, labels[0]?.index ?? 0).trim() !== ""
    )
      throw new SourceParseFailure();
    for (const [partIndex, label] of labels.entries()) {
      const name = label[1];
      if (
        name === undefined ||
        !parts.some((part) => part.name === name) ||
        privateByPart.has(name)
      )
        throw new SourceParseFailure();
      privateByPart.set(
        name,
        parseDays(
          privateText.slice(
            (label.index ?? 0) + label[0].length,
            labels[partIndex + 1]?.index ?? privateText.length,
          ),
          startsOn,
          endsOn,
        ),
      );
    }
  }
  if (morningOnly !== null) {
    const morningParts = parts.filter((part) => part.clock.hour < 12);
    if (parts.length !== 2 || morningParts.length !== 1)
      throw new SourceParseFailure();
    const afternoon = parts.find((part) => part !== morningParts[0]);
    if (afternoon === undefined || privateByPart.has(afternoon.name))
      throw new SourceParseFailure();
    privateByPart.set(
      afternoon.name,
      parseDays(morningOnly[1] ?? "", startsOn, endsOn),
    );
  }

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
