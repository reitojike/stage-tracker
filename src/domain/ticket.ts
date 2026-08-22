// Ticket domain model (Issue #33), over the persistence/RLS baseline Issue
// #32 established (supabase/migrations/20260822093100_create_tickets.sql,
// as hardened by Issue #50's
// 20260822130000_close_pending_recipient_source_acquirer_tickets_select_gap.sql).
//
// Product semantics (see .ai-dev-foundation/product-rules.md, "Ticket"):
// - A ticket is the result of a *secured* acquisition; one acquisition may
//   produce several tickets. Separate concept from TicketAcquisition (see
//   domain/ticketAcquisition.ts).
// - seat/queue/medium live on the ticket, all nullable.
// - Assignment ("who is expected to use this ticket") is NOT ownership, and
//   is mutually exclusive between a registered user and a named external
//   companion (or neither - unassigned).
// - owner_id is the *current* owner, moved only by accept_ticket_transfer
//   (see domain/ticketTransfer.ts) - never directly writable here.
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs).

import { compareByFieldThenId, sortByFieldThenId } from './ordering.ts';

export type TicketMedium = 'paper' | 'electronic';

const TICKET_MEDIA: ReadonlySet<string> = new Set<TicketMedium>(['paper', 'electronic']);

function isTicketMedium(value: string): value is TicketMedium {
  return TICKET_MEDIA.has(value);
}

/** Mirrors tickets_single_assignee: at most one of a registered user or a
 * named external companion, never both. */
export type TicketAssignment =
  | { kind: 'unassigned' }
  | { kind: 'registered-user'; userId: string }
  | { kind: 'external-companion'; name: string };

export interface Ticket {
  id: string;
  acquisitionId: string;
  ownerId: string;
  seatLabel: string | null;
  queueNumber: string | null;
  medium: TicketMedium | null;
  assignment: TicketAssignment;
  createdAt: string;
  updatedAt: string;
}

export interface TicketWriteInput {
  seatLabel?: string | null;
  queueNumber?: string | null;
  medium?: TicketMedium | null;
  assignment?: TicketAssignment;
}

/** The persistence row shape mapTicketRow expects, declared locally
 * matching the convention in domain/eventCatalog.ts's RawEventRow. */
export interface RawTicketRow {
  id: string;
  acquisition_id: string;
  owner_id: string;
  seat_label: string | null;
  queue_number: string | null;
  medium: string | null;
  assigned_to_user_id: string | null;
  assignee_external_name: string | null;
  created_at: string;
  updated_at: string;
}

function mapAssignment(row: RawTicketRow): TicketAssignment {
  if (row.assigned_to_user_id !== null) {
    return { kind: 'registered-user', userId: row.assigned_to_user_id };
  }
  if (row.assignee_external_name !== null) {
    return { kind: 'external-companion', name: row.assignee_external_name };
  }
  return { kind: 'unassigned' };
}

export function mapTicketRow(row: RawTicketRow): Ticket {
  if (row.medium !== null && !isTicketMedium(row.medium)) {
    throw new Error(`ticket ${row.id} has an unrecognized medium: ${row.medium}`);
  }
  return {
    id: row.id,
    acquisitionId: row.acquisition_id,
    ownerId: row.owner_id,
    seatLabel: row.seat_label,
    queueNumber: row.queue_number,
    medium: row.medium,
    assignment: mapAssignment(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Converts a TicketAssignment into the two persistence columns it maps to -
 * always both, so "unassigned" clears any previously-set value rather than
 * leaving a stale one behind when only one column is sent. */
export function assignmentToColumns(assignment: TicketAssignment): {
  assigned_to_user_id: string | null;
  assignee_external_name: string | null;
} {
  if (assignment.kind === 'registered-user') {
    return { assigned_to_user_id: assignment.userId, assignee_external_name: null };
  }
  if (assignment.kind === 'external-companion') {
    return { assigned_to_user_id: null, assignee_external_name: assignment.name };
  }
  return { assigned_to_user_id: null, assignee_external_name: null };
}

/** Deterministic ordering: created_at ascending, id as a stable tie-breaker
 * - see domain/ordering.ts. */
export function compareTicketsByCreatedAt(a: Ticket, b: Ticket): number {
  return compareByFieldThenId(a, b, (ticket) => ticket.createdAt);
}

export function sortTickets(tickets: readonly Ticket[]): Ticket[] {
  return sortByFieldThenId(tickets, (ticket) => ticket.createdAt);
}
