import { dateUtcRoundTripMs } from './dateUtcRoundTrip';
import { epochMsToInstant, instantToEpochMs, type Instant } from './instant';
import { tokyoCalendarDateSchema, type TokyoCalendarDate } from './tokyoCalendarDate';
import { err, ok, type Result } from '../result';

/**
 * Asia/Tokyo has no DST and this product's date boundary is fixed at
 * `Asia/Tokyo` (docs/v2/oracle-domain.md §2.1), so the conversion between an
 * `Instant` (UTC) and Asia/Tokyo local fields is a pure, constant +9h
 * offset - it never depends on the JS runtime's or DB session's local
 * timezone. See this task's report for the one assumption this relies on
 * (Japan has not observed DST since 1951, and no product rule anticipates a
 * historical/pre-1888 date where the legal Japan Standard Time offset
 * differed) and why that assumption is safe for this product.
 */
export const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

const TOKYO_CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

function decomposeTokyoCalendarDate(date: TokyoCalendarDate): {
  year: number;
  month: number;
  day: number;
} {
  const match = TOKYO_CALENDAR_DATE_PATTERN.exec(date);
  if (match === null) {
    throw new Error(
      'unreachable: TokyoCalendarDate is guaranteed valid by tokyoCalendarDateSchema',
    );
  }
  const [, yearStr, monthStr, dayStr] = match;
  if (yearStr === undefined || monthStr === undefined || dayStr === undefined) {
    throw new Error(
      'unreachable: TokyoCalendarDate is guaranteed valid by tokyoCalendarDateSchema',
    );
  }
  return { year: Number(yearStr), month: Number(monthStr), day: Number(dayStr) };
}

/** Reads an `Instant`'s Asia/Tokyo local calendar date (fixed +9h offset, see above). */
export function instantToTokyoCalendarDate(instant: Instant): TokyoCalendarDate {
  const tokyo = instantToTokyoWallClock(instant);
  const formatted = `${String(tokyo.year).padStart(4, '0')}-${String(tokyo.month).padStart(2, '0')}-${String(tokyo.day).padStart(2, '0')}`;
  return tokyoCalendarDateSchema.parse(formatted);
}

/**
 * The UTC instant range `[startInstant, endInstantExclusive)` covering a full
 * Asia/Tokyo calendar day (half-open, matching "ある日を指定して、その日に
 * 公演回がある event を引ける" style range queries in AGENTS.md).
 */
export interface TokyoCalendarDayUtcRange {
  readonly startInstant: Instant;
  readonly endInstantExclusive: Instant;
}

export function tokyoCalendarDayRangeUtc(date: TokyoCalendarDate): TokyoCalendarDayUtcRange {
  const { year, month, day } = decomposeTokyoCalendarDate(date);
  const localMidnightMs = dateUtcRoundTripMs({
    year,
    month,
    day,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  if (localMidnightMs === null) {
    throw new Error(
      'unreachable: TokyoCalendarDate is guaranteed valid by tokyoCalendarDateSchema',
    );
  }
  const startMs = localMidnightMs - TOKYO_OFFSET_MS;
  return {
    startInstant: epochMsToInstant(startMs),
    endInstantExclusive: epochMsToInstant(startMs + 24 * 60 * 60 * 1000),
  };
}

/** The Asia/Tokyo wall-clock fields (year/month/day/hour/minute/second/millisecond) of an `Instant`. */
export interface TokyoWallClockComponents {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

export function instantToTokyoWallClock(instant: Instant): TokyoWallClockComponents {
  const tokyoMs = instantToEpochMs(instant) + TOKYO_OFFSET_MS;
  const date = new Date(tokyoMs);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds(),
  };
}

/** Input for {@link tokyoWallClockToInstant}: `second`/`millisecond` default to 0 (matching e.g. an `<input type="datetime-local">` value, which has no seconds field). */
export interface TokyoWallClockInput {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second?: number;
  readonly millisecond?: number;
}

/**
 * Converts an Asia/Tokyo wall-clock time to an `Instant`. Rejects
 * combinations that are not a real date/time (e.g. hour 25, February 30)
 * instead of letting them silently roll over - see dateUtcRoundTrip.ts.
 */
export function tokyoWallClockToInstant(input: TokyoWallClockInput): Result<Instant, string> {
  const localMs = dateUtcRoundTripMs({
    year: input.year,
    month: input.month,
    day: input.day,
    hour: input.hour,
    minute: input.minute,
    second: input.second ?? 0,
    millisecond: input.millisecond ?? 0,
  });
  if (localMs === null) {
    return err('Invalid Asia/Tokyo wall-clock date/time.');
  }
  return ok(epochMsToInstant(localMs - TOKYO_OFFSET_MS));
}
