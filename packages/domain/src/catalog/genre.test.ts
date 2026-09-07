import { describe, expect, it } from 'vitest';
import { genreIdSchema } from './ids';
import { genreSchema } from './genre';

const genreId = genreIdSchema.parse('11111111-1111-4111-8111-111111111111');

describe('genreSchema', () => {
  it('accepts a well-formed seed genre row', () => {
    const result = genreSchema.safeParse({
      id: genreId,
      key: 'takarazuka',
      displayName: '宝塚',
      sortOrder: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty key', () => {
    const result = genreSchema.safeParse({
      id: genreId,
      key: '',
      displayName: '宝塚',
      sortOrder: 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-integer sortOrder', () => {
    const result = genreSchema.safeParse({
      id: genreId,
      key: 'takarazuka',
      displayName: '宝塚',
      sortOrder: 1.5,
    });
    expect(result.success).toBe(false);
  });
});
