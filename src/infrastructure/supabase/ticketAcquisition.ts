import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import {
  mapTicketAcquisitionRow,
  sortTicketAcquisitions,
  type TicketAcquisition,
  type TicketAcquisitionCreateInput,
  type TicketAcquisitionUpdateInput,
} from '../../domain/ticketAcquisition.ts';
import { classifyPostgrestError, type PlanningResult } from '../../domain/planningError.ts';
import { requireAuthenticatedUserId } from './planningAuth.ts';

// Typed feature-level read/write boundary over public.ticket_acquisitions
// (Issue #33). RLS (ticket_acquisitions_select_own / _insert_own /
// _update_own - see supabase/migrations/20260822093000_create_ticket_
// acquisitions.sql) restricts every one of these to the caller's own rows:
// unlike events or personal schedule entries, there is no wider read policy
// here at all, so a caller can never be shown an acquisition it then fails
// to update - see updateAcquisition below for what that implies for
// zero-rows classification.

export type TicketAcquisitionQueryClient = SupabaseClient<Database>;

export async function listMyAcquisitions(
  client: TicketAcquisitionQueryClient,
  occurrenceId?: string,
): Promise<PlanningResult<TicketAcquisition[]>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  let query = client.from('ticket_acquisitions').select().eq('owner_id', callerId.data);
  if (occurrenceId !== undefined) {
    query = query.eq('occurrence_id', occurrenceId);
  }
  const { data, error } = await query;
  if (error !== null) {
    return { ok: false, error: classifyPostgrestError(error) };
  }
  return { ok: true, data: sortTicketAcquisitions(data.map(mapTicketAcquisitionRow)) };
}

export async function createAcquisition(
  client: TicketAcquisitionQueryClient,
  occurrenceId: string,
  input: TicketAcquisitionCreateInput = {},
): Promise<PlanningResult<TicketAcquisition>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const row: Database['public']['Tables']['ticket_acquisitions']['Insert'] = {
    owner_id: callerId.data,
    occurrence_id: occurrenceId,
  };
  if (input.status !== undefined) {
    row.status = input.status;
  }
  if (input.memo !== undefined) {
    row.memo = input.memo;
  }

  const { data, error } = await client.from('ticket_acquisitions').insert(row).select().single();
  if (error !== null) {
    return { ok: false, error: classifyPostgrestError(error) };
  }
  return { ok: true, data: mapTicketAcquisitionRow(data) };
}

/**
 * Updates status and/or memo. ticket_acquisitions_select_own and
 * _update_own share the exact same `owner_id = auth.uid()` condition, so -
 * unlike domain/eventCatalogWrite.ts's events, or personalSchedule.ts's
 * entries - there is no "visible but not writable" gap for this table. A
 * zero-rows result therefore means no such acquisition exists for this
 * caller (whether it never did, or another request already changed the
 * predicate this call matched on), which `not-found` describes more
 * honestly than `permission-denied` would.
 */
export async function updateAcquisition(
  client: TicketAcquisitionQueryClient,
  acquisitionId: string,
  input: TicketAcquisitionUpdateInput,
): Promise<PlanningResult<TicketAcquisition>> {
  const patch: Database['public']['Tables']['ticket_acquisitions']['Update'] = {};
  if (input.status !== undefined) {
    patch.status = input.status;
  }
  if (input.memo !== undefined) {
    patch.memo = input.memo;
  }

  const { data, error } = await client
    .from('ticket_acquisitions')
    .update(patch)
    .eq('id', acquisitionId)
    .select()
    .maybeSingle();
  if (error !== null) {
    return { ok: false, error: classifyPostgrestError(error) };
  }
  if (data === null) {
    return {
      ok: false,
      error: {
        kind: 'not-found',
        message: 'ticket acquisition was not found for this caller',
        code: 'update-affected-no-rows',
      },
    };
  }
  return { ok: true, data: mapTicketAcquisitionRow(data) };
}
