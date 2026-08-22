import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import {
  mapPendingTransferOfferRow,
  mapTicketTransferRow,
  sortTicketTransfers,
  type PendingTransferOffer,
  type TicketTransfer,
} from '../../domain/ticketTransfer.ts';
import {
  classifyPostgrestError,
  classifyRpcError,
  type PlanningResult,
  type RpcErrorRule,
} from '../../domain/planningError.ts';
import { fetchAllRows } from './pagedFetch.ts';
import { requireAuthenticatedUserId } from './planningAuth.ts';

// Typed feature-level read/write boundary over public.ticket_transfers
// (Issue #33). request_ticket_transfer / accept_ticket_transfer /
// cancel_ticket_transfer are the *only* supported write paths (the table
// carries no INSERT/UPDATE/DELETE grant at all - see supabase/migrations/
// 20260822093200_create_ticket_transfers.sql), so every write here goes
// through those RPCs rather than a table mutation. None of the three ever
// touches public.occurrence_participations - that is the invariant Issue
// #33's regression test (test/rls/typedBoundaryTransfer.test.ts) pins
// through this exact boundary.

export type TicketTransferQueryClient = SupabaseClient<Database>;

export const REQUEST_ERROR_RULES: readonly RpcErrorRule[] = [
  { test: (m) => m.includes('authentication required'), kind: 'unauthenticated' },
  { test: (m) => m.includes('ticket not found'), kind: 'not-found' },
  {
    test: (m) => m.includes('only the current ticket owner can start a transfer'),
    kind: 'permission-denied',
  },
  {
    test: (m) => m.includes('a ticket cannot be transferred to its current owner'),
    kind: 'validation',
  },
  { test: (m) => m.includes('transfer recipient is not a registered user'), kind: 'validation' },
  {
    test: (m) => m.includes('transfer recipient is not eligible for this occurrence'),
    kind: 'validation',
  },
  { test: (m) => m.includes('this ticket already has a pending transfer'), kind: 'validation' },
];

/**
 * Checks the caller's session first (requireAuthenticatedUserId): EXECUTE
 * on this RPC is revoked from anon, so an anon caller would otherwise reach
 * the database and get a generic 42501 (`permission-denied` via
 * classifyRpcError's fallback) instead of the `unauthenticated` a missing
 * session should report - see invitation.ts's inviteToOccurrence for the
 * same reasoning.
 */
export async function requestTransfer(
  client: TicketTransferQueryClient,
  ticketId: string,
  recipientId: string,
): Promise<PlanningResult<TicketTransfer>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const { data, error } = await client.rpc('request_ticket_transfer', {
    p_ticket_id: ticketId,
    p_recipient_id: recipientId,
  });
  if (error !== null) {
    return { ok: false, error: classifyRpcError(error, REQUEST_ERROR_RULES) };
  }
  return { ok: true, data: mapTicketTransferRow(data) };
}

export const ACCEPT_ERROR_RULES: readonly RpcErrorRule[] = [
  { test: (m) => m.includes('authentication required'), kind: 'unauthenticated' },
  { test: (m) => m.includes('not found'), kind: 'not-found' },
  {
    test: (m) => m.includes('only the transfer recipient can accept this transfer'),
    kind: 'permission-denied',
  },
  { test: (m) => m.includes('transfer is no longer pending'), kind: 'validation' },
  // "transfer sender no longer owns this ticket" is documented in the RPC as
  // an invariant check that should be unreachable given the partial unique
  // index on pending transfers, not a normal user-facing outcome - so it is
  // classified `failure` (unexpected), not `validation`.
  { test: (m) => m.includes('transfer sender no longer owns this ticket'), kind: 'failure' },
];

/** Checks the caller's session first - see requestTransfer above for why. */
export async function acceptTransfer(
  client: TicketTransferQueryClient,
  transferId: string,
): Promise<PlanningResult<TicketTransfer>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const { data, error } = await client.rpc('accept_ticket_transfer', {
    p_transfer_id: transferId,
  });
  if (error !== null) {
    return { ok: false, error: classifyRpcError(error, ACCEPT_ERROR_RULES) };
  }
  return { ok: true, data: mapTicketTransferRow(data) };
}

export const CANCEL_ERROR_RULES: readonly RpcErrorRule[] = [
  { test: (m) => m.includes('authentication required'), kind: 'unauthenticated' },
  { test: (m) => m.includes('transfer not found'), kind: 'not-found' },
  {
    test: (m) => m.includes('only the transfer sender can cancel this transfer'),
    kind: 'permission-denied',
  },
  { test: (m) => m.includes('transfer is no longer pending'), kind: 'validation' },
];

/** Checks the caller's session first - see requestTransfer above for why. */
export async function cancelTransfer(
  client: TicketTransferQueryClient,
  transferId: string,
): Promise<PlanningResult<TicketTransfer>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const { data, error } = await client.rpc('cancel_ticket_transfer', {
    p_transfer_id: transferId,
  });
  if (error !== null) {
    return { ok: false, error: classifyRpcError(error, CANCEL_ERROR_RULES) };
  }
  return { ok: true, data: mapTicketTransferRow(data) };
}

/**
 * The bounded, assignment-free decision surface for a pending offer
 * addressed to the caller (pending_ticket_transfer_offer). Returns
 * `data: null` (not an error) whenever the RPC's own predicate excludes the
 * caller - not the recipient, not pending, or the transfer id does not
 * exist - rather than turning that into a permission-denied error: the
 * function is deliberately opaque about *which* of those is true, and
 * manufacturing a distinct error here would leak back exactly what it
 * withholds.
 */
export async function getPendingTransferOffer(
  client: TicketTransferQueryClient,
  transferId: string,
): Promise<PlanningResult<PendingTransferOffer | null>> {
  const { data, error } = await client.rpc('pending_ticket_transfer_offer', {
    p_transfer_id: transferId,
  });
  if (error !== null) {
    return { ok: false, error: classifyPostgrestError(error) };
  }
  const [row] = data;
  return { ok: true, data: row === undefined ? null : mapPendingTransferOfferRow(row) };
}

/** Every transfer visible to the caller: as sender, as recipient, or as the
 * source acquirer of the ticket it moved (ticket_transfers_select_involved,
 * via can_view_ticket_provenance). Needs no caller id and applies no
 * client-side filter of its own: RLS's three-way OR (sender, recipient, or
 * provenance-visible) is the entire authorization, and re-deriving any part
 * of it here (e.g. filtering to sender/recipient only) would silently
 * narrow this below what RLS actually grants - see listVisibleTickets in
 * ./ticket.ts for the same "trust RLS, add nothing on top" convention.
 * Paginated via fetchAllRows so a caller with more rows than PostgREST's
 * api.max_rows never silently loses the rest (see pagedFetch.ts). */
export async function listVisibleTransfers(
  client: TicketTransferQueryClient,
): Promise<PlanningResult<TicketTransfer[]>> {
  const result = await fetchAllRows((from, to) =>
    client
      .from('ticket_transfers')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (!result.ok) {
    return result;
  }
  return { ok: true, data: sortTicketTransfers(result.data.map(mapTicketTransferRow)) };
}

/** Paginated via fetchAllRows - see listVisibleTransfers above. */
export async function listTransfersForTicket(
  client: TicketTransferQueryClient,
  ticketId: string,
): Promise<PlanningResult<TicketTransfer[]>> {
  const result = await fetchAllRows((from, to) =>
    client
      .from('ticket_transfers')
      .select('*', { count: 'exact' })
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (!result.ok) {
    return result;
  }
  return { ok: true, data: sortTicketTransfers(result.data.map(mapTicketTransferRow)) };
}
