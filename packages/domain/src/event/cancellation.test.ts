import { describe, expect, it } from 'vitest';
import { instantSchema } from '../time/instant';
import { isCanceled, isEffectivelyCanceled } from './cancellation';

const canceledAt = instantSchema.parse('2026-01-01T00:00:00Z');

describe('isCanceled', () => {
  it('is false when canceledAt is null', () => {
    expect(isCanceled({ canceledAt: null })).toBe(false);
  });

  it('is true when canceledAt is set, regardless of the specific timestamp value', () => {
    expect(isCanceled({ canceledAt })).toBe(true);
  });
});

describe('isEffectivelyCanceled (OR of Event-level and Occurrence-level cancellation)', () => {
  it('is false when neither Event nor Occurrence is canceled', () => {
    expect(isEffectivelyCanceled({ canceledAt: null }, { canceledAt: null })).toBe(false);
  });

  it('is true when only the Event is canceled', () => {
    expect(isEffectivelyCanceled({ canceledAt }, { canceledAt: null })).toBe(true);
  });

  it('is true when only the Occurrence is canceled', () => {
    expect(isEffectivelyCanceled({ canceledAt: null }, { canceledAt })).toBe(true);
  });

  it('is true when both are canceled', () => {
    expect(isEffectivelyCanceled({ canceledAt }, { canceledAt })).toBe(true);
  });
});
