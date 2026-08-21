import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
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
  readTicketAsAdmin,
} from './support/ticketFixtures.ts';

// Real local Supabase/Postgres RLS tests for public.tickets (Issue #32).
//
// The two boundaries this file exists to hold are: a ticket only comes into
// existence under a *secured* acquisition its creator owns, and assignment
// ("who is expected to use this ticket") is not ownership and confers no
// authority. Transfer-driven ownership movement is covered separately in
// test/rls/ticketTransfers.test.ts.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let catalogOwner: TestActor;
let owner: TestActor;
let companion: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  catalogOwner = await createTestActor('rls-ticket-catalog', PASSWORD);
  createdActors.push(catalogOwner);
  owner = await createTestActor('rls-ticket-owner', PASSWORD);
  createdActors.push(owner);
  companion = await createTestActor('rls-ticket-companion', PASSWORD);
  createdActors.push(companion);
});

after(async () => {
  await deleteTestActorsSequentially(createdActors);
});

// --- Positive: tickets under a secured acquisition ---

void test('the acquisition owner can create a ticket under a secured acquisition', async () => {
  const { acquisition, ticket } = await createSecuredTicket(owner, catalogOwner);
  assert.equal(ticket.acquisition_id, acquisition.id);
  assert.equal(ticket.owner_id, owner.user.id);
});

void test('one secured acquisition can yield several tickets', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(owner, occurrence.id, { status: 'secured' });
  const first = await createTicket(owner, acquisition.id, { seatLabel: '1階 5列 12番' });
  const second = await createTicket(owner, acquisition.id, { seatLabel: '1階 5列 13番' });
  assert.notEqual(first.id, second.id);

  const { data, error } = await owner.client
    .from('tickets')
    .select()
    .eq('acquisition_id', acquisition.id);
  assert.equal(error, null);
  assert.equal(data.length, 2);
});

void test('seat, queue and medium are ticket-level and may all be unknown', async () => {
  const { ticket } = await createSecuredTicket(owner, catalogOwner);
  assert.equal(ticket.seat_label, null);
  assert.equal(ticket.queue_number, null);
  assert.equal(ticket.medium, null);
});

void test('seat, queue and medium can differ between tickets from one acquisition', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(owner, occurrence.id, { status: 'secured' });
  const paper = await createTicket(owner, acquisition.id, {
    seatLabel: 'S席 3列 1番',
    queueNumber: 'A-0012',
    medium: 'paper',
  });
  const electronic = await createTicket(owner, acquisition.id, { medium: 'electronic' });

  assert.equal(paper.medium, 'paper');
  assert.equal(paper.queue_number, 'A-0012');
  assert.equal(electronic.medium, 'electronic');
  assert.equal(electronic.seat_label, null);
});

void test('a seat number learned later can be filled in by the owner', async () => {
  const { ticket } = await createSecuredTicket(owner, catalogOwner);
  const { data, error } = await owner.client
    .from('tickets')
    .update({ seat_label: '2階 1列 8番', medium: 'electronic' })
    .eq('id', ticket.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.seat_label, '2階 1列 8番');
  assert.equal(data.medium, 'electronic');
});

// --- Positive: assignment ---

void test('a ticket can be unassigned, assigned to its owner, or reassigned', async () => {
  const { ticket } = await createSecuredTicket(owner, catalogOwner);
  assert.equal(ticket.assigned_to_user_id, null);
  assert.equal(ticket.assignee_external_name, null);

  const { data: assignedToSelf, error: selfError } = await owner.client
    .from('tickets')
    .update({ assigned_to_user_id: owner.user.id })
    .eq('id', ticket.id)
    .select()
    .single();
  assert.equal(selfError, null);
  assert.equal(assignedToSelf.assigned_to_user_id, owner.user.id);

  const { data: unassigned, error: unassignError } = await owner.client
    .from('tickets')
    .update({ assigned_to_user_id: null })
    .eq('id', ticket.id)
    .select()
    .single();
  assert.equal(unassignError, null);
  assert.equal(unassigned.assigned_to_user_id, null);
});

void test('a ticket can be assigned to another registered user', async () => {
  const { ticket } = await createSecuredTicket(owner, catalogOwner, {
    assignedToUserId: companion.user.id,
  });
  assert.equal(ticket.assigned_to_user_id, companion.user.id);
  assert.equal(ticket.owner_id, owner.user.id, 'assignment must not move ownership');
});

void test('a ticket can be assigned to an external companion with no account', async () => {
  const { ticket } = await createSecuredTicket(owner, catalogOwner, {
    assigneeExternalName: '同行者（アカウントなし）',
  });
  assert.equal(ticket.assignee_external_name, '同行者（アカウントなし）');
  assert.equal(ticket.assigned_to_user_id, null);
  assert.equal(ticket.owner_id, owner.user.id);
});

// --- Negative: acquisition must be secured and owned by the creator ---

void test('a ticket cannot be created under a pending acquisition', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(owner, occurrence.id);
  const { error } = await owner.client
    .from('tickets')
    .insert({ acquisition_id: acquisition.id, owner_id: owner.user.id });
  assert.ok(error, 'expected an RLS violation for a ticket under a pending acquisition');
});

void test('a ticket cannot be created under an unsuccessful acquisition', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(owner, occurrence.id, { status: 'unsuccessful' });
  const { error } = await owner.client
    .from('tickets')
    .insert({ acquisition_id: acquisition.id, owner_id: owner.user.id });
  assert.ok(error, 'expected an RLS violation for a ticket under an unsuccessful acquisition');
});

void test('a ticket cannot be created under someone else’s acquisition', async () => {
  const { acquisition } = await createSecuredTicket(owner, catalogOwner);
  const { error } = await companion.client
    .from('tickets')
    .insert({ acquisition_id: acquisition.id, owner_id: companion.user.id });
  assert.ok(error, 'expected an RLS violation for a ticket under another user’s acquisition');
});

void test('a ticket cannot be created owned by someone other than the acquirer', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(owner, occurrence.id, { status: 'secured' });
  const { error } = await owner.client
    .from('tickets')
    .insert({ acquisition_id: acquisition.id, owner_id: companion.user.id });
  assert.ok(error, 'expected an RLS violation for owner spoofing on insert');
});

// --- Negative: column vocabulary and assignment shape ---

void test('ticket medium is limited to the MVP vocabulary', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(owner, occurrence.id, { status: 'secured' });
  for (const medium of ['convenience_store', 'mail', 'app', '']) {
    const { error } = await owner.client
      .from('tickets')
      .insert({ acquisition_id: acquisition.id, owner_id: owner.user.id, medium });
    assert.ok(error, `expected medium "${medium}" to be rejected`);
  }
});

void test('a ticket cannot name both a registered assignee and an external companion', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(owner, occurrence.id, { status: 'secured' });
  const { error } = await owner.client.from('tickets').insert({
    acquisition_id: acquisition.id,
    owner_id: owner.user.id,
    assigned_to_user_id: companion.user.id,
    assignee_external_name: '別の同行者',
  });
  assert.ok(error, 'expected a check constraint violation for a double assignment');
});

void test('a blank external companion name is not a third assignment state', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(owner, occurrence.id, { status: 'secured' });
  for (const name of ['', '   ']) {
    const { error } = await owner.client.from('tickets').insert({
      acquisition_id: acquisition.id,
      owner_id: owner.user.id,
      assignee_external_name: name,
    });
    assert.ok(
      error,
      `expected a blank external assignee name (${JSON.stringify(name)}) to be rejected`,
    );
  }
});

// --- Negative: assignment confers no authority ---

void test('an assigned registered user cannot read the ticket', async () => {
  const { ticket } = await createSecuredTicket(owner, catalogOwner, {
    assignedToUserId: companion.user.id,
  });
  const { data, error } = await companion.client.from('tickets').select().eq('id', ticket.id);
  assert.equal(error, null);
  assert.deepEqual(data, [], 'assignment is not a read grant');
});

void test('an assigned registered user cannot edit the ticket', async () => {
  const { ticket } = await createSecuredTicket(owner, catalogOwner, {
    assignedToUserId: companion.user.id,
  });
  const { data, error } = await companion.client
    .from('tickets')
    .update({ seat_label: 'hijacked' })
    .eq('id', ticket.id)
    .select();
  assert.equal(error, null);
  assert.deepEqual(data, []);

  const stored = await readTicketAsAdmin(ticket.id);
  assert.equal(stored.seat_label, null);
});

void test('an unrelated authenticated user cannot read or edit a ticket', async () => {
  const { ticket } = await createSecuredTicket(owner, catalogOwner);

  const { data: read, error: readError } = await companion.client
    .from('tickets')
    .select()
    .eq('id', ticket.id);
  assert.equal(readError, null);
  assert.deepEqual(read, []);

  const { data: updated, error: updateError } = await companion.client
    .from('tickets')
    .update({ medium: 'paper' })
    .eq('id', ticket.id)
    .select();
  assert.equal(updateError, null);
  assert.deepEqual(updated, []);
});

void test('the occurrence’s event owner cannot read tickets acquired for it', async () => {
  const { ticket } = await createSecuredTicket(owner, catalogOwner);
  const { data, error } = await catalogOwner.client.from('tickets').select().eq('id', ticket.id);
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

// --- Negative: anonymous ---

void test('anonymous cannot read tickets', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.from('tickets').select();
  assert.ok(error, 'expected a permission error for anonymous select');
});

void test('anonymous cannot insert tickets', async () => {
  const { acquisition } = await createSecuredTicket(owner, catalogOwner);
  const anon = createAnonymousClient();
  const { error } = await anon
    .from('tickets')
    .insert({ acquisition_id: acquisition.id, owner_id: owner.user.id });
  assert.ok(error, 'expected a permission error for anonymous insert');
});

void test('anonymous cannot update or delete tickets', async () => {
  const { ticket } = await createSecuredTicket(owner, catalogOwner);
  const anon = createAnonymousClient();

  const { error: updateError } = await anon
    .from('tickets')
    .update({ seat_label: 'anon' })
    .eq('id', ticket.id);
  assert.ok(updateError, 'expected a permission error for anonymous update');

  const { error: deleteError } = await anon.from('tickets').delete().eq('id', ticket.id);
  assert.ok(deleteError, 'expected a permission error for anonymous delete');
});

// --- Negative: immutable / system-managed fields ---

void test('a ticket owner cannot move ownership directly', async () => {
  const { ticket } = await createSecuredTicket(owner, catalogOwner);
  const { error } = await owner.client
    .from('tickets')
    .update({ owner_id: companion.user.id })
    .eq('id', ticket.id);
  assert.ok(error, 'expected a permission error for changing owner_id outside the transfer RPC');

  const stored = await readTicketAsAdmin(ticket.id);
  assert.equal(stored.owner_id, owner.user.id);
});

void test('a ticket cannot be re-pointed at a different acquisition', async () => {
  const { ticket } = await createSecuredTicket(owner, catalogOwner);
  const { acquisition: otherAcquisition } = await createSecuredTicket(owner, catalogOwner);

  const { error } = await owner.client
    .from('tickets')
    .update({ acquisition_id: otherAcquisition.id })
    .eq('id', ticket.id);
  assert.ok(
    error,
    'expected a permission error for changing acquisition_id, even to another acquisition the same user owns',
  );
});

void test('normal client cannot mutate id or created_at', async () => {
  const { ticket } = await createSecuredTicket(owner, catalogOwner);

  const { error: idError } = await owner.client
    .from('tickets')
    .update({ id: crypto.randomUUID() })
    .eq('id', ticket.id);
  assert.ok(idError, 'expected a permission error for changing id');

  const { error: createdAtError } = await owner.client
    .from('tickets')
    .update({ created_at: new Date(0).toISOString() })
    .eq('id', ticket.id);
  assert.ok(createdAtError, 'expected a permission error for changing created_at');
});

void test('updated_at is DB-managed and not settable by a normal client', async () => {
  const { ticket } = await createSecuredTicket(owner, catalogOwner);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const { data, error } = await owner.client
    .from('tickets')
    .update({ queue_number: 'B-1' })
    .eq('id', ticket.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.ok(
    new Date(data.updated_at).getTime() > new Date(ticket.updated_at).getTime(),
    'expected updated_at to advance on a real update',
  );

  const { error: setError } = await owner.client
    .from('tickets')
    .update({ updated_at: new Date(0).toISOString() })
    .eq('id', ticket.id);
  assert.ok(setError, 'expected a permission error for setting updated_at directly');
});

// --- Negative: DELETE unsupported ---

void test('the owner cannot delete a ticket', async () => {
  const { ticket } = await createSecuredTicket(owner, catalogOwner);
  const { error } = await owner.client.from('tickets').delete().eq('id', ticket.id);
  assert.ok(error, 'expected DELETE to be unsupported for a normal authenticated client');
});
