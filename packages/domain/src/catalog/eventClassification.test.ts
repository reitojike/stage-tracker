import { describe, expect, it } from 'vitest';
import { eventIdSchema } from '../ids';
import { genreIdSchema } from './ids';
import { groupIdSchema } from './ids';
import { eventClassificationSchema } from './eventClassification';

const eventId = eventIdSchema.parse('11111111-1111-4111-8111-111111111111');
const genreId = genreIdSchema.parse('22222222-2222-4222-8222-222222222222');
const groupIdA = groupIdSchema.parse('33333333-3333-4333-8333-333333333333');
const groupIdB = groupIdSchema.parse('44444444-4444-4444-8444-444444444444');

describe('eventClassificationSchema', () => {
  it('accepts an unclassified event (null genre, no groups)', () => {
    const result = eventClassificationSchema.safeParse({
      eventId,
      genre: null,
      groupIds: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a classified event with a genre and multiple groups (0..N)', () => {
    const result = eventClassificationSchema.safeParse({
      eventId,
      genre: {
        id: genreId,
        key: 'takarazuka',
        displayName: '宝塚',
        sortOrder: 1,
      },
      groupIds: [groupIdA, groupIdB],
    });
    expect(result.success).toBe(true);
  });
});
