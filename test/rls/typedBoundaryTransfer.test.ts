import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  acceptTransfer,
  cancelTransfer,
  getPendingTransferOffer,
  listTransfersForTicket,
  listVisibleTransfers,
  requestTransfer,
} from '../../src/infrastructure/supabase/ticketTransfer.ts';
import { createAcquisition } from '../../src/infrastructure/supabase/ticketAcquisition.ts';
import {
  createTicket,
  listVisibleTickets,
  updateTicket,
} from '../../src/infrastructure/supabase/ticket.ts';
import { setParticipation as setParticipationTyped } from '../../src/infrastructure/supabase/participation.ts';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActorsSequentially,
  type TestActor,
} from './support/testActors.ts';
import { createEventWithOccurrence } from './support/eventFixtures.ts';
import { makeTransferEligible, readTransferAsAdmin } from './support/ticketFixtures.ts';
import { readOwnParticipation } from './support/participationFixtures.ts';

// Real local Supabase/RLS tests for the ticket transfer typed boundary
// (Issue #33), over public.ticket_transfers (Issue #32, hardened by Issue
// #50). Unlike test/rls/ticketTransfers.test.ts, which exercises the raw
// request_ticket_transfer/accept_ticket_transfer/cancel_ticket_transfer RPCs
// directly, this file exercises src/infrastructure/supabase/
// ticketTransfer.ts, and additionally pins Issue #33's required regression:
// that request/accept/cancel, called through this exact typed boundary,
// never mutate public.occurrence_participations. Every participation
// assertion below reads through participationFixtures.readOwnParticipation -
// a table read independent of the typed functions under test - not by
// re-reading through the same boundary that a regression could also affect
// identically.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let catalogOwner: TestActor;
let acquirer: TestActor;
let recipient: TestActor;
let outsider: TestActor;
let thirdParty: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  catalogOwner = await createTestActor('rls-typed-xfer-catalog', PASSWORD, {
    designatedCatalogCreator: true,
  });
  createdActors.push(catalogOwner);
  acquirer = await createTestActor('rls-typed-xfer-acquirer', PASSWORD);
  createdActors.push(acquirer);
  recipient = await createTestActor('rls-typed-xfer-recipient', PASSWORD);
  createdActors.push(recipient);
  outsider = await createTestActor('rls-typed-xfer-outsider', PASSWORD);
  createdActors.push(outsider);
  thirdParty = await createTestActor('rls-typed-xfer-third', PASSWORD);
  createdActors.push(thirdParty);
});

after(async () => {
  await deleteTestActorsSequentially(createdActors);
});

/** Builds a secured ticket (through the typed acquisition/ticket boundary,
 * not raw fixtures) and makes `recipient` an eligible transfer target for
 * its occurrence. Returns the occurrence and ticket ids requestTransfer
 * needs. */
async function offerableTicket(): Promise<{ occurrenceId: string; ticketId: string }> {
  const { occurrence } = await createEventWithOccurrence(catalogOwner);
  const acquisition = await createAcquisition(acquirer.client, occurrence.id, {
    status: 'secured',
  });
  if (!acquisition.ok) {
    throw new Error(`fixture acquisition creation failed: ${acquisition.error.message}`);
  }
  const ticket = await createTicket(acquirer.client, acquisition.data.id);
  if (!ticket.ok) {
    throw new Error(`fixture ticket creation failed: ${ticket.error.message}`);
  }
  await makeTransferEligible(acquirer, occurrence.id, recipient);
  return { occurrenceId: occurrence.id, ticketId: ticket.data.id };
}

// --- Happy path ---

void test('requestTransfer creates a pending transfer for an eligible recipient', async () => {
  const { ticketId } = await offerableTicket();
  const result = await requestTransfer(acquirer.client, ticketId, recipient.user.id);
  assert.equal(result.ok, true);
  assert.equal(result.data.status, 'pending');
  assert.equal(result.data.senderId, acquirer.user.id);
  assert.equal(result.data.recipientId, recipient.user.id);
});

void test('acceptTransfer moves ownership to the recipient and clears assignment', async () => {
  const { ticketId } = await offerableTicket();
  await updateTicket(acquirer.client, ticketId, {
    assignment: { kind: 'external-companion', name: 'previous owner’s companion' },
  });
  const requested = await requestTransfer(acquirer.client, ticketId, recipient.user.id);
  assert.equal(requested.ok, true);

  const accepted = await acceptTransfer(recipient.client, requested.data.id);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.data.status, 'accepted');

  const recipientView = await listVisibleTickets(recipient.client);
  assert.equal(recipientView.ok, true);
  const ownedTicket = recipientView.data.find((t) => t.id === ticketId);
  assert.ok(ownedTicket);
  assert.equal(ownedTicket.ownerId, recipient.user.id);
  assert.deepEqual(ownedTicket.assignment, { kind: 'unassigned' });
});

void test('cancelTransfer lets the sender withdraw a pending offer', async () => {
  const { ticketId } = await offerableTicket();
  const requested = await requestTransfer(acquirer.client, ticketId, recipient.user.id);
  assert.equal(requested.ok, true);

  const cancelled = await cancelTransfer(acquirer.client, requested.data.id);
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.data.status, 'cancelled');
});

void test('getPendingTransferOffer gives the recipient the bounded, assignment-free decision surface', async () => {
  const { occurrenceId, ticketId } = await offerableTicket();
  await updateTicket(acquirer.client, ticketId, { seatLabel: 'A1' });
  const requested = await requestTransfer(acquirer.client, ticketId, recipient.user.id);
  assert.equal(requested.ok, true);

  const offer = await getPendingTransferOffer(recipient.client, requested.data.id);
  assert.equal(offer.ok, true);
  assert.ok(offer.data);
  assert.equal(offer.data.occurrenceId, occurrenceId);
  assert.equal(offer.data.seatLabel, 'A1');
  assert.deepEqual(Object.keys(offer.data).sort(), [
    'medium',
    'occurrenceId',
    'queueNumber',
    'seatLabel',
    'ticketId',
    'transferId',
  ]);
});

void test('getPendingTransferOffer returns null (not an error) for a non-recipient', async () => {
  const { ticketId } = await offerableTicket();
  const requested = await requestTransfer(acquirer.client, ticketId, recipient.user.id);
  assert.equal(requested.ok, true);

  const asOutsider = await getPendingTransferOffer(outsider.client, requested.data.id);
  assert.deepEqual(asOutsider, { ok: true, data: null });
});

void test('listVisibleTransfers shows both parties a pending transfer, and hides it from an outsider', async () => {
  const { ticketId } = await offerableTicket();
  const requested = await requestTransfer(acquirer.client, ticketId, recipient.user.id);
  assert.equal(requested.ok, true);

  const senderView = await listVisibleTransfers(acquirer.client);
  assert.equal(senderView.ok, true);
  assert.ok(senderView.data.some((t) => t.id === requested.data.id));

  const recipientView = await listVisibleTransfers(recipient.client);
  assert.equal(recipientView.ok, true);
  assert.ok(recipientView.data.some((t) => t.id === requested.data.id));

  const outsiderView = await listVisibleTransfers(outsider.client);
  assert.equal(outsiderView.ok, true);
  assert.ok(!outsiderView.data.some((t) => t.id === requested.data.id));
});

void test('listVisibleTransfers keeps a settled transfer visible to the original acquirer via source-acquirer provenance, even once neither sender nor recipient of a later transfer', async () => {
  const { occurrenceId, ticketId } = await offerableTicket();
  const firstTransfer = await requestTransfer(acquirer.client, ticketId, recipient.user.id);
  assert.equal(firstTransfer.ok, true);
  const accepted = await acceptTransfer(recipient.client, firstTransfer.data.id);
  assert.equal(accepted.ok, true);

  // A second transfer between recipient and thirdParty, in which the
  // original acquirer is neither sender nor recipient - only reachable via
  // ticket_transfers_select_involved's provenance branch
  // (can_view_ticket_provenance), not the sender/recipient branches.
  await makeTransferEligible(recipient, occurrenceId, thirdParty);
  const secondTransfer = await requestTransfer(recipient.client, ticketId, thirdParty.user.id);
  assert.equal(secondTransfer.ok, true);

  const acquirerView = await listVisibleTransfers(acquirer.client);
  assert.equal(acquirerView.ok, true);
  assert.ok(
    acquirerView.data.some((t) => t.id === secondTransfer.data.id),
    'the original acquirer must still see a transfer chain they are not a party to, via provenance',
  );
});

void test('listTransfersForTicket returns every transfer visible to the caller for that ticket', async () => {
  const { ticketId } = await offerableTicket();
  const requested = await requestTransfer(acquirer.client, ticketId, recipient.user.id);
  assert.equal(requested.ok, true);

  const forSender = await listTransfersForTicket(acquirer.client, ticketId);
  assert.equal(forSender.ok, true);
  assert.ok(forSender.data.some((t) => t.id === requested.data.id));

  const forOutsider = await listTransfersForTicket(outsider.client, ticketId);
  assert.equal(forOutsider.ok, true);
  assert.ok(!forOutsider.data.some((t) => t.id === requested.data.id));
});

// --- Error classification ---

void test('requestTransfer reports permission-denied when the caller does not own the ticket', async () => {
  const { ticketId } = await offerableTicket();
  const result = await requestTransfer(outsider.client, ticketId, recipient.user.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'permission-denied');
});

void test('requestTransfer reports validation for an ineligible recipient', async () => {
  const { ticketId } = await offerableTicket();
  const result = await requestTransfer(acquirer.client, ticketId, outsider.user.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'validation');
});

void test('requestTransfer reports validation when a pending transfer already exists', async () => {
  const { ticketId } = await offerableTicket();
  const first = await requestTransfer(acquirer.client, ticketId, recipient.user.id);
  assert.equal(first.ok, true);

  const second = await requestTransfer(acquirer.client, ticketId, recipient.user.id);
  assert.equal(second.ok, false);
  assert.equal(second.error.kind, 'validation');
});

void test('requestTransfer reports not-found for a nonexistent ticket', async () => {
  const result = await requestTransfer(
    acquirer.client,
    '00000000-0000-0000-0000-000000000000',
    recipient.user.id,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'not-found');
});

void test('acceptTransfer reports permission-denied for a non-recipient', async () => {
  const { ticketId } = await offerableTicket();
  const requested = await requestTransfer(acquirer.client, ticketId, recipient.user.id);
  assert.equal(requested.ok, true);

  const result = await acceptTransfer(outsider.client, requested.data.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'permission-denied');
});

void test('acceptTransfer reports validation for a transfer that is no longer pending', async () => {
  const { ticketId } = await offerableTicket();
  const requested = await requestTransfer(acquirer.client, ticketId, recipient.user.id);
  assert.equal(requested.ok, true);
  const accepted = await acceptTransfer(recipient.client, requested.data.id);
  assert.equal(accepted.ok, true);

  const result = await acceptTransfer(recipient.client, requested.data.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'validation');
});

void test('cancelTransfer reports permission-denied for a non-sender', async () => {
  const { ticketId } = await offerableTicket();
  const requested = await requestTransfer(acquirer.client, ticketId, recipient.user.id);
  assert.equal(requested.ok, true);

  const result = await cancelTransfer(recipient.client, requested.data.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'permission-denied');
});

void test('cancelTransfer reports not-found for a nonexistent transfer', async () => {
  const result = await cancelTransfer(acquirer.client, '00000000-0000-0000-0000-000000000000');
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'not-found');
});

void test('requestTransfer reports unauthenticated for a client with no session', async () => {
  const { ticketId } = await offerableTicket();
  const anonymous = createAnonymousClient();
  const result = await requestTransfer(anonymous, ticketId, recipient.user.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'unauthenticated');
});

void test('acceptTransfer reports unauthenticated for a client with no session', async () => {
  const { ticketId } = await offerableTicket();
  const requested = await requestTransfer(acquirer.client, ticketId, recipient.user.id);
  assert.equal(requested.ok, true);

  const anonymous = createAnonymousClient();
  const result = await acceptTransfer(anonymous, requested.data.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'unauthenticated');
});

void test('cancelTransfer reports unauthenticated for a client with no session', async () => {
  const { ticketId } = await offerableTicket();
  const requested = await requestTransfer(acquirer.client, ticketId, recipient.user.id);
  assert.equal(requested.ok, true);

  const anonymous = createAnonymousClient();
  const result = await cancelTransfer(anonymous, requested.data.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'unauthenticated');
});

// --- Required regression (Issue #33 Acceptance Criteria): transfer never
// mutates participation ---

void test('requestTransfer does not change participation: considering stays considering, attending stays attending', async () => {
  const { occurrenceId, ticketId } = await offerableTicket();
  // Issue #225/#230: invite no longer auto-creates a `considering`
  // participation for a rowless invitee, so the recipient has no row at all
  // straight out of offerableTicket()'s makeTransferEligible call - set it
  // explicitly here. This does not disturb the invitation makeTransferEligible
  // already created (only a transition *to* `attending` ever resolves a
  // pending invitation - see supabase/migrations/20260830000000_simplify_
  // invitation_pending_only.sql), so eligibility for the requestTransfer
  // call below is unaffected.
  const setConsidering = await setParticipationTyped(recipient.client, occurrenceId, {
    status: 'considering',
  });
  assert.equal(setConsidering.ok, true);

  const senderBefore = await readOwnParticipation(acquirer, occurrenceId);
  const recipientBefore = await readOwnParticipation(recipient, occurrenceId);
  assert.equal(senderBefore?.status, 'attending');
  assert.equal(recipientBefore?.status, 'considering');

  const requested = await requestTransfer(acquirer.client, ticketId, recipient.user.id);
  assert.equal(requested.ok, true);

  const senderAfter = await readOwnParticipation(acquirer, occurrenceId);
  const recipientAfter = await readOwnParticipation(recipient, occurrenceId);
  assert.deepEqual(senderAfter, senderBefore);
  assert.deepEqual(recipientAfter, recipientBefore);
});

// Issue #225/#230 removes the "recipient already attending at the moment
// eligibility is established" variant of this regression entirely: reaching
// `attending` now resolves (deletes) any pending invitation for that
// (occurrence, invitee) pair, and invite_to_occurrence's own attending
// branch never creates one in the first place - so there is no longer a
// reachable state where a recipient is simultaneously `attending` *and*
// eligible via a still-existing invitation at request time. This is the
// intended effect of decoupling Invitation semantics from legacy Ticket
// transfer eligibility (#230 "Legacy Ticket runtime separation").
//
// What remains true, and worth pinning, is the more realistic ordering:
// eligibility is established while the recipient is not yet attending,
// `request_ticket_transfer` only consults it once (at request time, not
// again on accept - see request_ticket_transfer's own migration), so the
// recipient can freely become attending *after* the transfer is already
// pending, and acceptTransfer still must not touch that Participation row.
void test('acceptTransfer does not change participation, including when the recipient becomes attending after the transfer was already requested', async () => {
  const { occurrenceId, ticketId } = await offerableTicket();

  const requested = await requestTransfer(acquirer.client, ticketId, recipient.user.id);
  assert.equal(requested.ok, true);

  const promoted = await setParticipationTyped(recipient.client, occurrenceId, {
    status: 'attending',
  });
  assert.equal(promoted.ok, true);

  const senderBefore = await readOwnParticipation(acquirer, occurrenceId);
  const recipientBefore = await readOwnParticipation(recipient, occurrenceId);
  assert.equal(senderBefore?.status, 'attending');
  assert.equal(recipientBefore?.status, 'attending');

  const accepted = await acceptTransfer(recipient.client, requested.data.id);
  assert.equal(accepted.ok, true);

  const senderAfter = await readOwnParticipation(acquirer, occurrenceId);
  const recipientAfter = await readOwnParticipation(recipient, occurrenceId);
  assert.deepEqual(senderAfter, senderBefore);
  assert.deepEqual(recipientAfter, recipientBefore);
});

void test('cancelTransfer does not change participation', async () => {
  const { occurrenceId, ticketId } = await offerableTicket();
  const senderBefore = await readOwnParticipation(acquirer, occurrenceId);
  const recipientBefore = await readOwnParticipation(recipient, occurrenceId);

  const requested = await requestTransfer(acquirer.client, ticketId, recipient.user.id);
  assert.equal(requested.ok, true);
  const cancelled = await cancelTransfer(acquirer.client, requested.data.id);
  assert.equal(cancelled.ok, true);

  const senderAfter = await readOwnParticipation(acquirer, occurrenceId);
  const recipientAfter = await readOwnParticipation(recipient, occurrenceId);
  assert.deepEqual(senderAfter, senderBefore);
  assert.deepEqual(recipientAfter, recipientBefore);

  // Cross-check against the raw persisted transfer row too, independent of
  // the typed boundary's own mapping.
  const persisted = await readTransferAsAdmin(requested.data.id);
  assert.equal(persisted.status, 'cancelled');
});
