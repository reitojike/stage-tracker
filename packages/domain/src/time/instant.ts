import { z } from 'zod';
import { dateUtcRoundTripMs } from './dateUtcRoundTrip';

/**
 * An `Instant` is an absolute point in time - the domain-level counterpart of
 * a persisted PostgreSQL `timestamptz`, which is itself a UTC instant on the
 * wire (docs/v2/oracle-domain.md §2.1). It is intentionally a distinct type
 * from `TokyoCalendarDate` (see ./tokyoCalendarDate.ts): conflating "an
 * absolute instant" with "an Asia/Tokyo calendar day" is exactly the
 * confusion that produces date-boundary bugs (UTC midnight is 9am in Tokyo,
 * so the UTC calendar date and the Tokyo calendar date disagree for 9 hours
 * of every day).
 *
 * Wire representation: an ISO-8601 date-time string with an explicit offset
 * (`Z` or `+HH:MM`/`-HH:MM`). A bare local-time string with no offset (e.g.
 * `"2026-01-02T03:04:05"`) is rejected rather than silently interpreted in
 * the host's local timezone, which would make parsing non-deterministic
 * across machines/CI runners.
 *
 * Parsing validates the calendar date/time is real (see dateUtcRoundTrip.ts)
 * rather than trusting `Date.parse`, which silently normalizes overflow
 * (`"2026-01-02T24:00:00Z"` -> 2026-01-03T00:00:00Z) instead of rejecting it.
 *
 * Precision note: internally this represents instants with millisecond
 * precision (`Date`'s native resolution). A wire value with sub-millisecond
 * fractional seconds (PostgreSQL `timestamptz` can carry microseconds) is
 * accepted but truncated to milliseconds, matching what any JS `Date`-backed
 * representation can hold. Product rules do not require sub-millisecond
 * precision anywhere; see the report's "固定オフセット演算の前提" note for
 * this and one related caveat.
 */

const INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/u;

function parseInstantToEpochMs(raw: string): number | null {
  const match = INSTANT_PATTERN.exec(raw);
  if (match === null) {
    return null;
  }

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr, fractionStr, offsetStr] =
    match;
  if (
    yearStr === undefined ||
    monthStr === undefined ||
    dayStr === undefined ||
    hourStr === undefined ||
    minuteStr === undefined ||
    secondStr === undefined ||
    offsetStr === undefined
  ) {
    return null;
  }

  const millisecond =
    fractionStr === undefined ? 0 : Number(fractionStr.slice(0, 3).padEnd(3, '0'));

  const localMs = dateUtcRoundTripMs({
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
    hour: Number(hourStr),
    minute: Number(minuteStr),
    second: Number(secondStr),
    millisecond,
  });
  if (localMs === null) {
    return null;
  }

  let offsetMinutes = 0;
  if (offsetStr !== 'Z') {
    const sign = offsetStr.startsWith('-') ? -1 : 1;
    const offsetHour = Number(offsetStr.slice(1, 3));
    const offsetMinute = Number(offsetStr.slice(4, 6));
    offsetMinutes = sign * (offsetHour * 60 + offsetMinute);
  }

  // The string's local wall-clock fields are offset-relative:
  // UTC instant = local wall-clock time - UTC offset.
  return localMs - offsetMinutes * 60_000;
}

const rawInstantSchema = z.string().transform((value, ctx) => {
  const epochMs = parseInstantToEpochMs(value);
  if (epochMs === null) {
    ctx.addIssue({
      code: 'custom',
      message:
        'Expected an ISO-8601 date-time with an explicit offset (e.g. "2026-01-02T03:04:05Z").',
    });
    return z.NEVER;
  }
  return new Date(epochMs).toISOString();
});

export const instantSchema = rawInstantSchema.brand<'Instant'>();
export type Instant = z.infer<typeof instantSchema>;

/** Converts an already-validated `Instant` to epoch milliseconds. */
export function instantToEpochMs(instant: Instant): number {
  return Date.parse(instant);
}

/**
 * Converts epoch milliseconds to a canonical `Instant`. Note this does not
 * read the clock: the caller supplies `epochMs`, matching this package's
 * clock-free constraint (docs/v2/decisions.md A6) - there is no `now()`
 * export here.
 */
export function epochMsToInstant(epochMs: number): Instant {
  return instantSchema.parse(new Date(epochMs).toISOString());
}

export function compareInstants(a: Instant, b: Instant): -1 | 0 | 1 {
  const diff = instantToEpochMs(a) - instantToEpochMs(b);
  if (diff < 0) {
    return -1;
  }
  if (diff > 0) {
    return 1;
  }
  return 0;
}

export function instantsAreEqual(a: Instant, b: Instant): boolean {
  return compareInstants(a, b) === 0;
}

export function isInstantBefore(a: Instant, b: Instant): boolean {
  return compareInstants(a, b) === -1;
}

export function isInstantAfter(a: Instant, b: Instant): boolean {
  return compareInstants(a, b) === 1;
}

export function isInstantSameOrBefore(a: Instant, b: Instant): boolean {
  return compareInstants(a, b) !== 1;
}

export function isInstantSameOrAfter(a: Instant, b: Instant): boolean {
  return compareInstants(a, b) !== -1;
}
