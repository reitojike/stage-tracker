import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import {
  assignmentToColumns,
  mapTicketRow,
  sortTickets,
  type Ticket,
  type TicketWriteInput,
} from '../../domain/ticket.ts';
import { classifyPostgrestError, type PlanningResult } from '../../domain/planningError.ts';
import { fetchAllRows } from './pagedFetch.ts';
import { requireAuthenticatedUserId } from './planningAuth.ts';

// Typed feature-level read/write boundary over public.tickets (Issue #33).
// RLS (tickets_select_owner_or_source_acquirer, as hardened by Issue #50's
// migration; tickets_insert_under_own_secured_acquisition; tickets_update_own
// - see supabase/migrations/20260822093100_create_tickets.sql and
// 20260822130000_close_pending_recipient_source_acquirer_tickets_select_gap.sql)
// is what actually enforces who may read/write what. This module adds no
// extra filtering on top of it: the pending-recipient non-disclosure that
// Issue #50 closed is already the database's own read boundary, so
// listVisibleTickets below simply consumes it as-is.

export type TicketQueryClient = SupabaseClient<Database>;

const NOT_VISIBLE_FOR_UPDATE = 'update-affected-no-rows';

/**
 * tickets_select_owner_or_source_acquirer is wider than tickets_update_own:
 * the source acquirer keeps read access (provenance) after a transfer moves
 * ownership away, but only the *current* owner can update. A zero-rows
 * update result is therefore classified `permission-denied`, mirroring
 * domain/eventCatalogWrite.ts's deniedUpdate - the same "reads open wider
 * than writes" shape.
 */
function deniedTicketUpdate(): PlanningResult<never> {
  return {
    ok: false,
    error: {
      kind: 'permission-denied',
      message:
        'ticket was not updated: the row is not visible to this caller for update, or is no longer owned by them',
      code: NOT_VISIBLE_FOR_UPDATE,
    },
  };
}

/** Every ticket visible to the caller: current owner, or source acquirer of
 * a ticket not presently pending transfer *to* the caller (Issue #50).
 * Paginated via fetchAllRows so a caller with more rows than PostgREST's
 * api.max_rows never silently loses the rest (see pagedFetch.ts). */
export async function listVisibleTickets(
  client: TicketQueryClient,
): Promise<PlanningResult<Ticket[]>> {
  const result = await fetchAllRows((from, to) =>
    client
      .from('tickets')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (!result.ok) {
    return result;
  }
  return { ok: true, data: sortTickets(result.data.map(mapTicketRow)) };
}

/** Paginated via fetchAllRows - see listVisibleTickets above. */
export async function listTicketsForAcquisition(
  client: TicketQueryClient,
  acquisitionId: string,
): Promise<PlanningResult<Ticket[]>> {
  const result = await fetchAllRows((from, to) =>
    client
      .from('tickets')
      .select('*', { count: 'exact' })
      .eq('acquisition_id', acquisitionId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (!result.ok) {
    return result;
  }
  return { ok: true, data: sortTickets(result.data.map(mapTicketRow)) };
}

/** Creates a ticket under an acquisition the caller owns and has secured -
 * tickets_insert_under_own_secured_acquisition enforces both, so an attempt
 * against a non-owned or non-secured acquisition surfaces as a Postgrest
 * error (an INSERT denial, unlike an UPDATE's silent zero rows). */
export async function createTicket(
  client: TicketQueryClient,
  acquisitionId: string,
  input: TicketWriteInput = {},
): Promise<PlanningResult<Ticket>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const assignment = assignmentToColumns(input.assignment ?? { kind: 'unassigned' });
  const { data, error } = await client
    .from('tickets')
    .insert({
      acquisition_id: acquisitionId,
      owner_id: callerId.data,
      seat_label: input.seatLabel ?? null,
      queue_number: input.queueNumber ?? null,
      medium: input.medium ?? null,
      ...assignment,
    })
    .select()
    .single();
  if (error !== null) {
    return { ok: false, error: classifyPostgrestError(error) };
  }
  return { ok: true, data: mapTicketRow(data) };
}

/**
 * Checks the caller's session first (requireAuthenticatedUserId), even
 * though this write needs no id from it, so an unauthenticated caller gets
 * `unauthenticated` here too - the same as createTicket - rather than
 * whatever a client with no session happens to get from RLS (typically
 * `permission-denied` from the withheld anon grant).
 */
export async function updateTicket(
  client: TicketQueryClient,
  ticketId: string,
  input: TicketWriteInput,
): Promise<PlanningResult<Ticket>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const patch: Database['public']['Tables']['tickets']['Update'] = {
    ...(input.seatLabel !== undefined ? { seat_label: input.seatLabel } : {}),
    ...(input.queueNumber !== undefined ? { queue_number: input.queueNumber } : {}),
    ...(input.medium !== undefined ? { medium: input.medium } : {}),
    ...(input.assignment !== undefined ? assignmentToColumns(input.assignment) : {}),
  };

  const { data, error } = await client
    .from('tickets')
    .update(patch)
    .eq('id', ticketId)
    .select()
    .maybeSingle();
  if (error !== null) {
    return { ok: false, error: classifyPostgrestError(error) };
  }
  if (data === null) {
    return deniedTicketUpdate();
  }
  return { ok: true, data: mapTicketRow(data) };
}
