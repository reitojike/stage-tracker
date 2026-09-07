import { describe, expect, it } from 'vitest';
import { occurrenceIdSchema, type OccurrenceId } from '../ids';
import { instantSchema } from '../time/instant';
import { tokyoCalendarDateSchema } from '../time/tokyoCalendarDate';
import {
  findEventOccurrenceInvariantViolations,
  isOccurrenceStartWithinEventRange,
} from './eventOccurrenceInvariants';

const eventRange = {
  startsOn: tokyoCalendarDateSchema.parse('2026-03-01'),
  endsOn: tokyoCalendarDateSchema.parse('2026-03-10'),
};

function occId(n: number): OccurrenceId {
  return occurrenceIdSchema.parse(`00000000-0000-4000-8000-00000000000${String(n)}`);
}

describe('isOccurrenceStartWithinEventRange', () => {
  it('is true for a startsAt whose Tokyo calendar date equals the range start (boundary)', () => {
    // 2026-03-01T00:00:00+09:00 == 2026-02-28T15:00:00Z
    const startsAt = instantSchema.parse('2026-02-28T15:00:00Z');
    expect(isOccurrenceStartWithinEventRange(startsAt, eventRange)).toBe(true);
  });

  it('is true for a startsAt whose Tokyo calendar date equals the range end (boundary)', () => {
    // 2026-03-10T23:59:59+09:00 == 2026-03-10T14:59:59Z
    const startsAt = instantSchema.parse('2026-03-10T14:59:59Z');
    expect(isOccurrenceStartWithinEventRange(startsAt, eventRange)).toBe(true);
  });

  it('is false for a startsAt one Tokyo calendar day before the range start', () => {
    // 2026-02-28T23:59:59+09:00 == 2026-02-28T14:59:59Z, still Feb 28 in Tokyo.
    const startsAt = instantSchema.parse('2026-02-28T14:59:59Z');
    expect(isOccurrenceStartWithinEventRange(startsAt, eventRange)).toBe(false);
  });

  it('is false for a startsAt one Tokyo calendar day after the range end', () => {
    // 2026-03-11T00:00:00+09:00 == 2026-03-10T15:00:00Z, already Mar 11 in Tokyo.
    const startsAt = instantSchema.parse('2026-03-10T15:00:00Z');
    expect(isOccurrenceStartWithinEventRange(startsAt, eventRange)).toBe(false);
  });

  it('ignores doors/ends day-crossing: only startsAt is compared to the range', () => {
    // This function only ever receives startsAt, so an occurrence whose
    // endsAt crosses into the next Tokyo calendar day (outside the range)
    // cannot affect the result - there is no endsAt parameter to pass.
    const startsAt = instantSchema.parse('2026-03-10T14:00:00Z'); // 23:00 JST on Mar 10, in range
    expect(isOccurrenceStartWithinEventRange(startsAt, eventRange)).toBe(true);
  });
});

describe('findEventOccurrenceInvariantViolations', () => {
  it('reports no violations for occurrences within range with distinct starts', () => {
    const violations = findEventOccurrenceInvariantViolations(eventRange, [
      { id: occId(1), startsAt: instantSchema.parse('2026-03-05T10:00:00Z') },
      { id: occId(2), startsAt: instantSchema.parse('2026-03-06T10:00:00Z') },
    ]);
    expect(violations).toEqual([]);
  });

  it('reports an out-of-range violation for an occurrence before the range', () => {
    const outOfRangeId = occId(1);
    const startsAt = instantSchema.parse('2026-02-01T00:00:00Z');
    const violations = findEventOccurrenceInvariantViolations(eventRange, [
      { id: outOfRangeId, startsAt },
    ]);
    expect(violations).toEqual([
      { kind: 'occurrence-outside-event-range', occurrenceId: outOfRangeId, startsAt },
    ]);
  });

  it('reports an out-of-range violation for an occurrence after the range', () => {
    const outOfRangeId = occId(1);
    const startsAt = instantSchema.parse('2026-04-01T00:00:00Z');
    const violations = findEventOccurrenceInvariantViolations(eventRange, [
      { id: outOfRangeId, startsAt },
    ]);
    expect(violations).toEqual([
      { kind: 'occurrence-outside-event-range', occurrenceId: outOfRangeId, startsAt },
    ]);
  });

  it('flags two occurrences sharing the same instant, even written with different wire representations (wall-clock differs, instant is identical)', () => {
    const idA = occId(1);
    const idB = occId(2);
    // Same instant, two different offset representations.
    const startsAtA = instantSchema.parse('2026-03-05T01:00:00Z');
    const startsAtB = instantSchema.parse('2026-03-05T10:00:00+09:00');
    const violations = findEventOccurrenceInvariantViolations(eventRange, [
      { id: idA, startsAt: startsAtA },
      { id: idB, startsAt: startsAtB },
    ]);
    expect(violations).toHaveLength(1);
    const violation = violations[0];
    expect(violation?.kind).toBe('duplicate-occurrence-start');
    if (violation?.kind === 'duplicate-occurrence-start') {
      expect(new Set(violation.occurrenceIds)).toEqual(new Set([idA, idB]));
    }
  });

  it('does NOT flag two occurrences with the same wall-clock-looking text but different real instants (different offsets, different moments)', () => {
    // Both strings share the same digits but denote different absolute instants.
    const startsAtA = instantSchema.parse('2026-03-05T10:00:00Z');
    const startsAtB = instantSchema.parse('2026-03-05T10:00:00+09:00');
    const violations = findEventOccurrenceInvariantViolations(eventRange, [
      { id: occId(1), startsAt: startsAtA },
      { id: occId(2), startsAt: startsAtB },
    ]);
    expect(
      violations.filter((violation) => violation.kind === 'duplicate-occurrence-start'),
    ).toEqual([]);
  });

  it('groups three-or-more occurrences sharing the same instant into a single violation', () => {
    const startsAt = instantSchema.parse('2026-03-05T01:00:00Z');
    const ids = [occId(1), occId(2), occId(3)];
    const violations = findEventOccurrenceInvariantViolations(
      eventRange,
      ids.map((id) => ({ id, startsAt })),
    );
    expect(violations).toEqual([
      { kind: 'duplicate-occurrence-start', occurrenceIds: ids, startsAt },
    ]);
  });

  it('reports both an out-of-range violation and a duplicate-start violation together when both apply', () => {
    const outOfRangeStartsAt = instantSchema.parse('2026-05-01T00:00:00Z');
    const idA = occId(1);
    const idB = occId(2);
    const violations = findEventOccurrenceInvariantViolations(eventRange, [
      { id: idA, startsAt: outOfRangeStartsAt },
      { id: idB, startsAt: outOfRangeStartsAt },
    ]);
    // One out-of-range violation per occurrence (both are out of range), plus
    // one duplicate-start violation covering the pair.
    expect(violations.filter((v) => v.kind === 'occurrence-outside-event-range')).toHaveLength(2);
    expect(violations.filter((v) => v.kind === 'duplicate-occurrence-start')).toHaveLength(1);
  });

  it('reports no violations for an empty occurrence set (0-occurrence Event is valid)', () => {
    expect(findEventOccurrenceInvariantViolations(eventRange, [])).toEqual([]);
  });
});
