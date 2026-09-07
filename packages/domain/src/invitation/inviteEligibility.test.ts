import { describe, expect, it } from 'vitest';
import { canInviteToOccurrence } from './inviteEligibility';

describe('canInviteToOccurrence', () => {
  it('allows inviting when the inviter is attending', () => {
    expect(canInviteToOccurrence('attending')).toBe(true);
  });

  it('does not allow inviting when the inviter is only considering', () => {
    // This is the "owner is considering, not attending" case from the task's
    // acceptance criteria: being the Event owner is not even representable
    // here, since this function only ever looks at participation status.
    expect(canInviteToOccurrence('considering')).toBe(false);
  });

  it('does not allow inviting when the inviter has no participation row at all', () => {
    expect(canInviteToOccurrence(null)).toBe(false);
  });
});
