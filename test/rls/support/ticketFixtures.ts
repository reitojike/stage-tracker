import { createAdminClient, type TestActor } from './testActors.ts';
import { createEventWithOccurrence } from './eventFixtures.ts';
import {
  inviteToOccurrenceOrThrow,
  readOwnParticipation,
  setParticipation,
} from './participationFixtures.ts';

// Shared fixture helpers for the ticket acquisition / ticket / transfer
// slice (Issue #32). Everything here that an end user could legitimately do
// goes through that user's own anon-key client, so the RLS/grant boundary is
// still the thing being exercised. service_role appears only in the
// read*AsAdmin helpers, which exist to inspect rows the acting user is
// (correctly) not allowed to read.

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
 * Makes `recipient` an eligible transfer target for `occurrenceId` the only
 * way product-rules.md allows: by being invited to that occurrence. The
 * inviter has to be `attending` it first (Issue #30), so this establishes
 * that too.
 *
 * Eligibility deliberately has no test-only backdoor - the same
 * invite_to_occurrence path a real inviter uses is what these fixtures use,
 * so a change to #30's invite rules surfaces here rather than being masked.
 */
export async function makeTransferEligible(
  inviter: TestActor,
  occurrenceId: string,
  recipient: TestActor,
): Promise<void> {
  await ensureAttending(inviter, occurrenceId);
  await inviteToOccurrenceOrThrow(inviter, occurrenceId, recipient.user.id);
}

/**
 * Brings an actor to `attending` for an occurrence whether or not they
 * already have a participation row. Participation is unique per (occurrence,
 * user), and an invitee handed a `considering` row by a previous invite is
 * exactly the actor a later fixture may need to promote - so a plain insert
 * would fail on the unique constraint rather than express the intent.
 *
 * Both branches run as the participant themselves, which is also the only
 * way `considering -> attending` is allowed to happen.
 */
async function ensureAttending(actor: TestActor, occurrenceId: string): Promise<void> {
  const existing = await readOwnParticipation(actor, occurrenceId);
  if (existing === null) {
    await setParticipation(actor, occurrenceId, 'attending');
    return;
  }
  if (existing.status === 'attending') {
    return;
  }

  const { error } = await actor.client
    .from('occurrence_participations')
    .update({ status: 'attending' })
    .eq('id', existing.id);
  if (error) {
    throw new Error(`fixture participation promotion failed: ${error.message}`);
  }
}

/**
 * Starts a transfer through the real authenticated RPC path and returns the
 * created row. Errors are surfaced rather than swallowed so a fixture that
 * stopped working cannot quietly turn a positive test into a vacuous one.
 */
export async function requestTransfer(sender: TestActor, ticketId: string, recipientId: string) {
  const { data, error } = await sender.client.rpc('request_ticket_transfer', {
    p_ticket_id: ticketId,
    p_recipient_id: recipientId,
  });
  if (error) {
    throw new Error(`fixture request_ticket_transfer failed: ${error.message}`);
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
