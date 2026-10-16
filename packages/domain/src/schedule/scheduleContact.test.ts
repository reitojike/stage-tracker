import { describe, expect, it } from 'vitest';
import {
  scheduleContactAliasInputSchema,
  scheduleContactEmailInputSchema,
  scheduleContactSchema,
} from './scheduleContact';

describe('schedule contact inputs', () => {
  it('normalizes exact email without provider-specific alias expansion', () => {
    expect(scheduleContactEmailInputSchema.parse('  A.B+Family@Example.TEST ')).toBe(
      'a.b+family@example.test',
    );
    for (const value of ['', 'name', 'a@example', 'a b@example.test', 'a'.repeat(321)]) {
      expect(scheduleContactEmailInputSchema.safeParse(value).success).toBe(false);
    }
  });
  it('clears blank aliases and measures the database character limit in code points', () => {
    expect(scheduleContactAliasInputSchema.parse('  妻  ')).toBe('妻');
    expect(scheduleContactAliasInputSchema.parse('  ')).toBeNull();
    expect(scheduleContactAliasInputSchema.parse(null)).toBeNull();
    expect(scheduleContactAliasInputSchema.parse('😀'.repeat(80))).toBe('😀'.repeat(80));
    expect(scheduleContactAliasInputSchema.safeParse('😀'.repeat(81)).success).toBe(false);
    expect(scheduleContactAliasInputSchema.safeParse('name\0suffix').success).toBe(false);
  });
  it('keeps a nullable private alias and requires a valid generation and timestamp', () => {
    const row = {
      contactId: '11111111-1111-4111-8111-111111111111',
      counterpartEmail: 'b@example.test',
      ownAlias: null,
      acceptedAt: '2026-10-16T00:00:00+00:00',
    };
    expect(scheduleContactSchema.parse(row).ownAlias).toBeNull();
    expect(scheduleContactSchema.parse({ ...row, ownAlias: '\tname\t' }).ownAlias).toBe('\tname\t');
    expect(scheduleContactSchema.safeParse({ ...row, contactId: 'user-name' }).success).toBe(false);
    expect(scheduleContactSchema.safeParse({ ...row, acceptedAt: 'yesterday' }).success).toBe(
      false,
    );
  });
});
