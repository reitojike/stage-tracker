import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapInvitationRow, sortInvitations, type RawInvitationRow } from '../invitation.ts';

function rawInvitationRow(overrides: Partial<RawInvitationRow> = {}): RawInvitationRow {
  return {
    id: 'invitation-1',
    occurrence_id: 'occurrence-1',
    inviter_id: 'inviter-1',
    invitee_id: 'invitee-1',
    declined_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

void test('mapInvitationRow maps every column to its domain field', () => {
  const mapped = mapInvitationRow(rawInvitationRow({ declined_at: '2026-01-05T00:00:00Z' }));
  assert.deepEqual(mapped, {
    id: 'invitation-1',
    occurrenceId: 'occurrence-1',
    inviterId: 'inviter-1',
    inviteeId: 'invitee-1',
    declinedAt: '2026-01-05T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
});

void test('mapInvitationRow passes through a null declinedAt as-is', () => {
  const mapped = mapInvitationRow(rawInvitationRow());
  assert.equal(mapped.declinedAt, null);
});

void test('sortInvitations orders by createdAt ascending, id as tie-breaker', () => {
  const older = mapInvitationRow(rawInvitationRow({ id: 'b', created_at: '2026-01-01T00:00:00Z' }));
  const newer = mapInvitationRow(rawInvitationRow({ id: 'a', created_at: '2026-01-02T00:00:00Z' }));
  const sorted = sortInvitations([newer, older]);
  assert.deepEqual(
    sorted.map((i) => i.id),
    ['b', 'a'],
  );
});
