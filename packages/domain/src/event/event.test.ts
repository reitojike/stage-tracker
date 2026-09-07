import { describe, expect, it } from 'vitest';
import { eventIdSchema, userIdSchema } from '../ids';
import { instantSchema } from '../time/instant';
import { tokyoCalendarDateSchema } from '../time/tokyoCalendarDate';
import { eventRangeSchema, eventSchema } from './event';

const eventId = eventIdSchema.parse('11111111-1111-4111-8111-111111111111');
const ownerId = userIdSchema.parse('22222222-2222-4222-8222-222222222222');
const now = instantSchema.parse('2026-01-01T00:00:00Z');

function baseEvent(overrides: Partial<{ startsOn: string; endsOn: string }> = {}) {
  return {
    id: eventId,
    ownerId,
    title: 'テスト興行',
    venue: null,
    sourceUrl: null,
    memo: null,
    startsOn: overrides.startsOn ?? '2026-03-01',
    endsOn: overrides.endsOn ?? '2026-03-10',
    canceledAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('eventRangeSchema', () => {
  it('accepts startsOn strictly before endsOn', () => {
    const result = eventRangeSchema.safeParse({ startsOn: '2026-01-01', endsOn: '2026-01-31' });
    expect(result.success).toBe(true);
  });

  it('accepts a single-day range where startsOn equals endsOn (boundary)', () => {
    const result = eventRangeSchema.safeParse({ startsOn: '2026-01-15', endsOn: '2026-01-15' });
    expect(result.success).toBe(true);
  });

  it('rejects startsOn after endsOn', () => {
    const result = eventRangeSchema.safeParse({ startsOn: '2026-01-31', endsOn: '2026-01-01' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid startsOn calendar date', () => {
    const result = eventRangeSchema.safeParse({ startsOn: '2026-02-30', endsOn: '2026-03-01' });
    expect(result.success).toBe(false);
  });
});

describe('eventSchema', () => {
  it('accepts a well-formed event with a multi-day range', () => {
    const result = eventSchema.safeParse(baseEvent());
    expect(result.success).toBe(true);
  });

  it('accepts a single-day event (startsOn === endsOn, boundary)', () => {
    const result = eventSchema.safeParse(
      baseEvent({ startsOn: '2026-03-05', endsOn: '2026-03-05' }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects startsOn after endsOn', () => {
    const result = eventSchema.safeParse(
      baseEvent({ startsOn: '2026-03-10', endsOn: '2026-03-01' }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts null venue/sourceUrl/memo', () => {
    const result = eventSchema.safeParse(baseEvent());
    expect(result.success).toBe(true);
  });

  it('accepts a populated venue/sourceUrl/memo', () => {
    const result = eventSchema.safeParse({
      ...baseEvent(),
      venue: '東京宝塚劇場',
      sourceUrl: 'https://example.com/event',
      memo: 'メモ',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty title', () => {
    const result = eventSchema.safeParse({ ...baseEvent(), title: '' });
    expect(result.success).toBe(false);
  });

  it('accepts a non-null canceledAt (Event-level cancellation)', () => {
    const result = eventSchema.safeParse({ ...baseEvent(), canceledAt: now });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed id (not a UUID)', () => {
    const result = eventSchema.safeParse({ ...baseEvent(), id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('tokyoCalendarDateSchema reuse sanity (Event range fields)', () => {
  it('parses the same startsOn value both directly and via eventSchema', () => {
    const direct = tokyoCalendarDateSchema.parse('2026-03-01');
    const viaEvent = eventSchema.parse(baseEvent()).startsOn;
    expect(viaEvent).toBe(direct);
  });
});
