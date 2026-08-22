// Ticket acquisition domain model (Issue #33), over the persistence/RLS
// baseline Issue #32 established
// (supabase/migrations/20260822093000_create_ticket_acquisitions.sql).
//
// Product semantics (see .ai-dev-foundation/product-rules.md, "Ticket
// acquisition / Ticket"):
// - user-owned, occurrence-linked; the same user may hold several
//   acquisition attempts for the same occurrence.
// - MVP status vocabulary is exactly pending / secured / unsuccessful.
// - Independent of participation: nothing here reads or implies attendance.
// - A separate concept from Ticket itself (see domain/ticket.ts) - an
//   acquisition never carries seat/queue/medium/assignment.
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs).

import { compareByFieldThenId, sortByFieldThenId } from './ordering.ts';

export type AcquisitionStatus = 'pending' | 'secured' | 'unsuccessful';

const ACQUISITION_STATUSES: ReadonlySet<string> = new Set<AcquisitionStatus>([
  'pending',
  'secured',
  'unsuccessful',
]);

function isAcquisitionStatus(value: string): value is AcquisitionStatus {
  return ACQUISITION_STATUSES.has(value);
}

export interface TicketAcquisition {
  id: string;
  ownerId: string;
  occurrenceId: string;
  status: AcquisitionStatus;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketAcquisitionCreateInput {
  status?: AcquisitionStatus;
  memo?: string | null;
}

export interface TicketAcquisitionUpdateInput {
  status?: AcquisitionStatus;
  memo?: string | null;
}

/** The persistence row shape mapTicketAcquisitionRow expects, declared
 * locally matching the convention in domain/eventCatalog.ts's RawEventRow. */
export interface RawTicketAcquisitionRow {
  id: string;
  owner_id: string;
  occurrence_id: string;
  status: string;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export function mapTicketAcquisitionRow(row: RawTicketAcquisitionRow): TicketAcquisition {
  if (!isAcquisitionStatus(row.status)) {
    throw new Error(`ticket acquisition ${row.id} has an unrecognized status: ${row.status}`);
  }
  return {
    id: row.id,
    ownerId: row.owner_id,
    occurrenceId: row.occurrence_id,
    status: row.status,
    memo: row.memo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Deterministic ordering: created_at ascending, id as a stable tie-breaker
 * - see domain/ordering.ts. */
export function compareTicketAcquisitionsByCreatedAt(
  a: TicketAcquisition,
  b: TicketAcquisition,
): number {
  return compareByFieldThenId(a, b, (acquisition) => acquisition.createdAt);
}

export function sortTicketAcquisitions(
  acquisitions: readonly TicketAcquisition[],
): TicketAcquisition[] {
  return sortByFieldThenId(acquisitions, (acquisition) => acquisition.createdAt);
}
