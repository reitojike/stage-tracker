import { describe, expect, it } from 'vitest';
import { occurrenceIdSchema, userIdSchema } from '../ids';
import { invitationsResolvedByAttending } from './attendingConvergence';
import { invitationIdSchema } from './invitation';

const occurrenceA = occurrenceIdSchema.parse('44444444-4444-4444-8444-444444444444');
const occurrenceB = occurrenceIdSchema.parse('88888888-8888-4888-8888-888888888888');
const invitee = userIdSchema.parse('22222222-2222-4222-8222-222222222222');
const otherInvitee = userIdSchema.parse('99999999-9999-4999-8999-999999999999');

const invitationFromInviterOne = invitationIdSchema.parse('11111111-1111-4111-8111-111111111111');
const invitationFromInviterTwo = invitationIdSchema.parse('33333333-3333-4333-8333-333333333333');
const invitationForOtherInvitee = invitationIdSchema.parse('55555555-5555-4555-8555-555555555555');
const invitationForOtherOccurrence = invitationIdSchema.parse(
  '66666666-6666-4666-8666-666666666666',
);

describe('invitationsResolvedByAttending', () => {
  it('resolves every pending invitation for the (occurrence, invitee) pair, across multiple inviters', () => {
    const pending = [
      { id: invitationFromInviterOne, occurrenceId: occurrenceA, inviteeId: invitee },
      { id: invitationFromInviterTwo, occurrenceId: occurrenceA, inviteeId: invitee },
    ];

    const resolved = invitationsResolvedByAttending(pending, occurrenceA, invitee);

    expect(resolved).toEqual(
      expect.arrayContaining([invitationFromInviterOne, invitationFromInviterTwo]),
    );
    expect(resolved).toHaveLength(2);
  });

  it('does not resolve invitations for a different invitee on the same occurrence', () => {
    const pending = [
      { id: invitationFromInviterOne, occurrenceId: occurrenceA, inviteeId: invitee },
      { id: invitationForOtherInvitee, occurrenceId: occurrenceA, inviteeId: otherInvitee },
    ];

    const resolved = invitationsResolvedByAttending(pending, occurrenceA, invitee);

    expect(resolved).toEqual([invitationFromInviterOne]);
  });

  it('does not resolve invitations for the same invitee on a different occurrence', () => {
    const pending = [
      { id: invitationFromInviterOne, occurrenceId: occurrenceA, inviteeId: invitee },
      { id: invitationForOtherOccurrence, occurrenceId: occurrenceB, inviteeId: invitee },
    ];

    const resolved = invitationsResolvedByAttending(pending, occurrenceA, invitee);

    expect(resolved).toEqual([invitationFromInviterOne]);
  });

  it('returns an empty array when there is nothing pending for that pair', () => {
    expect(invitationsResolvedByAttending([], occurrenceA, invitee)).toEqual([]);
  });
});
