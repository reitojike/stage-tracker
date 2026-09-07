import { describe, expect, it } from 'vitest';
import { userIdSchema } from '../ids';
import { isParticipationVisibleTo } from './participationVisibility';

const owner = userIdSchema.parse('11111111-1111-4111-8111-111111111111');
const otherUser = userIdSchema.parse('22222222-2222-4222-8222-222222222222');
const eventOwner = userIdSchema.parse('66666666-6666-4666-8666-666666666666');

describe('isParticipationVisibleTo', () => {
  it('is visible to its own user regardless of visibility', () => {
    expect(isParticipationVisibleTo({ userId: owner, visibility: 'private' }, owner)).toBe(true);
    expect(isParticipationVisibleTo({ userId: owner, visibility: 'public' }, owner)).toBe(true);
  });

  it('is visible to another user when visibility is public', () => {
    expect(isParticipationVisibleTo({ userId: owner, visibility: 'public' }, otherUser)).toBe(true);
  });

  it('is not visible to another user when visibility is private', () => {
    expect(isParticipationVisibleTo({ userId: owner, visibility: 'private' }, otherUser)).toBe(
      false,
    );
  });

  it('is not visible to the Event owner just for being the Event owner (private)', () => {
    // The function does not even accept an "is event owner" flag, but this
    // test documents the product rule it enforces by construction: passing
    // any third-party userId - including the Event owner's - behaves
    // identically to any other non-owner viewer.
    expect(isParticipationVisibleTo({ userId: owner, visibility: 'private' }, eventOwner)).toBe(
      false,
    );
  });
});
