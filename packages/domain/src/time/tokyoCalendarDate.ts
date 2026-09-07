import { z } from 'zod';
import { dateUtcRoundTripMs } from './dateUtcRoundTrip';

/**
 * A `TokyoCalendarDate` is an Asia/Tokyo calendar day ("YYYY-MM-DD"), with no
 * time-of-day component. It is a distinct type from `Instant` (./instant.ts)
 * on purpose: an Event range (`starts_on`/`ends_on`) and the calendar-date
 * projection of an Occurrence's `starts_at` are both *dates*, not instants,
 * per docs/v2/oracle-domain.md §2.1/§2.2.
 *
 * Validation round-trips the components through `Date.UTC`-equivalent
 * component assignment (see dateUtcRoundTrip.ts) rather than trusting
 * `Date.parse`/`Date.UTC`, both of which silently normalize out-of-range
 * values (`"2026-02-30"` -> 2026-03-02) and mis-handle two-digit year values
 * (`Date.UTC(26, ...)` legacy-remaps to 1926) instead of rejecting them.
 */

const TOKYO_CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

function isValidTokyoCalendarDateString(value: string): boolean {
  const match = TOKYO_CALENDAR_DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }

  const [, yearStr, monthStr, dayStr] = match;
  if (yearStr === undefined || monthStr === undefined || dayStr === undefined) {
    return false;
  }

  const roundTripMs = dateUtcRoundTripMs({
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  return roundTripMs !== null;
}

const rawTokyoCalendarDateSchema = z.string().transform((value, ctx) => {
  if (!isValidTokyoCalendarDateString(value)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Expected a real Asia/Tokyo calendar date in "YYYY-MM-DD" form.',
    });
    return z.NEVER;
  }
  return value;
});

export const tokyoCalendarDateSchema = rawTokyoCalendarDateSchema.brand<'TokyoCalendarDate'>();
export type TokyoCalendarDate = z.infer<typeof tokyoCalendarDateSchema>;

/**
 * `TokyoCalendarDate` values are always fixed-width zero-padded "YYYY-MM-DD"
 * strings, so lexicographic string ordering agrees with chronological
 * ordering. This avoids re-deriving epoch milliseconds just to compare two
 * calendar dates.
 */
export function compareTokyoCalendarDates(a: TokyoCalendarDate, b: TokyoCalendarDate): -1 | 0 | 1 {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

export function tokyoCalendarDatesAreEqual(a: TokyoCalendarDate, b: TokyoCalendarDate): boolean {
  return compareTokyoCalendarDates(a, b) === 0;
}

export interface TokyoCalendarDateRange {
  readonly startsOn: TokyoCalendarDate;
  readonly endsOn: TokyoCalendarDate;
}

/** Both ends are inclusive, matching the Event range semantics (product rules). */
export function isTokyoCalendarDateWithinRange(
  date: TokyoCalendarDate,
  range: TokyoCalendarDateRange,
): boolean {
  return (
    compareTokyoCalendarDates(date, range.startsOn) >= 0 &&
    compareTokyoCalendarDates(date, range.endsOn) <= 0
  );
}
