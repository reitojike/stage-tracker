import { SourceParseFailure } from "../acquisition";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function calendarDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new SourceParseFailure();
  }
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
}

export function tokyoDateTime(
  date: string,
  hour: number,
  minute: number,
): string {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new SourceParseFailure();
  }
  return `${date}T${pad(hour)}:${pad(minute)}:00+09:00`;
}

export function enumerateDates(startsOn: string, endsOn: string): string[] {
  const result: string[] = [];
  const cursor = new Date(`${startsOn}T00:00:00Z`);
  const end = new Date(`${endsOn}T00:00:00Z`);
  if (
    Number.isNaN(cursor.valueOf()) ||
    Number.isNaN(end.valueOf()) ||
    cursor > end
  ) {
    throw new SourceParseFailure();
  }
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export function parseJapaneseDateRange(text: string): {
  startsOn: string;
  endsOn: string;
} {
  const normalized = text.replace(/\s+/gu, "");
  const match = normalized.match(
    /(\d{4})年(\d{1,2})月(\d{1,2})日[^0-9]*(?:(\d{4})年)?(?:(\d{1,2})月)?(\d{1,2})日/u,
  );
  if (match === null) throw new SourceParseFailure();
  const startYear = Number(match[1]);
  const startMonth = Number(match[2]);
  const startDay = Number(match[3]);
  let endYear = match[4] === undefined ? startYear : Number(match[4]);
  const endMonth = Number(match[5] ?? match[2]);
  const endDay = Number(match[6]);
  if (match[4] === undefined && endMonth < startMonth) endYear += 1;
  return {
    startsOn: calendarDate(startYear, startMonth, startDay),
    endsOn: calendarDate(endYear, endMonth, endDay),
  };
}

export function parseJapaneseClock(text: string): {
  hour: number;
  minute: number;
} | null {
  const colon = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})/u);
  if (colon !== null)
    return { hour: Number(colon[1]), minute: Number(colon[2]) };
  const japanese = text.match(/(午前|午後)?\s*(\d{1,2})時(?:\s*(\d{1,2})分)?/u);
  if (japanese === null) return null;
  let hour = Number(japanese[2]);
  if (japanese[1] === "午後" && hour < 12) hour += 12;
  if (japanese[1] === "午前" && hour === 12) hour = 0;
  return { hour, minute: Number(japanese[3] ?? 0) };
}

export function slug(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/gu, "");
}
