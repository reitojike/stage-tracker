import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mapTicketAcquisitionRow,
  sortTicketAcquisitions,
  type RawTicketAcquisitionRow,
} from '../ticketAcquisition.ts';

function rawRow(overrides: Partial<RawTicketAcquisitionRow> = {}): RawTicketAcquisitionRow {
  return {
    id: 'acquisition-1',
    owner_id: 'owner-1',
    occurrence_id: 'occurrence-1',
    status: 'pending',
    memo: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

void test('mapTicketAcquisitionRow maps every column to its domain field', () => {
  const mapped = mapTicketAcquisitionRow(rawRow({ status: 'secured', memo: 'lottery win' }));
  assert.deepEqual(mapped, {
    id: 'acquisition-1',
    ownerId: 'owner-1',
    occurrenceId: 'occurrence-1',
    status: 'secured',
    memo: 'lottery win',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
});

void test('mapTicketAcquisitionRow rejects an unrecognized status', () => {
  assert.throws(() => mapTicketAcquisitionRow(rawRow({ status: 'refunded' })));
});

void test('sortTicketAcquisitions orders by createdAt ascending, id as tie-breaker', () => {
  const older = mapTicketAcquisitionRow(rawRow({ id: 'b', created_at: '2026-01-01T00:00:00Z' }));
  const newer = mapTicketAcquisitionRow(rawRow({ id: 'a', created_at: '2026-01-02T00:00:00Z' }));
  assert.deepEqual(
    sortTicketAcquisitions([newer, older]).map((a) => a.id),
    ['b', 'a'],
  );
});
