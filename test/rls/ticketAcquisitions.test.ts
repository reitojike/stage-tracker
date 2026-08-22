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
  readAcquisitionAsAdmin,
} from './support/ticketFixtures.ts';

// Real local Supabase/Postgres RLS tests for public.ticket_acquisitions
// (Issue #32). Unlike events / event_occurrences, an acquisition is a
// personal concept: it is readable only by its owner, not by every
// authenticated user. See test/rls/events.test.ts for the
// anon/service_role/authenticated client conventions used throughout.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let catalogOwner: TestActor;
let acquirer: TestActor;
let otherUser: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  catalogOwner = await createTestActor('rls-acq-catalog', PASSWORD, {
    designatedCatalogCreator: true,
  });
  createdActors.push(catalogOwner);
  acquirer = await createTestActor('rls-acq-owner', PASSWORD);
  createdActors.push(acquirer);
  otherUser = await createTestActor('rls-acq-other', PASSWORD);
  createdActors.push(otherUser);
});

after(async () => {
  await deleteTestActorsSequentially(createdActors);
});

// --- Positive: lifecycle ---

void test('a user can create an acquisition for another owner’s occurrence, defaulting to pending', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(acquirer, occurrence.id);
  assert.equal(acquisition.owner_id, acquirer.user.id);
  assert.equal(acquisition.occurrence_id, occurrence.id);
  assert.equal(acquisition.status, 'pending');
  assert.equal(acquisition.memo, null);
});

void test('an immediate purchase can be created directly as secured', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(acquirer, occurrence.id, { status: 'secured' });
  assert.equal(acquisition.status, 'secured');
});

void test('the same user can hold several acquisition attempts for one occurrence', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const first = await createAcquisition(acquirer, occurrence.id);
  const second = await createAcquisition(acquirer, occurrence.id);
  const third = await createAcquisition(acquirer, occurrence.id, { status: 'unsuccessful' });
  assert.notEqual(first.id, second.id);

  const { data, error } = await acquirer.client
    .from('ticket_acquisitions')
    .select()
    .eq('occurrence_id', occurrence.id);
  assert.equal(error, null);
  assert.equal(data.length, 3);
  assert.deepEqual(data.map((row) => row.id).sort(), [first.id, second.id, third.id].sort());
});

void test('the owner can move an acquisition through the pending -> secured lifecycle', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(acquirer, occurrence.id);

  const { data, error } = await acquirer.client
    .from('ticket_acquisitions')
    .update({ status: 'secured' })
    .eq('id', acquisition.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.status, 'secured');
});

void test('the owner can mark an acquisition unsuccessful', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(acquirer, occurrence.id);

  const { data, error } = await acquirer.client
    .from('ticket_acquisitions')
    .update({ status: 'unsuccessful' })
    .eq('id', acquisition.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.status, 'unsuccessful');
});

void test('the owner can set and change the acquisition-level memo', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(acquirer, occurrence.id, { memo: '先行抽選' });
  assert.equal(acquisition.memo, '先行抽選');

  const { data, error } = await acquirer.client
    .from('ticket_acquisitions')
    .update({ memo: '一般発売' })
    .eq('id', acquisition.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.memo, '一般発売');
});

// --- Negative: status vocabulary ---

void test('acquisition status is limited to the MVP vocabulary', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  for (const status of ['cancelled', 'withdrawn', 'refunded', 'attending', '']) {
    const { error } = await acquirer.client.from('ticket_acquisitions').insert({
      owner_id: acquirer.user.id,
      occurrence_id: occurrence.id,
      status,
    });
    assert.ok(error, `expected status "${status}" to be rejected`);
  }
});

void test('an existing acquisition cannot be updated to a status outside the vocabulary', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(acquirer, occurrence.id, { status: 'secured' });

  const { error } = await acquirer.client
    .from('ticket_acquisitions')
    .update({ status: 'refunded' })
    .eq('id', acquisition.id);
  assert.ok(error, 'expected a check constraint violation for an out-of-vocabulary status');

  const stored = await readAcquisitionAsAdmin(acquisition.id);
  assert.equal(stored.status, 'secured');
});

// --- Negative: privacy ---

void test('another authenticated user cannot read someone else’s acquisition', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(acquirer, occurrence.id);

  const { data, error } = await otherUser.client
    .from('ticket_acquisitions')
    .select()
    .eq('id', acquisition.id);
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

void test('the occurrence’s event owner cannot read acquisitions made against it', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(acquirer, occurrence.id);

  const { data, error } = await catalogOwner.client
    .from('ticket_acquisitions')
    .select()
    .eq('id', acquisition.id);
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

void test('another authenticated user cannot update someone else’s acquisition', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(acquirer, occurrence.id);

  const { data, error } = await otherUser.client
    .from('ticket_acquisitions')
    .update({ status: 'unsuccessful' })
    .eq('id', acquisition.id)
    .select();
  assert.equal(error, null);
  assert.deepEqual(data, []);

  const stored = await readAcquisitionAsAdmin(acquisition.id);
  assert.equal(stored.status, 'pending');
});

void test('a user cannot create an acquisition owned by someone else', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const { error } = await otherUser.client.from('ticket_acquisitions').insert({
    owner_id: acquirer.user.id,
    occurrence_id: occurrence.id,
  });
  assert.ok(error, 'expected an RLS violation for owner spoofing on insert');
});

// --- Negative: anonymous ---

void test('anonymous cannot read acquisitions', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.from('ticket_acquisitions').select();
  assert.ok(error, 'expected a permission error for anonymous select');
});

void test('anonymous cannot insert acquisitions', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const anon = createAnonymousClient();
  const { error } = await anon
    .from('ticket_acquisitions')
    .insert({ owner_id: acquirer.user.id, occurrence_id: occurrence.id });
  assert.ok(error, 'expected a permission error for anonymous insert');
});

void test('anonymous cannot update acquisitions', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(acquirer, occurrence.id);
  const anon = createAnonymousClient();
  const { error } = await anon
    .from('ticket_acquisitions')
    .update({ status: 'secured' })
    .eq('id', acquisition.id);
  assert.ok(error, 'expected a permission error for anonymous update');
});

void test('anonymous cannot delete acquisitions', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(acquirer, occurrence.id);
  const anon = createAnonymousClient();
  const { error } = await anon.from('ticket_acquisitions').delete().eq('id', acquisition.id);
  assert.ok(error, 'expected a permission error for anonymous delete');
});

// --- Negative: immutable / system-managed fields ---

void test('an acquisition cannot be handed to another user', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(acquirer, occurrence.id);

  const { error } = await acquirer.client
    .from('ticket_acquisitions')
    .update({ owner_id: otherUser.user.id })
    .eq('id', acquisition.id);
  assert.ok(error, 'expected a permission error for changing owner_id');

  const stored = await readAcquisitionAsAdmin(acquisition.id);
  assert.equal(stored.owner_id, acquirer.user.id);
});

void test('an acquisition cannot be re-pointed at a different occurrence', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const { occurrence: otherOccurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(acquirer, occurrence.id);

  const { error } = await acquirer.client
    .from('ticket_acquisitions')
    .update({ occurrence_id: otherOccurrence.id })
    .eq('id', acquisition.id);
  assert.ok(error, 'expected a permission error for changing occurrence_id');

  const stored = await readAcquisitionAsAdmin(acquisition.id);
  assert.equal(stored.occurrence_id, occurrence.id);
});

void test('normal client cannot mutate id or created_at', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(acquirer, occurrence.id);

  const { error: idError } = await acquirer.client
    .from('ticket_acquisitions')
    .update({ id: crypto.randomUUID() })
    .eq('id', acquisition.id);
  assert.ok(idError, 'expected a permission error for changing id');

  const { error: createdAtError } = await acquirer.client
    .from('ticket_acquisitions')
    .update({ created_at: new Date(0).toISOString() })
    .eq('id', acquisition.id);
  assert.ok(createdAtError, 'expected a permission error for changing created_at');
});

void test('updated_at is DB-managed and not settable by a normal client', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(acquirer, occurrence.id);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const { data, error } = await acquirer.client
    .from('ticket_acquisitions')
    .update({ status: 'secured' })
    .eq('id', acquisition.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.ok(
    new Date(data.updated_at).getTime() > new Date(acquisition.updated_at).getTime(),
    'expected updated_at to advance on a real update',
  );

  const { error: setError } = await acquirer.client
    .from('ticket_acquisitions')
    .update({ updated_at: new Date(0).toISOString() })
    .eq('id', acquisition.id);
  assert.ok(setError, 'expected a permission error for setting updated_at directly');
});

// --- Negative: DELETE unsupported ---

void test('the owner cannot delete an acquisition', async () => {
  const { occurrence } = await createOccurrence(catalogOwner);
  const acquisition = await createAcquisition(acquirer, occurrence.id);

  const { error } = await acquirer.client
    .from('ticket_acquisitions')
    .delete()
    .eq('id', acquisition.id);
  assert.ok(error, 'expected DELETE to be unsupported for a normal authenticated client');
});
