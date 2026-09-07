import { describe, expect, it } from 'vitest';
import { occurrenceIdSchema, userIdSchema } from '../ids';
import { instantSchema } from '../time/instant';
import { invitationIdSchema, invitationSchema } from './invitation';

const invitationId = invitationIdSchema.parse('77777777-7777-4777-8777-777777777777');
const occurrenceId = occurrenceIdSchema.parse('44444444-4444-4444-8444-444444444444');
const inviterId = userIdSchema.parse('11111111-1111-4111-8111-111111111111');
const inviteeId = userIdSchema.parse('22222222-2222-4222-8222-222222222222');
const now = instantSchema.parse('2026-01-01T00:00:00Z');

function baseInvitation(overrides: Partial<{ inviterId: string; inviteeId: string }> = {}) {
  return {
    id: invitationId,
    occurrenceId,
    inviterId: overrides.inviterId ?? inviterId,
    inviteeId: overrides.inviteeId ?? inviteeId,
    createdAt: now,
  };
}

describe('invitationSchema', () => {
  it('accepts a well-formed pending invitation', () => {
    const result = invitationSchema.safeParse(baseInvitation());
    expect(result.success).toBe(true);
  });

  it('rejects a self-invite (inviterId === inviteeId)', () => {
    const result = invitationSchema.safeParse(baseInvitation({ inviteeId: inviterId }));
    expect(result.success).toBe(false);
  });

  it('has no declined_at/updated_at field - a pending Invitation is an immutable record', () => {
    const parsed = invitationSchema.parse(baseInvitation());
    expect('declinedAt' in parsed).toBe(false);
    expect('updatedAt' in parsed).toBe(false);
  });
});
