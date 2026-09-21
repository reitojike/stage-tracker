import { z } from 'zod';
import { dateUtcRoundTripMs } from './dateUtcRoundTrip';

/**
 * A `TokyoCalendarDate` is an Asia/Tokyo calendar day ("YYYY-MM-DD"), with no
 * time-of-day component. It is a distinct type from `Instant` (./instant.ts)
 * on purpose: an Event range (`starts_on`/`ends_on`) and the calendar-date
 * projection of an Occurrence's `starts_at` are both *dates*, not instants,
 * according to the product/domain rule that owns the calling feature.
 *
 * Validation round-trips the components through `Date.UTC`-equivalent
 * component assignment (see dateUtcRoundTrip.ts) rather than trusting
 * `Date.parse`/`Date.UTC`, both of which silently normalize out-of-range
 * values (`"2026-02-30"` -> 2026-03-02) and mis-handle two-digit year values
 * (`Date.UTC(26, ...)` legacy-remaps to 1926) instead of rejecting them.
 */

const TOKYO_CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

export interface TokyoCalendarDateComponents {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function parseTokyoCalendarDateComponents(value: string): TokyoCalendarDateComponents | null {
  const match = TOKYO_CALENDAR_DATE_PATTERN.exec(value);
  if (match === null) {
    return null;
  }

  const [, yearStr, monthStr, dayStr] = match;
  if (yearStr === undefined || monthStr === undefined || dayStr === undefined) {
    return null;
  }

  return { year: Number(yearStr), month: Number(monthStr), day: Number(dayStr) };
}

function isValidTokyoCalendarDateString(value: string): boolean {
  const components = parseTokyoCalendarDateComponents(value);
  if (components === null) {
    return false;
  }

  const roundTripMs = dateUtcRoundTripMs({
    ...components,
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
 * Decomposes a schema-validated Tokyo calendar date into numeric components.
 *
 * This is intentionally an invariant-enforcing boundary: callers must provide
 * a `TokyoCalendarDate`, and an impossible runtime value throws instead of
 * silently substituting default components.
 */
export function decomposeTokyoCalendarDate(date: TokyoCalendarDate): TokyoCalendarDateComponents {
  const components = parseTokyoCalendarDateComponents(date);
  if (components === null) {
    throw new Error(
      'invariant violation: TokyoCalendarDate must be a validated YYYY-MM-DD calendar date',
    );
  }
  return components;
}

/**
 * Returns a UTC-field millisecond representation of a Tokyo calendar date.
 *
 * This is an ordinal-like value for calendar arithmetic, not a Tokyo instant.
 * It uses `dateUtcRoundTripMs` so years 0-99 are not remapped to 1900-1999 by
 * the legacy `Date.UTC` behavior.
 */
export function tokyoCalendarDateToUtcFieldMs(date: TokyoCalendarDate): number {
  const components = decomposeTokyoCalendarDate(date);
  const roundTripMs = dateUtcRoundTripMs({
    ...components,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  if (roundTripMs === null) {
    throw new Error('invariant violation: TokyoCalendarDate must represent a real calendar date');
  }
  return roundTripMs;
}

/** Returns the whole Tokyo calendar-day difference (`to` - `from`). */
export function differenceTokyoCalendarDates(
  from: TokyoCalendarDate,
  to: TokyoCalendarDate,
): number {
  return Math.round(
    (tokyoCalendarDateToUtcFieldMs(to) - tokyoCalendarDateToUtcFieldMs(from)) / 86_400_000,
  );
}

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
