import { describe, expect, it } from 'vitest';
import { occurrenceIdSchema, userIdSchema } from '../ids';
import { instantSchema } from '../time/instant';
import { captureDeclinedInvitation, undoDecline } from './declineUndo';
import { invitationIdSchema, invitationSchema } from './invitation';

const occurrenceId = occurrenceIdSchema.parse('44444444-4444-4444-8444-444444444444');
const inviterId = userIdSchema.parse('11111111-1111-4111-8111-111111111111');
const inviteeId = userIdSchema.parse('22222222-2222-4222-8222-222222222222');
const now = instantSchema.parse('2026-01-01T00:00:00Z');

const pendingInvitation = invitationSchema.parse({
  id: invitationIdSchema.parse('77777777-7777-4777-8777-777777777777'),
  occurrenceId,
  inviterId,
  inviteeId,
  createdAt: now,
});

describe('decline -> undo (P3, decisions.md)', () => {
  it('captures the parties needed to recreate the invitation before the hard delete', () => {
    const snapshot = captureDeclinedInvitation(pendingInvitation);
    expect(snapshot).toEqual({ occurrenceId, inviterId, inviteeId });
  });

  it('undo reconstructs a draft with the exact same parties as the original invitation', () => {
    const snapshot = captureDeclinedInvitation(pendingInvitation);
    const draft = undoDecline(snapshot);

    expect(draft).toEqual({
      occurrenceId: pendingInvitation.occurrenceId,
      inviterId: pendingInvitation.inviterId,
      inviteeId: pendingInvitation.inviteeId,
    });
  });

  it('a fresh invitation built from the undo draft is itself a valid, non-self invite', () => {
    const draft = undoDecline(captureDeclinedInvitation(pendingInvitation));
    const recreated = invitationSchema.safeParse({
      id: invitationIdSchema.parse('99999999-9999-4999-8999-999999999999'),
      ...draft,
      createdAt: now,
    });
    expect(recreated.success).toBe(true);
  });
});
