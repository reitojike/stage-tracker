import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  createAdminClient,
  createAnonymousClient,
  createTestActor,
  deleteTestActorsSequentially,
  type TestActor,
} from './support/testActors.ts';
import {
  createAcquisition,
  createOccurrence,
  createSecuredTicket,
  createTicket,
  makeTransferEligible,
  readAcquisitionAsAdmin,
  readTicketAsAdmin,
  readTransferAsAdmin,
  requestTransfer,
  type TicketOverrides,
} from './support/ticketFixtures.ts';

// Real local Supabase/Postgres tests for ticket transfer (Issue #32) - the
// acceptance, cancellation and ownership-transition rules, plus the
// concurrency guards around them.
//
// Every transfer below is started through the real request_ticket_transfer
// RPC as the ticket's owner, and recipients become eligible only by being
// invited to the occurrence through Issue #30's invite_to_occurrence - there
// is no service_role shortcut around either. See the "eligibility" section
// at the bottom for what that rule admits and refuses.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let catalogOwner: TestActor;
let acquirer: TestActor;
let recipient: TestActor;
let outsider: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  catalogOwner = await createTestActor('rls-xfer-catalog', PASSWORD, {
    designatedCatalogCreator: true,
  });
  createdActors.push(catalogOwner);
  acquirer = await createTestActor('rls-xfer-acquirer', PASSWORD);
  createdActors.push(acquirer);
  recipient = await createTestActor('rls-xfer-recipient', PASSWORD);
  createdActors.push(recipient);
  outsider = await createTestActor('rls-xfer-outsider', PASSWORD);
  createdActors.push(outsider);
});

after(async () => {
  await deleteTestActorsSequentially(createdActors);
});

async function offerTicket(overrides: TicketOverrides = {}) {
  const { occurrence, acquisition, ticket } = await createSecuredTicket(
    acquirer,
    catalogOwner,
    overrides,
  );
  await makeTransferEligible(acquirer, occurrence.id, recipient);
  const transfer = await requestTransfer(acquirer, ticket.id, recipient.user.id);
  return { occurrence, acquisition, ticket, transfer };
}

// --- Positive: visibility while pending ---

void test('both parties can read a pending transfer', async () => {
  const { transfer } = await offerTicket();

  const { data: senderView, error: senderError } = await acquirer.client
    .from('ticket_transfers')
    .select()
    .eq('id', transfer.id);
  assert.equal(senderError, null);
  assert.equal(senderView.length, 1);

  const { data: recipientView, error: recipientError } = await recipient.client
    .from('ticket_transfers')
    .select()
    .eq('id', transfer.id);
  assert.equal(recipientError, null);
  assert.equal(recipientView.length, 1);
});

void test('an uninvolved user cannot read a transfer', async () => {
  const { transfer } = await offerTicket();
  const { data, error } = await outsider.client
    .from('ticket_transfers')
    .select()
    .eq('id', transfer.id);
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

void test('a pending recipient can see the offer’s decision surface', async () => {
  const { occurrence, ticket, transfer } = await offerTicket({
    seatLabel: 'S席 1列 1番',
    queueNumber: '12',
    medium: 'electronic',
  });

  const { data, error } = await recipient.client.rpc('pending_ticket_transfer_offer', {
    p_transfer_id: transfer.id,
  });
  assert.equal(error, null);
  assert.equal(data.length, 1);
  assert.deepEqual(data[0], {
    transfer_id: transfer.id,
    ticket_id: ticket.id,
    occurrence_id: occurrence.id,
    seat_label: 'S席 1列 1番',
    queue_number: '12',
    medium: 'electronic',
  });
});

// The whole reason the offer is a projection rather than a SELECT policy:
// the previous owner's assignment - and especially an external companion's
// name - must not reach a prospective recipient. accept_ticket_transfer
// clears it, but an offer that is never accepted would already have leaked.
void test('a pending recipient is not shown the previous owner’s assignment', async () => {
  const { ticket, transfer } = await offerTicket({
    assigneeExternalName: '同行者A',
    seatLabel: 'A-1',
  });

  const { data, error } = await recipient.client.rpc('pending_ticket_transfer_offer', {
    p_transfer_id: transfer.id,
  });
  assert.equal(error, null);
  assert.equal(data.length, 1);
  const [offer] = data;
  assert.ok(offer);
  assert.equal(offer.seat_label, 'A-1', 'the decision surface itself is still returned');

  // Asserting on the returned column set, not on a typed property: the
  // point is that these fields are absent from the projection entirely.
  const offerFields = Object.keys(offer);
  assert.ok(
    !offerFields.includes('assignee_external_name'),
    `the offer must not carry the external companion name (got ${offerFields.join(', ')})`,
  );
  assert.ok(
    !offerFields.includes('assigned_to_user_id'),
    `the offer must not carry the registered assignee either (got ${offerFields.join(', ')})`,
  );

  // Belt and braces: the value really is still on the row at this point, so
  // the assertions above are about what the offer exposes - not about the
  // fixture having failed to set it.
  const stored = await readTicketAsAdmin(ticket.id);
  assert.equal(stored.assignee_external_name, '同行者A');
});

void test('a pending recipient still cannot read the ticket row itself', async () => {
  const { ticket } = await offerTicket({ assigneeExternalName: '同行者B' });
  const { data, error } = await recipient.client.from('tickets').select().eq('id', ticket.id);
  assert.equal(error, null);
  assert.deepEqual(data, [], 'the offer projection is the only ticket surface a recipient gets');
});

// A registered assignee is withheld for the same reason as the external
// name, and this also pins that assignment confers no visibility of its own.
void test('a pending recipient is not shown a registered assignee', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(acquirer, occurrence.id, { status: 'secured' });
  const ticket = await createTicket(acquirer, acquisition.id, {
    assignedToUserId: outsider.user.id,
  });
  await makeTransferEligible(acquirer, occurrence.id, recipient);
  const transfer = await requestTransfer(acquirer, ticket.id, recipient.user.id);

  const { data, error } = await recipient.client.rpc('pending_ticket_transfer_offer', {
    p_transfer_id: transfer.id,
  });
  assert.equal(error, null);
  assert.equal(data.length, 1);
  const [offer] = data;
  assert.ok(offer);
  assert.ok(!Object.keys(offer).includes('assigned_to_user_id'));
});

void test('the offer projection is scoped to the caller’s own pending offers', async () => {
  const { transfer } = await offerTicket();

  // The sender is a party to this transfer, but the offer surface belongs to
  // the recipient - it is not a general transfer read.
  const { data: senderView, error: senderError } = await acquirer.client.rpc(
    'pending_ticket_transfer_offer',
    { p_transfer_id: transfer.id },
  );
  assert.equal(senderError, null);
  assert.deepEqual(senderView, []);

  const { data: outsiderView, error: outsiderError } = await outsider.client.rpc(
    'pending_ticket_transfer_offer',
    { p_transfer_id: transfer.id },
  );
  assert.equal(outsiderError, null);
  assert.deepEqual(outsiderView, []);
});

void test('a pending recipient still cannot edit the ticket before accepting', async () => {
  const { ticket } = await offerTicket();
  const { data, error } = await recipient.client
    .from('tickets')
    .update({ seat_label: 'early' })
    .eq('id', ticket.id)
    .select();
  assert.equal(error, null);
  assert.deepEqual(data, []);

  const stored = await readTicketAsAdmin(ticket.id);
  assert.equal(stored.seat_label, null);
});

// --- Positive: acceptance ---

void test('the recipient can accept, which moves ownership and settles the transfer', async () => {
  const { ticket, transfer } = await offerTicket();

  const { data, error } = await recipient.client.rpc('accept_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.equal(error, null);
  assert.ok(data, 'expected the RPC to return the settled transfer');
  assert.equal(data.status, 'accepted');
  assert.ok(data.responded_at, 'expected responded_at to be stamped on acceptance');

  const stored = await readTicketAsAdmin(ticket.id);
  assert.equal(stored.owner_id, recipient.user.id);
});

void test('edit authority follows ownership after acceptance', async () => {
  const { ticket, transfer } = await offerTicket();
  const { error: acceptError } = await recipient.client.rpc('accept_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.equal(acceptError, null);

  const { data: recipientUpdate, error: recipientUpdateError } = await recipient.client
    .from('tickets')
    .update({ seat_label: '3階 2列 4番' })
    .eq('id', ticket.id)
    .select();
  assert.equal(recipientUpdateError, null);
  assert.equal(recipientUpdate.length, 1);

  const { data: senderUpdate, error: senderUpdateError } = await acquirer.client
    .from('tickets')
    .update({ seat_label: 'taken back' })
    .eq('id', ticket.id)
    .select();
  assert.equal(senderUpdateError, null);
  assert.deepEqual(senderUpdate, [], 'the previous owner must lose edit authority');

  const stored = await readTicketAsAdmin(ticket.id);
  assert.equal(stored.seat_label, '3階 2列 4番');
});

void test('acceptance clears the previous owner’s assignment', async () => {
  const { ticket, transfer } = await offerTicket({ assigneeExternalName: '前の同行者' });
  const { error } = await recipient.client.rpc('accept_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.equal(error, null);

  const stored = await readTicketAsAdmin(ticket.id);
  assert.equal(stored.assignee_external_name, null);
  assert.equal(stored.assigned_to_user_id, null);
});

// --- Positive: provenance survives the transfer ---

void test('the source acquisition is unchanged and still belongs to the original acquirer', async () => {
  const { acquisition, ticket, transfer } = await offerTicket();
  const { error } = await recipient.client.rpc('accept_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.equal(error, null);

  const storedAcquisition = await readAcquisitionAsAdmin(acquisition.id);
  assert.equal(storedAcquisition.owner_id, acquirer.user.id);
  assert.equal(storedAcquisition.status, 'secured');

  const storedTicket = await readTicketAsAdmin(ticket.id);
  assert.equal(storedTicket.acquisition_id, acquisition.id);
});

void test('the original acquirer can still see the ticket and its transfer chain after it moves on', async () => {
  const { occurrence, ticket, transfer } = await offerTicket();
  const { error: firstAcceptError } = await recipient.client.rpc('accept_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.equal(firstAcceptError, null);

  // A second hop the original acquirer is not a party to at all. The new
  // owner starts it, so eligibility is established for the new recipient.
  await makeTransferEligible(recipient, occurrence.id, outsider);
  const secondTransfer = await requestTransfer(recipient, ticket.id, outsider.user.id);
  const { error: secondAcceptError } = await outsider.client.rpc('accept_ticket_transfer', {
    p_transfer_id: secondTransfer.id,
  });
  assert.equal(secondAcceptError, null);

  const { data: ticketView, error: ticketError } = await acquirer.client
    .from('tickets')
    .select()
    .eq('id', ticket.id);
  assert.equal(ticketError, null);
  assert.equal(ticketView.length, 1, 'the source acquirer keeps read access to the ticket');
  assert.equal(ticketView[0]?.owner_id, outsider.user.id);

  const { data: transferView, error: transferError } = await acquirer.client
    .from('ticket_transfers')
    .select()
    .eq('ticket_id', ticket.id);
  assert.equal(transferError, null);
  assert.equal(transferView.length, 2, 'the source acquirer can see who the ticket went to');
});

// A source acquirer normally keeps full-row read on a ticket even after it
// moves on (see the test above). But when the *current* owner offers that
// same ticket back to the source acquirer, the source-acquirer branch of
// tickets_select_owner_or_source_acquirer would otherwise hand them the
// current owner's assignment before they accept - the same disclosure the
// recipient-side projection exists to prevent, reached through a different
// read path (Issue #50).
void test('a pending recipient who is also the source acquirer cannot read the current owner’s assignment via the source-acquirer path', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  // Both parties' eligibility is established up front, from a neutral
  // inviter (catalogOwner), before either becomes the ticket's owner. Doing
  // it this way - rather than reusing offerTicket()'s pattern of the sender
  // inviting the recipient - avoids the invite RPC's "already attending"
  // no-op branch: once acquirer is self-promoted to attending by a later
  // step, a fresh invite would silently fail to create the invitation row
  // acquirer needs to be eligible for the second, reverse transfer.
  await makeTransferEligible(catalogOwner, occurrence.id, acquirer);
  await makeTransferEligible(catalogOwner, occurrence.id, recipient);

  const acquisition = await createAcquisition(acquirer, occurrence.id, { status: 'secured' });
  const ticket = await createTicket(acquirer, acquisition.id, {
    assigneeExternalName: '最初の同行者',
  });

  const firstTransfer = await requestTransfer(acquirer, ticket.id, recipient.user.id);
  const { error: acceptError } = await recipient.client.rpc('accept_ticket_transfer', {
    p_transfer_id: firstTransfer.id,
  });
  assert.equal(acceptError, null);

  // recipient (now owner) sets an assignment the original acquirer must not
  // see before accepting the offer below.
  const { error: assignError } = await recipient.client
    .from('tickets')
    .update({ assignee_external_name: '新しい同行者' })
    .eq('id', ticket.id);
  assert.equal(assignError, null);

  // recipient offers the ticket back to the original acquirer, who is both
  // the source acquirer and the pending recipient of this second transfer.
  // acquirer's eligibility (the invitation row from catalogOwner above) was
  // established before any attending-status changes, so it still holds.
  const secondTransfer = await requestTransfer(recipient, ticket.id, acquirer.user.id);

  // The source-acquirer read path must not disclose the row - and therefore
  // not the assignment - while this offer is pending.
  const { data, error } = await acquirer.client.from('tickets').select().eq('id', ticket.id);
  assert.equal(error, null);
  assert.deepEqual(
    data,
    [],
    'source-acquirer read must be withheld while a pending transfer offers the ticket back to them',
  );

  // The existing recipient-side projection also withholds it, as it does for
  // any other pending recipient.
  const { data: offerRows, error: offerError } = await acquirer.client.rpc(
    'pending_ticket_transfer_offer',
    { p_transfer_id: secondTransfer.id },
  );
  assert.equal(offerError, null);
  assert.equal(offerRows.length, 1);
  const [offerRow] = offerRows;
  assert.ok(offerRow);
  const offerFields = Object.keys(offerRow);
  assert.ok(!offerFields.includes('assignee_external_name'));
  assert.ok(!offerFields.includes('assigned_to_user_id'));

  // Provenance itself - the ability to confirm the ticket exists and see its
  // transfer history - must still work through the channels that do not
  // depend on the withheld full-row read.
  const { data: transferHistory, error: historyError } = await acquirer.client
    .from('ticket_transfers')
    .select()
    .eq('ticket_id', ticket.id);
  assert.equal(historyError, null);
  assert.equal(
    transferHistory.length,
    2,
    'the source acquirer must still see the full transfer chain',
  );

  // Sanity: the assignment really is on the row at this point, so the
  // assertions above are about what is exposed, not about the fixture having
  // failed to set it.
  const stored = await readTicketAsAdmin(ticket.id);
  assert.equal(stored.assignee_external_name, '新しい同行者');
});

void test('a source acquirer who is not a pending recipient keeps ordinary full-row read', async () => {
  const { ticket } = await offerTicket();
  const { data, error } = await acquirer.client.from('tickets').select().eq('id', ticket.id);
  assert.equal(error, null);
  assert.equal(data.length, 1, 'the ordinary source-acquirer read path must be unaffected');
});

// --- Positive: cancellation ---

void test('the sender can cancel a pending transfer, leaving ownership untouched', async () => {
  const { ticket, transfer } = await offerTicket();

  const { data, error } = await acquirer.client.rpc('cancel_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.equal(error, null);
  assert.ok(data, 'expected the RPC to return the settled transfer');
  assert.equal(data.status, 'cancelled');
  assert.ok(data.responded_at, 'expected responded_at to be stamped on cancellation');

  const stored = await readTicketAsAdmin(ticket.id);
  assert.equal(stored.owner_id, acquirer.user.id);
});

void test('a cancelled offer stops exposing the ticket to the would-be recipient', async () => {
  const { transfer } = await offerTicket();
  const { error } = await acquirer.client.rpc('cancel_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.equal(error, null);

  const { data, error: readError } = await recipient.client.rpc('pending_ticket_transfer_offer', {
    p_transfer_id: transfer.id,
  });
  assert.equal(readError, null);
  assert.deepEqual(data, [], 'the offer surface lapses once the transfer stops being pending');
});

void test('a cancelled transfer can no longer be accepted', async () => {
  const { ticket, transfer } = await offerTicket();
  const { error: cancelError } = await acquirer.client.rpc('cancel_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.equal(cancelError, null);

  const { error } = await recipient.client.rpc('accept_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.ok(error, 'expected accepting a cancelled transfer to fail');

  const stored = await readTicketAsAdmin(ticket.id);
  assert.equal(stored.owner_id, acquirer.user.id);
});

// --- Negative: no unilateral reclaim after acceptance ---

void test('the sender cannot cancel a transfer once it has been accepted', async () => {
  const { ticket, transfer } = await offerTicket();
  const { error: acceptError } = await recipient.client.rpc('accept_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.equal(acceptError, null);

  const { error } = await acquirer.client.rpc('cancel_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.ok(error, 'expected cancelling an accepted transfer to fail');

  const stored = await readTicketAsAdmin(ticket.id);
  assert.equal(stored.owner_id, recipient.user.id);
});

void test('the sender cannot start a new transfer for a ticket they no longer own', async () => {
  const { ticket, transfer } = await offerTicket();
  const { error: acceptError } = await recipient.client.rpc('accept_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.equal(acceptError, null);

  const { error } = await acquirer.client.rpc('request_ticket_transfer', {
    p_ticket_id: ticket.id,
    p_recipient_id: outsider.user.id,
  });
  assert.ok(error, 'expected the previous owner to be refused');
  assert.match(
    error.message,
    /current ticket owner/,
    'expected the ownership check, not the eligibility check, to reject this',
  );
});

void test('the sender cannot move ownership back by writing to the ticket directly', async () => {
  const { ticket, transfer } = await offerTicket();
  const { error: acceptError } = await recipient.client.rpc('accept_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.equal(acceptError, null);

  const { error } = await acquirer.client
    .from('tickets')
    .update({ owner_id: acquirer.user.id })
    .eq('id', ticket.id);
  assert.ok(error, 'expected a permission error for writing owner_id directly');

  const stored = await readTicketAsAdmin(ticket.id);
  assert.equal(stored.owner_id, recipient.user.id);
});

// --- Negative: who may accept / cancel ---

void test('only the recipient can accept a transfer', async () => {
  const { ticket, transfer } = await offerTicket();

  for (const actor of [acquirer, outsider]) {
    const { error } = await actor.client.rpc('accept_ticket_transfer', {
      p_transfer_id: transfer.id,
    });
    assert.ok(error, `expected ${actor.user.id} to be refused acceptance`);
  }

  const stored = await readTicketAsAdmin(ticket.id);
  assert.equal(stored.owner_id, acquirer.user.id);
  const storedTransfer = await readTransferAsAdmin(transfer.id);
  assert.equal(storedTransfer.status, 'pending');
});

void test('only the sender can cancel a transfer', async () => {
  const { transfer } = await offerTicket();

  for (const actor of [recipient, outsider]) {
    const { error } = await actor.client.rpc('cancel_ticket_transfer', {
      p_transfer_id: transfer.id,
    });
    assert.ok(error, `expected ${actor.user.id} to be refused cancellation`);
  }

  const stored = await readTransferAsAdmin(transfer.id);
  assert.equal(stored.status, 'pending');
});

void test('a transfer cannot be accepted twice', async () => {
  const { ticket, transfer } = await offerTicket();

  const { error: firstError } = await recipient.client.rpc('accept_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.equal(firstError, null);

  const { error: secondError } = await recipient.client.rpc('accept_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.ok(secondError, 'expected a second acceptance to fail');

  const stored = await readTicketAsAdmin(ticket.id);
  assert.equal(stored.owner_id, recipient.user.id);
});

// --- Negative: concurrency ---

void test('concurrent acceptances of one transfer settle it exactly once', async () => {
  const { ticket, transfer } = await offerTicket();

  const results = await Promise.all([
    recipient.client.rpc('accept_ticket_transfer', { p_transfer_id: transfer.id }),
    recipient.client.rpc('accept_ticket_transfer', { p_transfer_id: transfer.id }),
  ]);
  const succeeded = results.filter((result) => result.error === null);
  assert.equal(succeeded.length, 1, 'exactly one concurrent acceptance may succeed');

  const stored = await readTicketAsAdmin(ticket.id);
  assert.equal(stored.owner_id, recipient.user.id);
  const storedTransfer = await readTransferAsAdmin(transfer.id);
  assert.equal(storedTransfer.status, 'accepted');
});

void test('a concurrent acceptance and cancellation cannot both take effect', async () => {
  const { ticket, transfer } = await offerTicket();

  const [acceptResult, cancelResult] = await Promise.all([
    recipient.client.rpc('accept_ticket_transfer', { p_transfer_id: transfer.id }),
    acquirer.client.rpc('cancel_ticket_transfer', { p_transfer_id: transfer.id }),
  ]);
  const succeeded = [acceptResult, cancelResult].filter((result) => result.error === null);
  assert.equal(succeeded.length, 1, 'exactly one of accept/cancel may win');

  const storedTransfer = await readTransferAsAdmin(transfer.id);
  const storedTicket = await readTicketAsAdmin(ticket.id);
  // Whichever won, the ticket's owner and the transfer's status must agree.
  if (storedTransfer.status === 'accepted') {
    assert.equal(storedTicket.owner_id, recipient.user.id);
  } else {
    assert.equal(storedTransfer.status, 'cancelled');
    assert.equal(storedTicket.owner_id, acquirer.user.id);
  }
});

void test('a ticket cannot have two pending offers outstanding', async () => {
  const { occurrence, ticket } = await offerTicket();
  await makeTransferEligible(acquirer, occurrence.id, outsider);

  const { error } = await acquirer.client.rpc('request_ticket_transfer', {
    p_ticket_id: ticket.id,
    p_recipient_id: outsider.user.id,
  });
  assert.ok(error, 'expected a second live offer to be refused');
  assert.match(error.message, /already has a pending transfer/);
});

// The RPC check above is the one a client meets. This asserts the structural
// backstop underneath it: even a writer that bypasses the RPC entirely
// (here, service_role) cannot produce two live offers for one ticket, which
// is what makes "accepted twice into two different owners" unreachable
// rather than merely unlikely.
void test('the one-pending-offer rule holds structurally, not just in the RPC', async () => {
  const { ticket } = await offerTicket();
  const admin = createAdminClient();

  const { error } = await admin
    .from('ticket_transfers')
    .insert({ ticket_id: ticket.id, sender_id: acquirer.user.id, recipient_id: outsider.user.id });
  assert.ok(error, 'expected the partial unique index to reject a second pending row');
});

// --- Negative: the transfer ledger is RPC-only ---

void test('an authenticated client cannot write to ticket_transfers directly', async () => {
  const { ticket, transfer } = await offerTicket();

  const { error: insertError } = await acquirer.client.from('ticket_transfers').insert({
    ticket_id: ticket.id,
    sender_id: acquirer.user.id,
    recipient_id: outsider.user.id,
  });
  assert.ok(insertError, 'expected a permission error for a direct transfer insert');

  const { error: updateError } = await recipient.client
    .from('ticket_transfers')
    .update({ status: 'accepted' })
    .eq('id', transfer.id);
  assert.ok(updateError, 'expected a permission error for flipping a transfer to accepted');

  const { error: deleteError } = await acquirer.client
    .from('ticket_transfers')
    .delete()
    .eq('id', transfer.id);
  assert.ok(deleteError, 'expected a permission error for deleting a transfer');

  const stored = await readTransferAsAdmin(transfer.id);
  assert.equal(stored.status, 'pending');
});

// --- Negative: anonymous ---

void test('anonymous cannot read transfers or call any transfer RPC', async () => {
  const { ticket, transfer } = await offerTicket();
  const anon = createAnonymousClient();

  const { error: selectError } = await anon.from('ticket_transfers').select();
  assert.ok(selectError, 'expected a permission error for anonymous select');

  const { error: requestError } = await anon.rpc('request_ticket_transfer', {
    p_ticket_id: ticket.id,
    p_recipient_id: outsider.user.id,
  });
  assert.ok(requestError, 'expected a permission error for anonymous request_ticket_transfer');

  const { error: acceptError } = await anon.rpc('accept_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.ok(acceptError, 'expected a permission error for anonymous accept_ticket_transfer');

  const { error: cancelError } = await anon.rpc('cancel_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.ok(cancelError, 'expected a permission error for anonymous cancel_ticket_transfer');

  // The offer projection is the one function in this slice that reads a
  // ticket row with definer privileges, so its anon boundary is pinned here
  // too: if the revoke on it were ever lost, this must go red.
  const { error: offerError } = await anon.rpc('pending_ticket_transfer_offer', {
    p_transfer_id: transfer.id,
  });
  assert.ok(offerError, 'expected a permission error for anonymous pending_ticket_transfer_offer');

  const stored = await readTransferAsAdmin(transfer.id);
  assert.equal(stored.status, 'pending');
});

// --- request_ticket_transfer: ownership guard, then the #30 eligibility seam ---

void test('a non-owner cannot start a transfer for someone else’s ticket', async () => {
  const { ticket } = await createSecuredTicket(acquirer, catalogOwner);
  const { error } = await outsider.client.rpc('request_ticket_transfer', {
    p_ticket_id: ticket.id,
    p_recipient_id: recipient.user.id,
  });
  assert.ok(error, 'expected a non-owner request to be refused');
  assert.match(error.message, /current ticket owner/);
});

void test('a ticket cannot be transferred to its own owner', async () => {
  const { ticket } = await createSecuredTicket(acquirer, catalogOwner);
  const { error } = await acquirer.client.rpc('request_ticket_transfer', {
    p_ticket_id: ticket.id,
    p_recipient_id: acquirer.user.id,
  });
  assert.ok(error, 'expected a self-transfer to be refused');
  assert.match(error.message, /current owner/);
});

void test('an unknown recipient is refused before eligibility is consulted', async () => {
  const { ticket } = await createSecuredTicket(acquirer, catalogOwner);
  const { error } = await acquirer.client.rpc('request_ticket_transfer', {
    p_ticket_id: ticket.id,
    p_recipient_id: crypto.randomUUID(),
  });
  assert.ok(error, 'expected an unregistered recipient to be refused');
  assert.match(error.message, /registered user/);
});

// "transfer 先は、同じ occurrence へ invitation された registered user を MVP の
// eligibility とします" - the negative half. A registered user who was never
// invited to this occurrence is refused, so the rule is doing work rather
// than admitting anyone with an account.
void test('a registered user who was never invited to the occurrence is refused', async () => {
  const { ticket } = await createSecuredTicket(acquirer, catalogOwner);
  const { error } = await acquirer.client.rpc('request_ticket_transfer', {
    p_ticket_id: ticket.id,
    p_recipient_id: recipient.user.id,
  });
  assert.ok(error, 'expected an uninvited recipient to be refused');
  assert.match(error.message, /not eligible/);

  const { data } = await acquirer.client
    .from('ticket_transfers')
    .select()
    .eq('ticket_id', ticket.id);
  assert.deepEqual(data, [], 'a refused request must not leave a transfer row behind');
});

// Eligibility is scoped to *this* occurrence: an invitation to a different
// occurrence must not carry over, or the rule would degrade into "has been
// invited to anything, ever".
void test('an invitation to a different occurrence does not make a recipient eligible', async () => {
  const { ticket } = await createSecuredTicket(acquirer, catalogOwner);
  const { occurrence: unrelated } = await createOccurrence(catalogOwner);
  await makeTransferEligible(acquirer, unrelated.id, recipient);

  const { error } = await acquirer.client.rpc('request_ticket_transfer', {
    p_ticket_id: ticket.id,
    p_recipient_id: recipient.user.id,
  });
  assert.ok(error, 'expected an invitation to another occurrence not to count');
  assert.match(error.message, /not eligible/);
});

// The positive half. The occurrence scope comes from the ticket's source
// acquisition, not from the ticket, so this also covers that resolution.
void test('a recipient invited to this occurrence can be offered the ticket', async () => {
  const { occurrence, ticket } = await createSecuredTicket(acquirer, catalogOwner);
  await makeTransferEligible(acquirer, occurrence.id, recipient);

  const transfer = await requestTransfer(acquirer, ticket.id, recipient.user.id);
  assert.equal(transfer.ticket_id, ticket.id);
  assert.equal(transfer.sender_id, acquirer.user.id);
  assert.equal(transfer.recipient_id, recipient.user.id);
  assert.equal(transfer.status, 'pending');
  assert.equal(transfer.responded_at, null);
});

// Whoever sent the invitation, the recipient is an invited participant of
// the occurrence - the rule is about the recipient, not about the ticket
// owner having been the inviter.
void test('an invitation from a third party also makes a recipient eligible', async () => {
  const { occurrence, ticket } = await createSecuredTicket(acquirer, catalogOwner);
  await makeTransferEligible(outsider, occurrence.id, recipient);

  const transfer = await requestTransfer(acquirer, ticket.id, recipient.user.id);
  assert.equal(transfer.recipient_id, recipient.user.id);
});

// The eligibility predicate is SECURITY DEFINER precisely so it can see
// invitation rows the caller's RLS hides. Handing it to clients would let
// any authenticated user ask "was X invited to Y?" directly, which is the
// read Issue #30's SELECT policy withholds. It is definer-only, so this must
// stay refused.
void test('the eligibility predicate is not callable by an authenticated client', async () => {
  const { occurrence } = await createSecuredTicket(acquirer, catalogOwner);
  const { error } = await acquirer.client.rpc('ticket_transfer_recipient_is_eligible', {
    p_occurrence_id: occurrence.id,
    p_recipient_id: recipient.user.id,
  });
  assert.ok(error, 'expected the eligibility predicate to be unreachable from a client');
});
