import { describe, expect, it } from 'vitest';
import { occurrenceIdSchema, userIdSchema } from '../ids';
import { instantSchema } from '../time/instant';
import {
  DEFAULT_PARTICIPATION_VISIBILITY,
  participationIdSchema,
  participationSchema,
} from './participation';

const participationId = participationIdSchema.parse('33333333-3333-4333-8333-333333333333');
const occurrenceId = occurrenceIdSchema.parse('44444444-4444-4444-8444-444444444444');
const userId = userIdSchema.parse('55555555-5555-4555-8555-555555555555');
const now = instantSchema.parse('2026-01-01T00:00:00Z');

function baseParticipation(overrides: Partial<{ status: string; visibility: string }> = {}) {
  return {
    id: participationId,
    occurrenceId,
    userId,
    status: overrides.status ?? 'considering',
    visibility: overrides.visibility ?? 'private',
    createdAt: now,
    updatedAt: now,
  };
}

describe('participationSchema', () => {
  it('accepts a considering participation', () => {
    const result = participationSchema.safeParse(baseParticipation({ status: 'considering' }));
    expect(result.success).toBe(true);
  });

  it('accepts an attending participation', () => {
    const result = participationSchema.safeParse(baseParticipation({ status: 'attending' }));
    expect(result.success).toBe(true);
  });

  it('rejects "not_attending" - it must never be a persisted status value', () => {
    const result = participationSchema.safeParse(baseParticipation({ status: 'not_attending' }));
    expect(result.success).toBe(false);
  });

  it('rejects an unknown status value', () => {
    const result = participationSchema.safeParse(baseParticipation({ status: 'going' }));
    expect(result.success).toBe(false);
  });

  it('accepts private visibility', () => {
    const result = participationSchema.safeParse(baseParticipation({ visibility: 'private' }));
    expect(result.success).toBe(true);
  });

  it('accepts public visibility', () => {
    const result = participationSchema.safeParse(baseParticipation({ visibility: 'public' }));
    expect(result.success).toBe(true);
  });

  it('rejects an unknown visibility value', () => {
    const result = participationSchema.safeParse(baseParticipation({ visibility: 'friends' }));
    expect(result.success).toBe(false);
  });

  it('has no eventId field - Participation is scoped to an Occurrence only', () => {
    const parsed = participationSchema.parse(baseParticipation());
    expect('eventId' in parsed).toBe(false);
  });
});

describe('DEFAULT_PARTICIPATION_VISIBILITY', () => {
  it('is private', () => {
    expect(DEFAULT_PARTICIPATION_VISIBILITY).toBe('private');
  });
});
