import { describe, expect, it } from 'vitest';
import { groupIdSchema } from './ids';
import { groupSchema } from './group';

const groupId = groupIdSchema.parse('11111111-1111-4111-8111-111111111111');

describe('groupSchema', () => {
  it('accepts a well-formed group row', () => {
    const result = groupSchema.safeParse({
      id: groupId,
      key: 'hoshigumi',
      displayName: '星組',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty displayName', () => {
    const result = groupSchema.safeParse({
      id: groupId,
      key: 'hoshigumi',
      displayName: '',
    });
    expect(result.success).toBe(false);
  });
});
