import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  getMyParticipation,
  getMyParticipationsForOccurrences,
  listMyParticipations,
  listVisibleParticipationsForOccurrence,
  setParticipation,
  withdrawParticipation,
} from '../../src/infrastructure/supabase/participation.ts';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';
import { createEventWithOccurrence } from './support/eventFixtures.ts';

// Real local Supabase/RLS tests for the participation typed boundary
// (Issue #33), over public.occurrence_participations (Issue #30). Unlike
// test/rls/occurrenceParticipations.test.ts, which exercises the table's raw
// RLS policies directly, this file exercises src/infrastructure/supabase/
// participation.ts - proving the typed functions the UI will actually call
// (#34-#37) carry the same guarantees through to a PlanningResult a caller
// can safely branch on, not just that the underlying policies work.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let catalogOwner: TestActor;
let actorA: TestActor;
let actorB: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  catalogOwner = await createTestActor('rls-typed-part-catalog', PASSWORD, {
    designatedCatalogCreator: true,
  });
  createdActors.push(catalogOwner);
  actorA = await createTestActor('rls-typed-part-a', PASSWORD);
  createdActors.push(actorA);
  actorB = await createTestActor('rls-typed-part-b', PASSWORD);
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

void test('setParticipation creates a considering row, defaulting visibility to private', async () => {
  const occurrence = await occurrenceId();
  const result = await setParticipation(actorA.client, occurrence, { status: 'considering' });
  assert.equal(result.ok, true);
  assert.equal(result.data.occurrenceId, occurrence);
  assert.equal(result.data.status, 'considering');
  assert.equal(result.data.visibility, 'private');
});

void test('setParticipation upserts an existing row to attending, and public visibility', async () => {
  const occurrence = await occurrenceId();
  await setParticipation(actorA.client, occurrence, { status: 'considering' });
  const updated = await setParticipation(actorA.client, occurrence, {
    status: 'attending',
    visibility: 'public',
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.data.status, 'attending');
  assert.equal(updated.data.visibility, 'public');

  const mine = await getMyParticipation(actorA.client, occurrence);
  assert.equal(mine.ok, true);
  assert.equal(mine.data?.id, updated.data.id);
});

void test('getMyParticipation returns ok:true, data:null when the caller has none - not an error', async () => {
  const occurrence = await occurrenceId();
  const result = await getMyParticipation(actorA.client, occurrence);
  assert.deepEqual(result, { ok: true, data: null });
});

void test('listMyParticipations returns only the caller’s own rows across occurrences', async () => {
  const occurrenceOne = await occurrenceId();
  const occurrenceTwo = await occurrenceId();
  await setParticipation(actorA.client, occurrenceOne, { status: 'considering' });
  await setParticipation(actorA.client, occurrenceTwo, { status: 'attending' });
  await setParticipation(actorB.client, occurrenceOne, { status: 'attending' });

  const mine = await listMyParticipations(actorA.client);
  assert.equal(mine.ok, true);
  const occurrenceIds = mine.data.map((p) => p.occurrenceId).sort();
  assert.ok(occurrenceIds.includes(occurrenceOne));
  assert.ok(occurrenceIds.includes(occurrenceTwo));
  assert.ok(mine.data.every((p) => p.userId === actorA.user.id));
});

void test('listVisibleParticipationsForOccurrence shows a stranger only public rows, never a private one', async () => {
  const occurrence = await occurrenceId();
  await setParticipation(actorA.client, occurrence, { status: 'attending', visibility: 'private' });
  await setParticipation(actorB.client, occurrence, { status: 'attending', visibility: 'public' });

  const visibleToB = await listVisibleParticipationsForOccurrence(actorB.client, occurrence);
  assert.equal(visibleToB.ok, true);
  const userIds = visibleToB.data.map((p) => p.userId);
  assert.ok(userIds.includes(actorB.user.id), 'actorB always sees their own row');
  assert.ok(!userIds.includes(actorA.user.id), 'actorB must not see actorA’s private row');
});

void test('withdrawParticipation removes the caller’s own row', async () => {
  const occurrence = await occurrenceId();
  const created = await setParticipation(actorA.client, occurrence, { status: 'considering' });
  assert.equal(created.ok, true);

  const withdrawn = await withdrawParticipation(actorA.client, created.data.id);
  assert.deepEqual(withdrawn, { ok: true, data: undefined });

  const afterWithdraw = await getMyParticipation(actorA.client, occurrence);
  assert.deepEqual(afterWithdraw, { ok: true, data: null });
});

void test('withdrawParticipation reports not-found for a row that is not the caller’s own', async () => {
  const occurrence = await occurrenceId();
  const bsParticipation = await setParticipation(actorB.client, occurrence, {
    status: 'attending',
    visibility: 'public',
  });
  assert.equal(bsParticipation.ok, true);

  // actorA can see this row (it is public), but withdrawParticipation scopes
  // the delete to the caller's own user_id, so this must not remove it.
  const result = await withdrawParticipation(actorA.client, bsParticipation.data.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'not-found');

  const stillThere = await getMyParticipation(actorB.client, occurrence);
  assert.equal(stillThere.ok, true);
  assert.equal(stillThere.data?.id, bsParticipation.data.id);
});

void test('withdrawParticipation reports not-found for a nonexistent id', async () => {
  const result = await withdrawParticipation(actorA.client, '00000000-0000-0000-0000-000000000000');
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'not-found');
});

// --- getMyParticipationsForOccurrences (Issue #36 batched read) ---

void test('getMyParticipationsForOccurrences returns only the caller’s own rows, keyed by occurrence id, with none for a row-less occurrence', async () => {
  const withRow = await occurrenceId();
  const withoutRow = await occurrenceId();
  await setParticipation(actorA.client, withRow, { status: 'attending' });
  await setParticipation(actorB.client, withoutRow, { status: 'attending' });

  const result = await getMyParticipationsForOccurrences(actorA.client, [withRow, withoutRow]);
  assert.equal(result.ok, true);
  assert.equal(result.data.size, 1);
  assert.equal(result.data.get(withRow)?.status, 'attending');
  assert.equal(result.data.get(withoutRow), undefined);
});

void test('getMyParticipationsForOccurrences matches getMyParticipation for the same occurrence', async () => {
  const occurrence = await occurrenceId();
  await setParticipation(actorA.client, occurrence, { status: 'considering' });

  const single = await getMyParticipation(actorA.client, occurrence);
  const batched = await getMyParticipationsForOccurrences(actorA.client, [occurrence]);
  assert.equal(single.ok, true);
  assert.equal(batched.ok, true);
  assert.deepEqual(batched.data.get(occurrence), single.data);
});

void test('getMyParticipationsForOccurrences returns an empty map for an empty occurrence list', async () => {
  const result = await getMyParticipationsForOccurrences(actorA.client, []);
  assert.deepEqual(result, { ok: true, data: new Map() });
});

void test('getMyParticipationsForOccurrences reports unauthenticated for a client with no session', async () => {
  const anonymous = createAnonymousClient();
  const occurrence = await occurrenceId();
  const result = await getMyParticipationsForOccurrences(anonymous, [occurrence]);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'unauthenticated');
});

void test('setParticipation reports unauthenticated for a client with no session', async () => {
  const anonymous = createAnonymousClient();
  const occurrence = await occurrenceId();
  const result = await setParticipation(anonymous, occurrence, { status: 'considering' });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'unauthenticated');
});
