import { describe, expect, it } from 'vitest';
import {
  compareInstants,
  epochMsToInstant,
  instantSchema,
  instantToEpochMs,
  instantsAreEqual,
  isInstantAfter,
  isInstantBefore,
  isInstantSameOrAfter,
  isInstantSameOrBefore,
} from './instant';

describe('instantSchema', () => {
  it('accepts a UTC instant with a Z suffix', () => {
    const result = instantSchema.safeParse('2026-01-02T03:04:05Z');
    expect(result.success).toBe(true);
  });

  it('accepts an instant with an explicit positive offset and normalizes it to UTC', () => {
    const parsed = instantSchema.parse('2026-01-02T03:04:05+09:00');
    // 03:04:05+09:00 is 1804:05 UTC the previous day.
    expect(parsed).toBe('2026-01-01T18:04:05.000Z');
  });

  it('accepts an instant with an explicit negative offset', () => {
    const parsed = instantSchema.parse('2026-01-01T20:00:00-05:00');
    expect(parsed).toBe('2026-01-02T01:00:00.000Z');
  });

  it('truncates sub-millisecond fractional seconds (Postgres microsecond precision) to milliseconds', () => {
    const parsed = instantSchema.parse('2026-01-02T03:04:05.123456Z');
    expect(parsed).toBe('2026-01-02T03:04:05.123Z');
  });

  it('pads a short fractional-seconds value correctly (".1" is 100ms, not 1ms)', () => {
    const parsed = instantSchema.parse('2026-01-02T03:04:05.1Z');
    expect(parsed).toBe('2026-01-02T03:04:05.100Z');
  });

  it('rejects a bare local time with no offset (ambiguous, host-timezone-dependent)', () => {
    const result = instantSchema.safeParse('2026-01-02T03:04:05');
    expect(result.success).toBe(false);
  });

  it('rejects an impossible calendar date instead of silently rolling it over (2026-02-30)', () => {
    const result = instantSchema.safeParse('2026-02-30T00:00:00Z');
    expect(result.success).toBe(false);
  });

  it('rejects an impossible month (2026-13-01)', () => {
    const result = instantSchema.safeParse('2026-13-01T00:00:00Z');
    expect(result.success).toBe(false);
  });

  it('rejects an overflowing hour instead of silently rolling it over to the next day', () => {
    const result = instantSchema.safeParse('2026-01-02T24:00:00Z');
    expect(result.success).toBe(false);
  });

  it('rejects a leap-second-shaped seconds value (60)', () => {
    const result = instantSchema.safeParse('2026-01-02T03:04:60Z');
    expect(result.success).toBe(false);
  });

  it('rejects garbage input', () => {
    const result = instantSchema.safeParse('not-a-date');
    expect(result.success).toBe(false);
  });

  it('accepts a real leap-day instant (2028 is a leap year)', () => {
    const result = instantSchema.safeParse('2028-02-29T00:00:00Z');
    expect(result.success).toBe(true);
  });

  it('rejects a leap-day instant in a non-leap year (2026)', () => {
    const result = instantSchema.safeParse('2026-02-29T00:00:00Z');
    expect(result.success).toBe(false);
  });
});

describe('instantToEpochMs / epochMsToInstant', () => {
  it('round-trips through epoch milliseconds', () => {
    const instant = instantSchema.parse('2026-01-02T03:04:05.678Z');
    const epochMs = instantToEpochMs(instant);
    expect(epochMsToInstant(epochMs)).toBe(instant);
  });
});

describe('compareInstants / instantsAreEqual', () => {
  it('orders an earlier instant before a later one', () => {
    const a = instantSchema.parse('2026-01-01T00:00:00Z');
    const b = instantSchema.parse('2026-01-02T00:00:00Z');
    expect(compareInstants(a, b)).toBe(-1);
    expect(compareInstants(b, a)).toBe(1);
  });

  it('treats two different string representations of the same instant as equal', () => {
    const a = instantSchema.parse('2026-01-02T00:00:00Z');
    const b = instantSchema.parse('2026-01-02T09:00:00+09:00');
    expect(compareInstants(a, b)).toBe(0);
    expect(instantsAreEqual(a, b)).toBe(true);
  });

  it('treats an identical instant as equal to itself', () => {
    const a = instantSchema.parse('2026-01-02T00:00:00Z');
    expect(instantsAreEqual(a, a)).toBe(true);
  });
});

describe('isInstantBefore / isInstantAfter / isInstantSameOrBefore / isInstantSameOrAfter', () => {
  const earlier = instantSchema.parse('2026-01-01T00:00:00Z');
  const later = instantSchema.parse('2026-01-02T00:00:00Z');

  it('isInstantBefore is true only for a strictly earlier instant', () => {
    expect(isInstantBefore(earlier, later)).toBe(true);
    expect(isInstantBefore(later, earlier)).toBe(false);
    expect(isInstantBefore(earlier, earlier)).toBe(false);
  });

  it('isInstantAfter is true only for a strictly later instant', () => {
    expect(isInstantAfter(later, earlier)).toBe(true);
    expect(isInstantAfter(earlier, later)).toBe(false);
    expect(isInstantAfter(earlier, earlier)).toBe(false);
  });

  it('isInstantSameOrBefore includes equality (boundary)', () => {
    expect(isInstantSameOrBefore(earlier, earlier)).toBe(true);
    expect(isInstantSameOrBefore(earlier, later)).toBe(true);
    expect(isInstantSameOrBefore(later, earlier)).toBe(false);
  });

  it('isInstantSameOrAfter includes equality (boundary)', () => {
    expect(isInstantSameOrAfter(later, later)).toBe(true);
    expect(isInstantSameOrAfter(later, earlier)).toBe(true);
    expect(isInstantSameOrAfter(earlier, later)).toBe(false);
  });
});
