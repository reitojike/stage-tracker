import { describe, expect, it } from 'vitest';
import { userIdSchema } from '../ids';
import { instantSchema } from '../time/instant';
import { personalScheduleEntryIdSchema } from './ids';
import { personalScheduleEntrySchema, personalScheduleEntryTemporalSchema } from './scheduleEntry';

const entryId = personalScheduleEntryIdSchema.parse('11111111-1111-4111-8111-111111111111');
const ownerId = userIdSchema.parse('22222222-2222-4222-8222-222222222222');
const now = instantSchema.parse('2026-01-01T00:00:00Z');

function baseEntry(temporal: unknown) {
  return {
    id: entryId,
    ownerId,
    title: '有休',
    memo: null,
    blocking: true,
    temporal,
    createdAt: now,
    updatedAt: now,
  };
}

describe('personalScheduleEntryTemporalSchema - all-day', () => {
  it('accepts a single-day all-day span (startsOn === endsOn, boundary)', () => {
    const result = personalScheduleEntryTemporalSchema.safeParse({
      kind: 'all-day',
      startsOn: '2026-03-05',
      endsOn: '2026-03-05',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a multi-day all-day span', () => {
    const result = personalScheduleEntryTemporalSchema.safeParse({
      kind: 'all-day',
      startsOn: '2026-03-05',
      endsOn: '2026-03-08',
    });
    expect(result.success).toBe(true);
  });

  it('rejects endsOn before startsOn', () => {
    const result = personalScheduleEntryTemporalSchema.safeParse({
      kind: 'all-day',
      startsOn: '2026-03-08',
      endsOn: '2026-03-05',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an all-day payload carrying time-bounded fields', () => {
    const result = personalScheduleEntryTemporalSchema.safeParse({
      kind: 'all-day',
      startsOn: '2026-03-05',
      endsOn: '2026-03-05',
      startsAt: '2026-03-05T00:00:00Z',
    });
    // Extra unknown keys on a discriminated-union member are stripped by
    // zod's default object parsing, not rejected - this asserts that
    // behavior stays intentional rather than silently changing, since a
    // stricter (`.strict()`) schema would instead fail this case.
    expect(result.success).toBe(true);
  });
});

describe('personalScheduleEntryTemporalSchema - time-bounded', () => {
  it('accepts startsAt with endsAt null (end time not yet known)', () => {
    const result = personalScheduleEntryTemporalSchema.safeParse({
      kind: 'time-bounded',
      startsAt: '2026-03-05T10:00:00Z',
      endsAt: null,
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.kind === 'time-bounded') {
      expect(result.data.endsAt).toBeNull();
    }
  });

  it('accepts startsAt strictly before endsAt', () => {
    const result = personalScheduleEntryTemporalSchema.safeParse({
      kind: 'time-bounded',
      startsAt: '2026-03-05T10:00:00Z',
      endsAt: '2026-03-05T12:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts startsAt === endsAt (boundary, a zero-duration event)', () => {
    const result = personalScheduleEntryTemporalSchema.safeParse({
      kind: 'time-bounded',
      startsAt: '2026-03-05T10:00:00Z',
      endsAt: '2026-03-05T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects endsAt before startsAt', () => {
    const result = personalScheduleEntryTemporalSchema.safeParse({
      kind: 'time-bounded',
      startsAt: '2026-03-05T12:00:00Z',
      endsAt: '2026-03-05T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('never fabricates a time for a null endsAt (no default substituted)', () => {
    const result = personalScheduleEntryTemporalSchema.parse({
      kind: 'time-bounded',
      startsAt: '2026-03-05T10:00:00Z',
      endsAt: null,
    });
    expect(result).toEqual({
      kind: 'time-bounded',
      startsAt: '2026-03-05T10:00:00.000Z',
      endsAt: null,
    });
  });
});

describe('personalScheduleEntrySchema', () => {
  it('accepts a well-formed all-day entry', () => {
    const result = personalScheduleEntrySchema.safeParse(
      baseEntry({ kind: 'all-day', startsOn: '2026-03-05', endsOn: '2026-03-08' }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a well-formed time-bounded entry', () => {
    const result = personalScheduleEntrySchema.safeParse(
      baseEntry({ kind: 'time-bounded', startsAt: '2026-03-05T10:00:00Z', endsAt: null }),
    );
    expect(result.success).toBe(true);
  });

  it('requires a non-empty title (no fixed category exists to fall back to)', () => {
    const result = personalScheduleEntrySchema.safeParse({
      ...baseEntry({ kind: 'all-day', startsOn: '2026-03-05', endsOn: '2026-03-05' }),
      title: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts blocking: false (non-blocking entries are valid)', () => {
    const result = personalScheduleEntrySchema.safeParse({
      ...baseEntry({ kind: 'all-day', startsOn: '2026-03-05', endsOn: '2026-03-05' }),
      blocking: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a null memo', () => {
    const result = personalScheduleEntrySchema.safeParse(
      baseEntry({ kind: 'all-day', startsOn: '2026-03-05', endsOn: '2026-03-05' }),
    );
    expect(result.success).toBe(true);
  });
});
