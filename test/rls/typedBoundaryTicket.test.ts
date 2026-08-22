import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  createTicket,
  listTicketsForAcquisition,
  listVisibleTickets,
  updateTicket,
} from '../../src/infrastructure/supabase/ticket.ts';
import { createAcquisition } from '../../src/infrastructure/supabase/ticketAcquisition.ts';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';
import { createEventWithOccurrence } from './support/eventFixtures.ts';

// Real local Supabase/RLS tests for the ticket typed boundary (Issue #33),
// over public.tickets (Issue #32, hardened by Issue #50). Unlike
// test/rls/tickets.test.ts, which exercises the raw RLS policies directly,
// this file exercises src/infrastructure/supabase/ticket.ts. The
// owner-vs-source-acquirer read/write asymmetry created by a transfer is
// covered in test/rls/typedBoundaryTransfer.test.ts, where a transfer
// fixture is naturally available.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let catalogOwner: TestActor;
let actorA: TestActor;
let stranger: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  catalogOwner = await createTestActor('rls-typed-ticket-catalog', PASSWORD, {
    designatedCatalogCreator: true,
  });
  createdActors.push(catalogOwner);
  actorA = await createTestActor('rls-typed-ticket-a', PASSWORD);
  createdActors.push(actorA);
  stranger = await createTestActor('rls-typed-ticket-stranger', PASSWORD);
  createdActors.push(stranger);
});

after(async () => {
  const results = await Promise.allSettled(createdActors.map((actor) => deleteTestActor(actor)));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    const messages = failures.map((failure) =>
      failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
    );
    throw new Error(`test actor cleanup failed:\n${messages.join('\n')}`);
  }
});

async function securedAcquisitionId(): Promise<string> {
  const { occurrence } = await createEventWithOccurrence(catalogOwner);
  const created = await createAcquisition(actorA.client, occurrence.id, { status: 'secured' });
  if (!created.ok) {
    throw new Error(`fixture acquisition creation failed: ${created.error.message}`);
  }
  return created.data.id;
}

void test('createTicket persists a ticket under the caller’s own secured acquisition, unassigned by default', async () => {
  const acquisitionId = await securedAcquisitionId();
  const result = await createTicket(actorA.client, acquisitionId);
  assert.equal(result.ok, true);
  assert.equal(result.data.ownerId, actorA.user.id);
  assert.deepEqual(result.data.assignment, { kind: 'unassigned' });
});

void test('createTicket reports permission-denied under a pending (not secured) acquisition', async () => {
  const { occurrence } = await createEventWithOccurrence(catalogOwner);
  const pending = await createAcquisition(actorA.client, occurrence.id);
  assert.equal(pending.ok, true);

  const result = await createTicket(actorA.client, pending.data.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'permission-denied');
});

void test('listTicketsForAcquisition returns tickets created under it', async () => {
  const acquisitionId = await securedAcquisitionId();
  const created = await createTicket(actorA.client, acquisitionId, { seatLabel: 'A1' });
  assert.equal(created.ok, true);

  const listed = await listTicketsForAcquisition(actorA.client, acquisitionId);
  assert.equal(listed.ok, true);
  assert.ok(listed.data.some((t) => t.id === created.data.id));
});

void test('listVisibleTickets shows the owner their own ticket, and a stranger nothing', async () => {
  const acquisitionId = await securedAcquisitionId();
  const created = await createTicket(actorA.client, acquisitionId);
  assert.equal(created.ok, true);

  const ownerView = await listVisibleTickets(actorA.client);
  assert.equal(ownerView.ok, true);
  assert.ok(ownerView.data.some((t) => t.id === created.data.id));

  const strangerView = await listVisibleTickets(stranger.client);
  assert.equal(strangerView.ok, true);
  assert.ok(!strangerView.data.some((t) => t.id === created.data.id));
});

void test('updateTicket lets the owner set seat/queue/medium and a registered-user assignment', async () => {
  const acquisitionId = await securedAcquisitionId();
  const created = await createTicket(actorA.client, acquisitionId);
  assert.equal(created.ok, true);

  const updated = await updateTicket(actorA.client, created.data.id, {
    seatLabel: 'B2',
    queueNumber: '42',
    medium: 'electronic',
    assignment: { kind: 'registered-user', userId: stranger.user.id },
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.data.seatLabel, 'B2');
  assert.equal(updated.data.queueNumber, '42');
  assert.equal(updated.data.medium, 'electronic');
  assert.deepEqual(updated.data.assignment, { kind: 'registered-user', userId: stranger.user.id });
});

void test('updateTicket switching to an external-companion assignment clears the registered-user assignment', async () => {
  const acquisitionId = await securedAcquisitionId();
  const created = await createTicket(actorA.client, acquisitionId, {
    assignment: { kind: 'registered-user', userId: stranger.user.id },
  });
  assert.equal(created.ok, true);

  const updated = await updateTicket(actorA.client, created.data.id, {
    assignment: { kind: 'external-companion', name: 'Alex' },
  });
  assert.equal(updated.ok, true);
  assert.deepEqual(updated.data.assignment, { kind: 'external-companion', name: 'Alex' });
});

void test('updateTicket reports permission-denied for a ticket the caller cannot write to', async () => {
  const acquisitionId = await securedAcquisitionId();
  const created = await createTicket(actorA.client, acquisitionId);
  assert.equal(created.ok, true);

  const result = await updateTicket(stranger.client, created.data.id, { seatLabel: 'hijacked' });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'permission-denied');
});

void test('createTicket reports unauthenticated for a client with no session', async () => {
  const acquisitionId = await securedAcquisitionId();
  const anonymous = createAnonymousClient();
  const result = await createTicket(anonymous, acquisitionId);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'unauthenticated');
});
