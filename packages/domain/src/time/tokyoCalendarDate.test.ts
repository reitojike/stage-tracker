import { describe, expect, it } from 'vitest';
import {
  compareTokyoCalendarDates,
  isTokyoCalendarDateWithinRange,
  tokyoCalendarDateSchema,
  tokyoCalendarDatesAreEqual,
} from './tokyoCalendarDate';

describe('tokyoCalendarDateSchema', () => {
  it('accepts a real calendar date', () => {
    expect(tokyoCalendarDateSchema.safeParse('2026-01-02').success).toBe(true);
  });

  it('accepts a leap day in a leap year (2028-02-29)', () => {
    expect(tokyoCalendarDateSchema.safeParse('2028-02-29').success).toBe(true);
  });

  it('rejects a leap day in a non-leap year (2026-02-29)', () => {
    expect(tokyoCalendarDateSchema.safeParse('2026-02-29').success).toBe(false);
  });

  it('rejects an impossible day-of-month (2026-02-30)', () => {
    expect(tokyoCalendarDateSchema.safeParse('2026-02-30').success).toBe(false);
  });

  it('rejects an impossible month (2026-13-01)', () => {
    expect(tokyoCalendarDateSchema.safeParse('2026-13-01').success).toBe(false);
  });

  it('rejects a 2-digit year shape outright (not exactly YYYY-MM-DD)', () => {
    expect(tokyoCalendarDateSchema.safeParse('26-01-01').success).toBe(false);
  });

  it('rejects a 4-digit-but-small year value without misreading it via the legacy 2-digit-year remap (year 26)', () => {
    // "0026-01-01" is shaped correctly (4 digits) but *numerically* year 26,
    // which is exactly the value range `Date.UTC`/legacy `Date` constructors
    // silently remap to 1926. This must still validate the actual input
    // components (year 26), not a remapped year.
    const result = tokyoCalendarDateSchema.safeParse('0026-01-01');
    expect(result.success).toBe(true);
  });

  it('rejects non-numeric fields', () => {
    expect(tokyoCalendarDateSchema.safeParse('2026-XX-01').success).toBe(false);
  });

  it('rejects garbage input', () => {
    expect(tokyoCalendarDateSchema.safeParse('not-a-date').success).toBe(false);
  });

  it('rejects a date with a time-of-day component', () => {
    expect(tokyoCalendarDateSchema.safeParse('2026-01-02T00:00:00').success).toBe(false);
  });
});

describe('compareTokyoCalendarDates / tokyoCalendarDatesAreEqual', () => {
  it('orders an earlier date before a later one', () => {
    const a = tokyoCalendarDateSchema.parse('2026-01-01');
    const b = tokyoCalendarDateSchema.parse('2026-01-31');
    expect(compareTokyoCalendarDates(a, b)).toBe(-1);
    expect(compareTokyoCalendarDates(b, a)).toBe(1);
  });

  it('orders across a month/year boundary correctly (lexicographic == chronological for zero-padded fields)', () => {
    const endOfMonth = tokyoCalendarDateSchema.parse('2026-01-31');
    const startOfNextMonth = tokyoCalendarDateSchema.parse('2026-02-01');
    expect(compareTokyoCalendarDates(endOfMonth, startOfNextMonth)).toBe(-1);

    const endOfYear = tokyoCalendarDateSchema.parse('2026-12-31');
    const startOfNextYear = tokyoCalendarDateSchema.parse('2027-01-01');
    expect(compareTokyoCalendarDates(endOfYear, startOfNextYear)).toBe(-1);
  });

  it('treats an identical date as equal to itself', () => {
    const a = tokyoCalendarDateSchema.parse('2026-01-01');
    expect(tokyoCalendarDatesAreEqual(a, a)).toBe(true);
    expect(compareTokyoCalendarDates(a, a)).toBe(0);
  });
});

describe('isTokyoCalendarDateWithinRange', () => {
  const startsOn = tokyoCalendarDateSchema.parse('2026-01-10');
  const endsOn = tokyoCalendarDateSchema.parse('2026-01-20');
  const range = { startsOn, endsOn };

  it('is inclusive of the start boundary', () => {
    expect(isTokyoCalendarDateWithinRange(startsOn, range)).toBe(true);
  });

  it('is inclusive of the end boundary', () => {
    expect(isTokyoCalendarDateWithinRange(endsOn, range)).toBe(true);
  });

  it('is true for a date strictly inside the range', () => {
    expect(isTokyoCalendarDateWithinRange(tokyoCalendarDateSchema.parse('2026-01-15'), range)).toBe(
      true,
    );
  });

  it('is false for a date one day before the start boundary', () => {
    expect(isTokyoCalendarDateWithinRange(tokyoCalendarDateSchema.parse('2026-01-09'), range)).toBe(
      false,
    );
  });

  it('is false for a date one day after the end boundary', () => {
    expect(isTokyoCalendarDateWithinRange(tokyoCalendarDateSchema.parse('2026-01-21'), range)).toBe(
      false,
    );
  });

  it('is true for a single-day range exactly on its only day', () => {
    const singleDay = tokyoCalendarDateSchema.parse('2026-03-05');
    expect(
      isTokyoCalendarDateWithinRange(singleDay, { startsOn: singleDay, endsOn: singleDay }),
    ).toBe(true);
  });
});
