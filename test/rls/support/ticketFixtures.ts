import { createAdminClient, type TestActor } from './testActors.ts';
import { createEventWithOccurrence } from './eventFixtures.ts';

// Shared fixture helpers for the ticket acquisition / ticket / transfer
// slice (Issue #32). Everything here that an end user could legitimately do
// goes through that user's own anon-key client, so the RLS/grant boundary is
// still the thing being exercised; the one place that deliberately uses the
// service_role path is documented at seedPendingTransfer below.

export type AcquisitionStatus = 'pending' | 'secured' | 'unsuccessful';

/**
 * An occurrence owned by `catalogOwner` that other actors can acquire
 * tickets for. Acquisitions are occurrence-linked, and the catalog is shared
 * across authenticated users, so the acquirer does not have to be the event
 * owner.
 */
export async function createOccurrence(catalogOwner: TestActor) {
  const { event, occurrence } = await createEventWithOccurrence(catalogOwner);
  return { event, occurrence };
}

export async function createAcquisition(
  actor: TestActor,
  occurrenceId: string,
  overrides: { status?: AcquisitionStatus; memo?: string } = {},
) {
  const { data, error } = await actor.client
    .from('ticket_acquisitions')
    .insert({
      owner_id: actor.user.id,
      occurrence_id: occurrenceId,
      ...(overrides.status === undefined ? {} : { status: overrides.status }),
      ...(overrides.memo === undefined ? {} : { memo: overrides.memo }),
    })
    .select()
    .single();
  if (error) {
    throw new Error(`fixture acquisition insert failed: ${error.message}`);
  }
  return data;
}

export interface TicketOverrides {
  seatLabel?: string;
  queueNumber?: string;
  medium?: 'paper' | 'electronic';
  assignedToUserId?: string;
  assigneeExternalName?: string;
}

export async function createTicket(
  actor: TestActor,
  acquisitionId: string,
  overrides: TicketOverrides = {},
) {
  const { data, error } = await actor.client
    .from('tickets')
    .insert({
      acquisition_id: acquisitionId,
      owner_id: actor.user.id,
      ...(overrides.seatLabel === undefined ? {} : { seat_label: overrides.seatLabel }),
      ...(overrides.queueNumber === undefined ? {} : { queue_number: overrides.queueNumber }),
      ...(overrides.medium === undefined ? {} : { medium: overrides.medium }),
      ...(overrides.assignedToUserId === undefined
        ? {}
        : { assigned_to_user_id: overrides.assignedToUserId }),
      ...(overrides.assigneeExternalName === undefined
        ? {}
        : { assignee_external_name: overrides.assigneeExternalName }),
    })
    .select()
    .single();
  if (error) {
    throw new Error(`fixture ticket insert failed: ${error.message}`);
  }
  return data;
}

/**
 * A secured acquisition plus one ticket under it, owned by `actor`, for an
 * occurrence on `catalogOwner`'s event.
 */
export async function createSecuredTicket(
  actor: TestActor,
  catalogOwner: TestActor,
  overrides: TicketOverrides = {},
) {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(actor, occurrence.id, { status: 'secured' });
  const ticket = await createTicket(actor, acquisition.id, overrides);
  return { occurrence, acquisition, ticket };
}

/**
 * Inserts a pending transfer through the service_role path instead of
 * request_ticket_transfer.
 *
 * This is a deliberate, temporary fixture seam. request_ticket_transfer
 * currently fails closed on recipient eligibility, because that predicate
 * needs the invitation persistence Issue #30 establishes and #30 is not on
 * main yet (see
 * supabase/migrations/20260822093300_create_ticket_transfer_eligibility.sql).
 * Seeding the pending row directly is what lets the acceptance /
 * cancellation / ownership-transition rules - the genuinely dangerous part
 * of this slice - be tested now rather than after #30 lands.
 *
 * It seeds *state*, never behavior: every accept/cancel assertion below
 * still runs through the real authenticated RPC path. When #30 merges and
 * the eligibility body is wired up, this helper is replaced by a
 * request_ticket_transfer call and the eligibility positive/negative tests
 * land with it.
 */
export async function seedPendingTransfer(ticketId: string, senderId: string, recipientId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('ticket_transfers')
    .insert({ ticket_id: ticketId, sender_id: senderId, recipient_id: recipientId })
    .select()
    .single();
  if (error) {
    throw new Error(`fixture pending transfer insert failed: ${error.message}`);
  }
  return data;
}

/**
 * Reads a ticket through the service_role path, for assertions about rows
 * the acting user is (correctly) not allowed to read - e.g. checking that a
 * rejected update really left the row alone.
 */
export async function readTicketAsAdmin(ticketId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from('tickets').select().eq('id', ticketId).single();
  if (error) {
    throw new Error(`fixture ticket read failed: ${error.message}`);
  }
  return data;
}

export async function readTransferAsAdmin(transferId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('ticket_transfers')
    .select()
    .eq('id', transferId)
    .single();
  if (error) {
    throw new Error(`fixture transfer read failed: ${error.message}`);
  }
  return data;
}

export async function readAcquisitionAsAdmin(acquisitionId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('ticket_acquisitions')
    .select()
    .eq('id', acquisitionId)
    .single();
  if (error) {
    throw new Error(`fixture acquisition read failed: ${error.message}`);
  }
  return data;
}
