import { describe, expect, it } from 'vitest';
import { instantSchema } from './instant';
import { tokyoCalendarDateSchema } from './tokyoCalendarDate';
import {
  TOKYO_OFFSET_MS,
  instantToTokyoCalendarDate,
  instantToTokyoWallClock,
  tokyoCalendarDayRangeUtc,
  tokyoWallClockToInstant,
} from './tokyoConversion';

describe('TOKYO_OFFSET_MS', () => {
  it('is a fixed +9 hours', () => {
    expect(TOKYO_OFFSET_MS).toBe(9 * 60 * 60 * 1000);
  });
});

describe('instantToTokyoCalendarDate', () => {
  it('reads the UTC calendar date when well inside the Tokyo day', () => {
    const instant = instantSchema.parse('2026-01-01T03:00:00Z'); // 12:00 JST
    expect(instantToTokyoCalendarDate(instant)).toBe('2026-01-01');
  });

  it('rolls over to the next Tokyo calendar date at the UTC/Tokyo day boundary (UTC 15:00 == Tokyo 00:00 next day)', () => {
    const atBoundary = instantSchema.parse('2026-01-01T15:00:00.000Z');
    expect(instantToTokyoCalendarDate(atBoundary)).toBe('2026-01-02');
  });

  it('stays on the earlier Tokyo calendar date one millisecond before the boundary', () => {
    const justBefore = instantSchema.parse('2026-01-01T14:59:59.999Z');
    expect(instantToTokyoCalendarDate(justBefore)).toBe('2026-01-01');
  });

  it('crosses a Tokyo year boundary even though the UTC instant is still in the previous UTC year', () => {
    // 2025-12-31T15:00:00Z is 2026-01-01T00:00:00+09:00.
    const instant = instantSchema.parse('2025-12-31T15:00:00Z');
    expect(instantToTokyoCalendarDate(instant)).toBe('2026-01-01');
  });
});

describe('tokyoCalendarDayRangeUtc', () => {
  it('computes the half-open UTC range for a Tokyo calendar day', () => {
    const date = tokyoCalendarDateSchema.parse('2026-01-02');
    const range = tokyoCalendarDayRangeUtc(date);
    expect(range.startInstant).toBe('2026-01-01T15:00:00.000Z');
    expect(range.endInstantExclusive).toBe('2026-01-02T15:00:00.000Z');
  });

  it('the start instant belongs to the day, the end instant does not (half-open)', () => {
    const date = tokyoCalendarDateSchema.parse('2026-01-02');
    const range = tokyoCalendarDayRangeUtc(date);
    expect(instantToTokyoCalendarDate(range.startInstant)).toBe('2026-01-02');
    // endInstantExclusive is the *next* day's start instant.
    expect(instantToTokyoCalendarDate(range.endInstantExclusive)).toBe('2026-01-03');
  });

  it('one millisecond before the end instant still belongs to the day', () => {
    const date = tokyoCalendarDateSchema.parse('2026-01-02');
    const range = tokyoCalendarDayRangeUtc(date);
    const oneMsBeforeEnd = instantSchema.parse(
      new Date(Date.parse(range.endInstantExclusive) - 1).toISOString(),
    );
    expect(instantToTokyoCalendarDate(oneMsBeforeEnd)).toBe('2026-01-02');
  });
});

describe('instantToTokyoWallClock / tokyoWallClockToInstant', () => {
  it('round-trips an instant through Tokyo wall-clock components', () => {
    const instant = instantSchema.parse('2026-01-01T15:30:45.250Z');
    const wallClock = instantToTokyoWallClock(instant);
    expect(wallClock).toEqual({
      year: 2026,
      month: 1,
      day: 2,
      hour: 0,
      minute: 30,
      second: 45,
      millisecond: 250,
    });

    const result = tokyoWallClockToInstant(wallClock);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(instant);
    }
  });

  it('defaults second/millisecond to 0 when omitted (e.g. from a datetime-local input)', () => {
    const result = tokyoWallClockToInstant({ year: 2026, month: 1, day: 2, hour: 9, minute: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 2026-01-02T09:00:00+09:00 == 2026-01-02T00:00:00Z
      expect(result.value).toBe('2026-01-02T00:00:00.000Z');
    }
  });

  it('rejects an out-of-range hour (25) instead of rolling over to the next day', () => {
    const result = tokyoWallClockToInstant({ year: 2026, month: 1, day: 2, hour: 25, minute: 0 });
    expect(result.ok).toBe(false);
  });

  it('rejects an impossible calendar date (February 30)', () => {
    const result = tokyoWallClockToInstant({ year: 2026, month: 2, day: 30, hour: 0, minute: 0 });
    expect(result.ok).toBe(false);
  });
});
