import { describe, expect, it } from 'vitest';
import type { ParticipationStatus } from '../participation/participation';
import {
  evaluateInvite,
  INVITE_OUTCOME,
  planInviteWrite,
  type InviteRequest,
} from './inviteOpacity';

function baseRequest(inviteeParticipationStatus: ParticipationStatus | null): InviteRequest {
  return {
    isSelfInvite: false,
    isOccurrenceEffectivelyCanceled: false,
    inviterParticipationStatus: 'attending',
    inviteeParticipationStatus,
  };
}

describe('planInviteWrite - the three invitee-state branches', () => {
  it('branch 1 (no existing row): creates a pending invitation', () => {
    expect(planInviteWrite(null)).toEqual({ createInvitation: true });
  });

  it('branch 2 (existing considering): creates a pending invitation', () => {
    expect(planInviteWrite('considering')).toEqual({ createInvitation: true });
  });

  it('branch 3 (existing attending): does not create a pending invitation', () => {
    expect(planInviteWrite('attending')).toEqual({ createInvitation: false });
  });
});

describe('evaluateInvite - opacity: the inviter-facing outcome must not distinguish the 3 branches', () => {
  const branches: (ParticipationStatus | null)[] = [null, 'considering', 'attending'];

  it('always returns the exact same outcome value across all 3 invitee-state branches', () => {
    const outcomes = branches.map((inviteeStatus) => {
      const result = evaluateInvite(baseRequest(inviteeStatus));
      if (!result.ok) {
        throw new Error('expected all 3 branches to be eligible in this test setup');
      }
      return result.value.outcome;
    });

    // Every branch must produce byte-for-byte the same value, and that value
    // must be the single canonical INVITE_OUTCOME constant - not merely
    // "happen to be equal today".
    for (const outcome of outcomes) {
      expect(outcome).toBe(INVITE_OUTCOME);
    }
    expect(new Set(outcomes).size).toBe(1);
  });

  it('the outcome object has an identical shape (same keys) across all 3 branches', () => {
    for (const inviteeStatus of branches) {
      const result = evaluateInvite(baseRequest(inviteeStatus));
      if (!result.ok) {
        throw new Error('expected all 3 branches to be eligible in this test setup');
      }
      expect(Object.keys(result.value)).toEqual(['outcome', 'writePlan']);
      expect(Object.keys(result.value.writePlan)).toEqual(['createInvitation']);
    }
  });

  it('still computes the correct (branch-dependent) write plan internally for each branch', () => {
    const noRow = evaluateInvite(baseRequest(null));
    const considering = evaluateInvite(baseRequest('considering'));
    const attending = evaluateInvite(baseRequest('attending'));
    if (!noRow.ok || !considering.ok || !attending.ok) {
      throw new Error('expected all 3 branches to be eligible in this test setup');
    }
    expect(noRow.value.writePlan.createInvitation).toBe(true);
    expect(considering.value.writePlan.createInvitation).toBe(true);
    expect(attending.value.writePlan.createInvitation).toBe(false);
  });
});

describe('evaluateInvite - eligibility and guards (inviter-visible rejections)', () => {
  it('rejects self-invite', () => {
    const result = evaluateInvite({ ...baseRequest('considering'), isSelfInvite: true });
    expect(result).toEqual({ ok: false, error: 'self-invite' });
  });

  it('rejects inviting on an effectively canceled occurrence', () => {
    const result = evaluateInvite({
      ...baseRequest('considering'),
      isOccurrenceEffectivelyCanceled: true,
    });
    expect(result).toEqual({ ok: false, error: 'occurrence-effectively-canceled' });
  });

  it('rejects when the inviter is only considering (not attending) - owner has no bearing', () => {
    const result = evaluateInvite({
      ...baseRequest('considering'),
      inviterParticipationStatus: 'considering',
    });
    expect(result).toEqual({ ok: false, error: 'inviter-not-attending' });
  });

  it('rejects when the inviter has no participation row at all', () => {
    const result = evaluateInvite({
      ...baseRequest('considering'),
      inviterParticipationStatus: null,
    });
    expect(result).toEqual({ ok: false, error: 'inviter-not-attending' });
  });

  it('succeeds when the inviter is attending and nothing else blocks it', () => {
    const result = evaluateInvite(baseRequest('considering'));
    expect(result.ok).toBe(true);
  });
});
