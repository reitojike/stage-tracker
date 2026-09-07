import { describe, expect, it } from 'vitest';
import { userIdSchema } from '../ids';
import { instantSchema } from '../time/instant';
import { personalScheduleEntryIdSchema, scheduleShareIdSchema } from './ids';
import {
  canUserViewPersonalScheduleEntry,
  personalScheduleEntryBlockingForViewer,
  scheduleShareSchema,
} from './scheduleShare';

const ownerId = userIdSchema.parse('11111111-1111-4111-8111-111111111111');
const recipientId = userIdSchema.parse('22222222-2222-4222-8222-222222222222');
const strangerId = userIdSchema.parse('33333333-3333-4333-8333-333333333333');
const entryId = personalScheduleEntryIdSchema.parse('44444444-4444-4444-8444-444444444444');
const shareId = scheduleShareIdSchema.parse('55555555-5555-4555-8555-555555555555');
const now = instantSchema.parse('2026-01-01T00:00:00Z');

describe('scheduleShareSchema', () => {
  it('accepts a well-formed share', () => {
    const result = scheduleShareSchema.safeParse({
      id: shareId,
      scheduleEntryId: entryId,
      sharedWithUserId: recipientId,
      createdAt: now,
    });
    expect(result.success).toBe(true);
  });
});

describe('canUserViewPersonalScheduleEntry', () => {
  const entry = { ownerId };
  const shares = [{ sharedWithUserId: recipientId }];

  it('the owner can always view their own entry, even with no shares', () => {
    expect(canUserViewPersonalScheduleEntry(entry, [], ownerId)).toBe(true);
  });

  it('a recipient named in shares can view the entry', () => {
    expect(canUserViewPersonalScheduleEntry(entry, shares, recipientId)).toBe(true);
  });

  it('an unrelated authenticated user cannot view a private (unshared) entry', () => {
    expect(canUserViewPersonalScheduleEntry(entry, shares, strangerId)).toBe(false);
  });

  it('with zero shares, only the owner can view (default private)', () => {
    expect(canUserViewPersonalScheduleEntry(entry, [], recipientId)).toBe(false);
  });
});

describe('personalScheduleEntryBlockingForViewer - blocking propagates identically, no per-recipient override', () => {
  it('a blocking entry reads as blocking for the owner', () => {
    expect(personalScheduleEntryBlockingForViewer({ blocking: true })).toBe(true);
  });

  it('the same blocking entry reads as blocking for a recipient too (no per-recipient override exists to change it)', () => {
    // This function takes no viewer parameter at all - that absence IS the
    // invariant: there is no override to look up per recipient.
    expect(personalScheduleEntryBlockingForViewer({ blocking: true })).toBe(true);
  });

  it('a non-blocking entry reads as non-blocking for every viewer', () => {
    expect(personalScheduleEntryBlockingForViewer({ blocking: false })).toBe(false);
  });
});
