import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  createAcquisition,
  listMyAcquisitions,
  updateAcquisition,
} from '../../src/infrastructure/supabase/ticketAcquisition.ts';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';
import { createEventWithOccurrence } from './support/eventFixtures.ts';

// Real local Supabase/RLS tests for the ticket acquisition typed boundary
// (Issue #33), over public.ticket_acquisitions (Issue #32). Unlike
// test/rls/ticketAcquisitions.test.ts, which exercises the raw RLS policies
// directly, this file exercises src/infrastructure/supabase/
// ticketAcquisition.ts.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let catalogOwner: TestActor;
let actorA: TestActor;
let actorB: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  catalogOwner = await createTestActor('rls-typed-acq-catalog', PASSWORD, {
    designatedCatalogCreator: true,
  });
  createdActors.push(catalogOwner);
  actorA = await createTestActor('rls-typed-acq-a', PASSWORD);
  createdActors.push(actorA);
  actorB = await createTestActor('rls-typed-acq-b', PASSWORD);
  createdActors.push(actorB);
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

async function occurrenceId(): Promise<string> {
  const { occurrence } = await createEventWithOccurrence(catalogOwner);
  return occurrence.id;
}

void test('createAcquisition defaults to pending when no status is given', async () => {
  const occurrence = await occurrenceId();
  const result = await createAcquisition(actorA.client, occurrence);
  assert.equal(result.ok, true);
  assert.equal(result.data.status, 'pending');
  assert.equal(result.data.ownerId, actorA.user.id);
});

void test('createAcquisition can be created directly as secured, with a memo', async () => {
  const occurrence = await occurrenceId();
  const result = await createAcquisition(actorA.client, occurrence, {
    status: 'secured',
    memo: 'won the lottery',
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.status, 'secured');
  assert.equal(result.data.memo, 'won the lottery');
});

void test('listMyAcquisitions returns only the caller’s own, optionally scoped to one occurrence', async () => {
  const occurrenceOne = await occurrenceId();
  const occurrenceTwo = await occurrenceId();
  await createAcquisition(actorA.client, occurrenceOne);
  await createAcquisition(actorA.client, occurrenceTwo);
  await createAcquisition(actorB.client, occurrenceOne);

  const allMine = await listMyAcquisitions(actorA.client);
  assert.equal(allMine.ok, true);
  assert.ok(allMine.data.every((a) => a.ownerId === actorA.user.id));
  assert.ok(allMine.data.some((a) => a.occurrenceId === occurrenceOne));
  assert.ok(allMine.data.some((a) => a.occurrenceId === occurrenceTwo));

  const scoped = await listMyAcquisitions(actorA.client, occurrenceOne);
  assert.equal(scoped.ok, true);
  assert.ok(scoped.data.every((a) => a.occurrenceId === occurrenceOne));
});

void test('updateAcquisition lets the owner change status and memo', async () => {
  const occurrence = await occurrenceId();
  const created = await createAcquisition(actorA.client, occurrence);
  assert.equal(created.ok, true);

  const updated = await updateAcquisition(actorA.client, created.data.id, {
    status: 'secured',
    memo: 'confirmed',
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.data.status, 'secured');
  assert.equal(updated.data.memo, 'confirmed');
});

void test('updateAcquisition reports not-found for another caller’s acquisition', async () => {
  const occurrence = await occurrenceId();
  const created = await createAcquisition(actorA.client, occurrence);
  assert.equal(created.ok, true);

  const result = await updateAcquisition(actorB.client, created.data.id, {
    status: 'unsuccessful',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'not-found');
});

void test('updateAcquisition reports not-found for a nonexistent id', async () => {
  const result = await updateAcquisition(actorA.client, '00000000-0000-0000-0000-000000000000', {
    status: 'secured',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'not-found');
});

void test('createAcquisition reports unauthenticated for a client with no session', async () => {
  const occurrence = await occurrenceId();
  const anonymous = createAnonymousClient();
  const result = await createAcquisition(anonymous, occurrence);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'unauthenticated');
});
