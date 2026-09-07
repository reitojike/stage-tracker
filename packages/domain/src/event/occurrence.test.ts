import { describe, expect, it } from 'vitest';
import { eventIdSchema, occurrenceIdSchema } from '../ids';
import { instantSchema } from '../time/instant';
import { occurrenceSchema } from './occurrence';

const occurrenceId = occurrenceIdSchema.parse('33333333-3333-4333-8333-333333333333');
const eventId = eventIdSchema.parse('11111111-1111-4111-8111-111111111111');
const now = instantSchema.parse('2026-01-01T00:00:00Z');

function baseOccurrence(overrides: {
  doorsAt?: string | null;
  startsAt?: string;
  endsAt?: string | null;
}) {
  return {
    id: occurrenceId,
    eventId,
    doorsAt: overrides.doorsAt === undefined ? null : overrides.doorsAt,
    startsAt: overrides.startsAt ?? '2026-03-05T10:00:00Z',
    endsAt: overrides.endsAt === undefined ? null : overrides.endsAt,
    canceledAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('occurrenceSchema', () => {
  it('accepts doorsAt < startsAt < endsAt', () => {
    const result = occurrenceSchema.safeParse(
      baseOccurrence({
        doorsAt: '2026-03-05T09:00:00Z',
        startsAt: '2026-03-05T10:00:00Z',
        endsAt: '2026-03-05T12:00:00Z',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts doorsAt === startsAt (boundary, inclusive)', () => {
    const result = occurrenceSchema.safeParse(
      baseOccurrence({ doorsAt: '2026-03-05T10:00:00Z', startsAt: '2026-03-05T10:00:00Z' }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts startsAt === endsAt (boundary, inclusive)', () => {
    const result = occurrenceSchema.safeParse(
      baseOccurrence({ startsAt: '2026-03-05T10:00:00Z', endsAt: '2026-03-05T10:00:00Z' }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects doorsAt after startsAt', () => {
    const result = occurrenceSchema.safeParse(
      baseOccurrence({ doorsAt: '2026-03-05T11:00:00Z', startsAt: '2026-03-05T10:00:00Z' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects startsAt after endsAt', () => {
    const result = occurrenceSchema.safeParse(
      baseOccurrence({ startsAt: '2026-03-05T12:00:00Z', endsAt: '2026-03-05T10:00:00Z' }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts null doorsAt and null endsAt (both unknown)', () => {
    const result = occurrenceSchema.safeParse(baseOccurrence({}));
    expect(result.success).toBe(true);
  });

  it('accepts null doorsAt with a valid endsAt (doorsAt is not compared when null)', () => {
    const result = occurrenceSchema.safeParse(
      baseOccurrence({
        doorsAt: null,
        startsAt: '2026-03-05T10:00:00Z',
        endsAt: '2026-03-05T12:00:00Z',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a valid doorsAt with null endsAt (endsAt is not compared when null)', () => {
    const result = occurrenceSchema.safeParse(
      baseOccurrence({
        doorsAt: '2026-03-05T09:00:00Z',
        startsAt: '2026-03-05T10:00:00Z',
        endsAt: null,
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a non-null canceledAt (Occurrence-level cancellation)', () => {
    const result = occurrenceSchema.safeParse({ ...baseOccurrence({}), canceledAt: now });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed startsAt', () => {
    const result = occurrenceSchema.safeParse(baseOccurrence({ startsAt: 'not-an-instant' }));
    expect(result.success).toBe(false);
  });
});
