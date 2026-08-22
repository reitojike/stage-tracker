import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mapPendingTransferOfferRow,
  mapTicketTransferRow,
  sortTicketTransfers,
  type RawPendingTransferOfferRow,
  type RawTicketTransferRow,
} from '../ticketTransfer.ts';

function rawTransferRow(overrides: Partial<RawTicketTransferRow> = {}): RawTicketTransferRow {
  return {
    id: 'transfer-1',
    ticket_id: 'ticket-1',
    sender_id: 'sender-1',
    recipient_id: 'recipient-1',
    status: 'pending',
    responded_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

void test('mapTicketTransferRow maps every column to its domain field', () => {
  const mapped = mapTicketTransferRow(
    rawTransferRow({ status: 'accepted', responded_at: '2026-01-02T00:00:00Z' }),
  );
  assert.deepEqual(mapped, {
    id: 'transfer-1',
    ticketId: 'ticket-1',
    senderId: 'sender-1',
    recipientId: 'recipient-1',
    status: 'accepted',
    respondedAt: '2026-01-02T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
});

void test('mapTicketTransferRow rejects an unrecognized status', () => {
  assert.throws(() => mapTicketTransferRow(rawTransferRow({ status: 'expired' })));
});

void test('sortTicketTransfers orders by createdAt ascending, id as tie-breaker', () => {
  const older = mapTicketTransferRow(
    rawTransferRow({ id: 'b', created_at: '2026-01-01T00:00:00Z' }),
  );
  const newer = mapTicketTransferRow(
    rawTransferRow({ id: 'a', created_at: '2026-01-02T00:00:00Z' }),
  );
  assert.deepEqual(
    sortTicketTransfers([newer, older]).map((t) => t.id),
    ['b', 'a'],
  );
});

function rawOfferRow(
  overrides: Partial<RawPendingTransferOfferRow> = {},
): RawPendingTransferOfferRow {
  return {
    transfer_id: 'transfer-1',
    ticket_id: 'ticket-1',
    occurrence_id: 'occurrence-1',
    seat_label: null,
    queue_number: null,
    medium: null,
    ...overrides,
  };
}

void test('mapPendingTransferOfferRow exposes only the bounded decision-surface fields', () => {
  const mapped = mapPendingTransferOfferRow(rawOfferRow({ seat_label: 'A1' }));
  assert.deepEqual(mapped, {
    transferId: 'transfer-1',
    ticketId: 'ticket-1',
    occurrenceId: 'occurrence-1',
    seatLabel: 'A1',
    queueNumber: null,
    medium: null,
  });
  assert.deepEqual(Object.keys(mapped).sort(), [
    'medium',
    'occurrenceId',
    'queueNumber',
    'seatLabel',
    'ticketId',
    'transferId',
  ]);
});
