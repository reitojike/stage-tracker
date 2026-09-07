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
      return result.value;
    });

    // Every branch must produce byte-for-byte the same value, and that value
    // must be the single canonical INVITE_OUTCOME constant - not merely
    // "happen to be equal today".
    for (const outcome of outcomes) {
      expect(outcome).toBe(INVITE_OUTCOME);
    }
    expect(new Set(outcomes).size).toBe(1);
  });

  it('the full Result object is deeply identical across all 3 branches - not just matching keys', () => {
    const results = branches.map((inviteeStatus) => evaluateInvite(baseRequest(inviteeStatus)));

    // Deep-equal each branch's full Result (ok + value) against a fixed
    // expected shape, and against every other branch's Result. This is a
    // value comparison, not merely a key-name comparison: if a future change
    // ever widened the success value into an object carrying a
    // branch-dependent field (e.g. re-attaching `writePlan`), the branches
    // would still share the same *keys* but differ in *value*, and this
    // assertion would catch that - `toEqual`'s recursive value comparison,
    // not `Object.keys`, is what makes that meaningful.
    for (const result of results) {
      expect(result).toEqual({ ok: true, value: INVITE_OUTCOME });
    }
    const [first, ...rest] = results;
    for (const result of rest) {
      expect(result).toEqual(first);
    }
  });

  it("evaluateInvite's success value carries no invitee-state-derived field (e.g. no writePlan)", () => {
    for (const inviteeStatus of branches) {
      const result = evaluateInvite(baseRequest(inviteeStatus));
      if (!result.ok) {
        throw new Error('expected all 3 branches to be eligible in this test setup');
      }
      // `result.value` is the bare `InviteOutcome` string literal, not an
      // object - there is no container a `writePlan` field could be
      // attached to, accidentally or otherwise.
      expect(typeof result.value).toBe('string');
      expect(result.value).not.toHaveProperty('writePlan');
    }
  });
});

describe('trusted write-boundary flow: evaluateInvite and planInviteWrite are obtained separately', () => {
  const branches: (ParticipationStatus | null)[] = [null, 'considering', 'attending'];

  it.each(branches)(
    'for invitee state %s, the write boundary calls planInviteWrite itself after evaluateInvite succeeds',
    (inviteeStatus) => {
      const request = baseRequest(inviteeStatus);

      const decision = evaluateInvite(request);
      if (!decision.ok) {
        throw new Error('expected all 3 branches to be eligible in this test setup');
      }
      expect(decision.value).toBe(INVITE_OUTCOME);

      // The write boundary derives the write plan from the same
      // `inviteeParticipationStatus` it already holds on `request` - not
      // from anything returned by `evaluateInvite`.
      const writePlan = planInviteWrite(request.inviteeParticipationStatus);
      expect(writePlan.createInvitation).toBe(inviteeStatus !== 'attending');
    },
  );
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
