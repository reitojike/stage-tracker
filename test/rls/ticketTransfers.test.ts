import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActorsSequentially,
  type TestActor,
} from './support/testActors.ts';
import {
  createSecuredTicket,
  readAcquisitionAsAdmin,
  readTicketAsAdmin,
  readTransferAsAdmin,
  seedPendingTransfer,
  type TicketOverrides,
} from './support/ticketFixtures.ts';

// Real local Supabase/Postgres tests for ticket transfer (Issue #32) - the
// acceptance, cancellation and ownership-transition rules, plus the
// concurrency guards around them.
//
// Pending transfers are seeded through the service_role path rather than
// request_ticket_transfer: that RPC currently fails closed on recipient
// eligibility, which needs the invitation persistence Issue #30 establishes.
// See seedPendingTransfer in support/ticketFixtures.ts for why that is a
// state-only seam, and the "eligibility" section at the bottom of this file
// for what is asserted about request_ticket_transfer today. Every
// accept/cancel assertion still runs through the real authenticated RPC.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let catalogOwner: TestActor;
let acquirer: TestActor;
let recipient: TestActor;
let outsider: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  catalogOwner = await createTestActor('rls-xfer-catalog', PASSWORD);
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
  const transfer = await seedPendingTransfer(ticket.id, acquirer.user.id, recipient.user.id);
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

void test('a pending recipient can read the ticket being offered to them', async () => {
  const { ticket } = await offerTicket({ seatLabel: 'S席 1列 1番' });
  const { data, error } = await recipient.client.from('tickets').select().eq('id', ticket.id);
  assert.equal(error, null);
  assert.equal(data.length, 1);
  assert.equal(data[0]?.seat_label, 'S席 1列 1番');
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
  const { ticket, transfer } = await offerTicket();
  const { error: firstAcceptError } = await recipient.client.rpc('accept_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.equal(firstAcceptError, null);

  // A second hop the original acquirer is not a party to at all.
  const secondTransfer = await seedPendingTransfer(ticket.id, recipient.user.id, outsider.user.id);
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
  const { ticket, transfer } = await offerTicket();
  const { error } = await acquirer.client.rpc('cancel_ticket_transfer', {
    p_transfer_id: transfer.id,
  });
  assert.equal(error, null);

  const { data, error: readError } = await recipient.client
    .from('tickets')
    .select()
    .eq('id', ticket.id);
  assert.equal(readError, null);
  assert.deepEqual(data, []);
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
  const { ticket } = await offerTicket();
  await assert.rejects(
    seedPendingTransfer(ticket.id, acquirer.user.id, outsider.user.id),
    'expected the one-pending-transfer-per-ticket index to reject a second live offer',
  );
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

// This asserts the *interim* fail-closed state of the Issue #30 integration
// seam, not a durable product rule: no transfer may be requested while
// recipient eligibility cannot be evaluated against real invitation
// persistence. When #30 merges and
// 20260822093300_create_ticket_transfer_eligibility.sql is wired to the real
// contract, this test is replaced by the eligibility positive/negative pair
// (an invited recipient is accepted, an uninvited one is refused).
void test('transfer requests fail closed while recipient eligibility is unwired (Issue #30 blocker)', async () => {
  const { ticket } = await createSecuredTicket(acquirer, catalogOwner);
  const { error } = await acquirer.client.rpc('request_ticket_transfer', {
    p_ticket_id: ticket.id,
    p_recipient_id: recipient.user.id,
  });
  assert.ok(error, 'expected the eligibility seam to refuse the request');
  assert.match(error.message, /not eligible/);

  const { data } = await acquirer.client
    .from('ticket_transfers')
    .select()
    .eq('ticket_id', ticket.id);
  assert.deepEqual(data, [], 'a refused request must not leave a transfer row behind');
});
