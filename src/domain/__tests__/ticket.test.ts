import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignmentToColumns, mapTicketRow, sortTickets, type RawTicketRow } from '../ticket.ts';

function rawRow(overrides: Partial<RawTicketRow> = {}): RawTicketRow {
  return {
    id: 'ticket-1',
    acquisition_id: 'acquisition-1',
    owner_id: 'owner-1',
    seat_label: null,
    queue_number: null,
    medium: null,
    assigned_to_user_id: null,
    assignee_external_name: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

void test('mapTicketRow maps an unassigned ticket', () => {
  const mapped = mapTicketRow(rawRow());
  assert.deepEqual(mapped.assignment, { kind: 'unassigned' });
});

void test('mapTicketRow maps a registered-user assignment', () => {
  const mapped = mapTicketRow(rawRow({ assigned_to_user_id: 'user-9' }));
  assert.deepEqual(mapped.assignment, { kind: 'registered-user', userId: 'user-9' });
});

void test('mapTicketRow maps an external-companion assignment', () => {
  const mapped = mapTicketRow(rawRow({ assignee_external_name: 'Alex' }));
  assert.deepEqual(mapped.assignment, { kind: 'external-companion', name: 'Alex' });
});

void test('mapTicketRow rejects an unrecognized medium', () => {
  assert.throws(() => mapTicketRow(rawRow({ medium: 'app' })));
});

void test('mapTicketRow accepts a null medium without validating it', () => {
  const mapped = mapTicketRow(rawRow({ medium: null }));
  assert.equal(mapped.medium, null);
});

void test('assignmentToColumns clears both columns for unassigned', () => {
  assert.deepEqual(assignmentToColumns({ kind: 'unassigned' }), {
    assigned_to_user_id: null,
    assignee_external_name: null,
  });
});

void test('assignmentToColumns sets only assigned_to_user_id for a registered user', () => {
  assert.deepEqual(assignmentToColumns({ kind: 'registered-user', userId: 'user-9' }), {
    assigned_to_user_id: 'user-9',
    assignee_external_name: null,
  });
});

void test('assignmentToColumns sets only assignee_external_name for an external companion', () => {
  assert.deepEqual(assignmentToColumns({ kind: 'external-companion', name: 'Alex' }), {
    assigned_to_user_id: null,
    assignee_external_name: 'Alex',
  });
});

void test('sortTickets orders by createdAt ascending, id as tie-breaker', () => {
  const older = mapTicketRow(rawRow({ id: 'b', created_at: '2026-01-01T00:00:00Z' }));
  const newer = mapTicketRow(rawRow({ id: 'a', created_at: '2026-01-02T00:00:00Z' }));
  assert.deepEqual(
    sortTickets([newer, older]).map((t) => t.id),
    ['b', 'a'],
  );
});
