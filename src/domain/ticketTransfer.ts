// Ticket transfer domain model (Issue #33), over the persistence/RLS
// baseline Issue #32 established
// (supabase/migrations/20260822093200_create_ticket_transfers.sql and
// 20260822093400_create_ticket_transfer_rpcs.sql).
//
// Product semantics (see .ai-dev-foundation/product-rules.md, "Ticket
// transfer"):
// - request / accept / cancel are explicit operations, each a dedicated
//   SECURITY DEFINER RPC - this table has no INSERT/UPDATE/DELETE grant at
//   all, so those RPCs are the *only* way a transfer's lifecycle changes.
// - A transfer never changes participation state (see domain/
//   participation.ts) - nothing here reads or writes it, and Issue #33's
//   regression test pins that this typed boundary preserves that.
// - Before acceptance, the recipient must not see the previous owner's
//   assignment (Issue #32, hardened by Issue #50) - see
//   getPendingTransferOffer in infrastructure/supabase/ticketTransfer.ts,
//   which is the bounded, assignment-free projection a pending recipient
//   gets instead of row-level ticket access.
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs).

import { compareByFieldThenId, sortByFieldThenId } from './ordering.ts';

export type TransferStatus = 'pending' | 'accepted' | 'cancelled';

const TRANSFER_STATUSES: ReadonlySet<string> = new Set<TransferStatus>([
  'pending',
  'accepted',
  'cancelled',
]);

function isTransferStatus(value: string): value is TransferStatus {
  return TRANSFER_STATUSES.has(value);
}

export interface TicketTransfer {
  id: string;
  ticketId: string;
  senderId: string;
  recipientId: string;
  status: TransferStatus;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The bounded, assignment-free decision surface a pending recipient gets
 * for a transfer addressed to them - see pending_ticket_transfer_offer.
 * Deliberately excludes owner_id, acquisition_id, and both assignment
 * columns: those are exactly what the pending-recipient non-disclosure
 * withholds until acceptance. */
export interface PendingTransferOffer {
  transferId: string;
  ticketId: string;
  occurrenceId: string;
  seatLabel: string | null;
  queueNumber: string | null;
  medium: string | null;
}

/** The persistence row shape mapTicketTransferRow expects, declared locally
 * matching the convention in domain/eventCatalog.ts's RawEventRow. */
export interface RawTicketTransferRow {
  id: string;
  ticket_id: string;
  sender_id: string;
  recipient_id: string;
  status: string;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RawPendingTransferOfferRow {
  transfer_id: string;
  ticket_id: string;
  occurrence_id: string;
  seat_label: string | null;
  queue_number: string | null;
  medium: string | null;
}

export function mapTicketTransferRow(row: RawTicketTransferRow): TicketTransfer {
  if (!isTransferStatus(row.status)) {
    throw new Error(`ticket transfer ${row.id} has an unrecognized status: ${row.status}`);
  }
  return {
    id: row.id,
    ticketId: row.ticket_id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    status: row.status,
    respondedAt: row.responded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPendingTransferOfferRow(row: RawPendingTransferOfferRow): PendingTransferOffer {
  return {
    transferId: row.transfer_id,
    ticketId: row.ticket_id,
    occurrenceId: row.occurrence_id,
    seatLabel: row.seat_label,
    queueNumber: row.queue_number,
    medium: row.medium,
  };
}

/** Deterministic ordering: created_at ascending, id as a stable tie-breaker
 * - see domain/ordering.ts. */
export function compareTicketTransfersByCreatedAt(a: TicketTransfer, b: TicketTransfer): number {
  return compareByFieldThenId(a, b, (transfer) => transfer.createdAt);
}

export function sortTicketTransfers(transfers: readonly TicketTransfer[]): TicketTransfer[] {
  return sortByFieldThenId(transfers, (transfer) => transfer.createdAt);
}
