import { describe, expect, it } from 'vitest';
import {
  isParticipationWriteBlockedByCancellation,
  type ParticipationWriteTransition,
} from './participationCancellationGate';

describe('isParticipationWriteBlockedByCancellation', () => {
  it('never blocks anything when the occurrence is not effectively canceled', () => {
    const transitions: ParticipationWriteTransition[] = [
      { kind: 'create', status: 'considering' },
      { kind: 'create', status: 'attending' },
      { kind: 'update', from: 'considering', to: 'attending' },
      { kind: 'update', from: 'attending', to: 'considering' },
      { kind: 'withdraw' },
    ];
    for (const transition of transitions) {
      expect(isParticipationWriteBlockedByCancellation(transition, false)).toBe(false);
    }
  });

  it('always allows withdraw, even while effectively canceled', () => {
    expect(isParticipationWriteBlockedByCancellation({ kind: 'withdraw' }, true)).toBe(false);
  });

  it('blocks creating a new row while effectively canceled', () => {
    expect(
      isParticipationWriteBlockedByCancellation({ kind: 'create', status: 'considering' }, true),
    ).toBe(true);
    expect(
      isParticipationWriteBlockedByCancellation({ kind: 'create', status: 'attending' }, true),
    ).toBe(true);
  });

  it('blocks considering -> attending while effectively canceled', () => {
    expect(
      isParticipationWriteBlockedByCancellation(
        { kind: 'update', from: 'considering', to: 'attending' },
        true,
      ),
    ).toBe(true);
  });

  it('allows attending -> considering (downgrade) even while effectively canceled', () => {
    expect(
      isParticipationWriteBlockedByCancellation(
        { kind: 'update', from: 'attending', to: 'considering' },
        true,
      ),
    ).toBe(false);
  });

  it('allows a same-status update (e.g. visibility-only change) while effectively canceled', () => {
    expect(
      isParticipationWriteBlockedByCancellation(
        { kind: 'update', from: 'attending', to: 'attending' },
        true,
      ),
    ).toBe(false);
    expect(
      isParticipationWriteBlockedByCancellation(
        { kind: 'update', from: 'considering', to: 'considering' },
        true,
      ),
    ).toBe(false);
  });
});
