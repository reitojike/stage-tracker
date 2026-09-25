import { SourceParseFailure } from "../acquisition";
import {
  calendarDate,
  parseJapaneseClock,
  tokyoDateTime,
} from "./japanese-date";

export type TicketMilestone =
  | {
      readonly type: "sale_start";
      readonly precision: "date";
      readonly date: string;
    }
  | {
      readonly type: "sale_start";
      readonly precision: "datetime";
      readonly at: string;
    }
  | {
      readonly type: "sale_start";
      readonly precision: "window";
      readonly startsAt: string;
      readonly endsAt: string;
    };

function dateForSale(
  text: string,
  performanceStartsOn: string,
  performanceEndsOn = performanceStartsOn,
): string | null {
  const dateMatch = text
    .normalize("NFKC")
    .match(/(?:(\d{4})年)?\s*(\d{1,2})月\s*(\d{1,2})日/u);
  if (dateMatch === null) return null;
  const explicitYear = dateMatch[1];
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  if (explicitYear !== undefined)
    return calendarDate(Number(explicitYear), month, day);
  const startYear = Number(performanceStartsOn.slice(0, 4));
  const endYear = Number(performanceEndsOn.slice(0, 4));
  const candidates = [...new Set([startYear - 1, startYear, endYear])]
    .flatMap((year) => {
      try {
        return [calendarDate(year, month, day)];
      } catch (error) {
        if (error instanceof SourceParseFailure) return [];
        throw error;
      }
    })
    .filter((date) => date <= performanceEndsOn)
    .sort();
  if (candidates.length === 0) throw new SourceParseFailure();
  return (
    candidates.find((date) => date >= performanceStartsOn) ??
    candidates.at(-1) ??
    null
  );
}

export function parseShochikuSaleMilestone(
  text: string,
  performanceStartsOn: string,
  performanceEndsOn = performanceStartsOn,
): TicketMilestone | null {
  if (text.includes("到着後")) return null;
  const normalized = text.normalize("NFKC");
  const dateMatches = [
    ...normalized.matchAll(/(?:(?:\d{4})年)?\s*\d{1,2}月\s*\d{1,2}日/gu),
  ];
  if (dateMatches.length > 2) throw new SourceParseFailure();
  const date = dateForSale(text, performanceStartsOn, performanceEndsOn);
  if (date === null) return null;
  const clocks = [
    ...normalized.matchAll(
      /(?:(?:午前|午後)?\s*\d{1,2}時(?:\s*\d{1,2}分)?|\d{1,2}\s*[:：]\s*\d{2})/gu,
    ),
  ].flatMap((match) => {
    const clock = parseJapaneseClock(match[0]);
    return clock === null ? [] : [clock];
  });
  const [firstClock, secondClock] = clocks;
  if (dateMatches.length === 2) {
    if (
      firstClock === undefined ||
      secondClock === undefined ||
      clocks.length !== 2
    )
      return null;
    const endDate = dateForSale(
      dateMatches[1]?.[0] ?? "",
      performanceStartsOn,
      performanceEndsOn,
    );
    if (endDate === null) return null;
    const startsAt = tokyoDateTime(date, firstClock.hour, firstClock.minute);
    const endsAt = tokyoDateTime(endDate, secondClock.hour, secondClock.minute);
    if (endsAt <= startsAt) throw new SourceParseFailure();
    return { type: "sale_start", precision: "window", startsAt, endsAt };
  }
  if (clocks.length > 2) throw new SourceParseFailure();
  if (firstClock !== undefined && secondClock !== undefined) {
    return {
      type: "sale_start",
      precision: "window",
      startsAt: tokyoDateTime(date, firstClock.hour, firstClock.minute),
      endsAt: tokyoDateTime(date, secondClock.hour, secondClock.minute),
    };
  }
  if (firstClock !== undefined)
    return {
      type: "sale_start",
      precision: "datetime",
      at: tokyoDateTime(date, firstClock.hour, firstClock.minute),
    };
  return { type: "sale_start", precision: "date", date };
}
