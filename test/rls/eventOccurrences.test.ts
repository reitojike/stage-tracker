import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';
import { createEventWithOccurrence } from './support/eventFixtures.ts';

// Real local Supabase/Postgres RLS tests for public.event_occurrences
// (Issue #17). Occurrences have no independent owner: create/update
// permission is derived entirely from the parent event's owner_id. See
// test/rls/events.test.ts for the parent event's own RLS/create-boundary
// tests, and its header comment for the anon/service_role/authenticated
// client conventions used throughout.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let actorA: TestActor;
let actorB: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  actorA = await createTestActor('rls-occ-owner', PASSWORD);
  createdActors.push(actorA);
  actorB = await createTestActor('rls-occ-other', PASSWORD);
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

// --- Positive ---

void test('authenticated user can read another owner’s occurrence', async () => {
  const { occurrence } = await createEventWithOccurrence(actorA);
  const { data, error } = await actorB.client
    .from('event_occurrences')
    .select()
    .eq('id', occurrence.id);
  assert.equal(error, null);
  assert.equal(data.length, 1);
});

void test('parent event owner can insert an additional occurrence', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await actorA.client
    .from('event_occurrences')
    .insert({ event_id: event.id, starts_at: startsAt })
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.event_id, event.id);
  // Postgres/PostgREST render timestamptz as "+00:00", not "Z" - normalize
  // through Date before comparing, since both spellings mean the same
  // instant.
  assert.equal(new Date(data.starts_at).toISOString(), startsAt);
  assert.equal(data.ends_at, null);
});

void test('parent event owner can update an occurrence’s time', async () => {
  const { occurrence } = await createEventWithOccurrence(actorA);
  const newStartsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { data, error } = await actorA.client
    .from('event_occurrences')
    .update({ starts_at: newStartsAt })
    .eq('id', occurrence.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(new Date(data.starts_at).toISOString(), newStartsAt);
});

// --- Negative: anonymous ---

void test('anonymous cannot read occurrences', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.from('event_occurrences').select();
  assert.ok(error, 'expected a permission error for anonymous select');
});

void test('anonymous cannot insert occurrences', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const anon = createAnonymousClient();
  const { error } = await anon
    .from('event_occurrences')
    .insert({ event_id: event.id, starts_at: new Date().toISOString() });
  assert.ok(error, 'expected a permission error for anonymous insert');
});

void test('anonymous cannot update occurrences', async () => {
  const { occurrence } = await createEventWithOccurrence(actorA);
  const anon = createAnonymousClient();
  const { error } = await anon
    .from('event_occurrences')
    .update({ starts_at: new Date().toISOString() })
    .eq('id', occurrence.id);
  assert.ok(error, 'expected a permission error for anonymous update');
});

void test('anonymous cannot delete occurrences', async () => {
  const { occurrence } = await createEventWithOccurrence(actorA);
  const anon = createAnonymousClient();
  const { error } = await anon.from('event_occurrences').delete().eq('id', occurrence.id);
  assert.ok(error, 'expected a permission error for anonymous delete');
});

// --- Negative: ownership ---

void test('non-owner cannot insert an occurrence for someone else’s event', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const { error } = await actorB.client
    .from('event_occurrences')
    .insert({ event_id: event.id, starts_at: new Date().toISOString() });
  assert.ok(error, 'expected an RLS violation for a non-owner inserting an occurrence');
});

void test('non-owner cannot update an occurrence, and the row stays unchanged', async () => {
  const { occurrence } = await createEventWithOccurrence(actorA);

  const { data: updateData, error: updateError } = await actorB.client
    .from('event_occurrences')
    .update({ starts_at: new Date(0).toISOString() })
    .eq('id', occurrence.id)
    .select();
  assert.equal(updateError, null);
  assert.deepEqual(updateData, []);

  const { data: refetched, error: refetchError } = await actorA.client
    .from('event_occurrences')
    .select()
    .eq('id', occurrence.id)
    .single();
  assert.equal(refetchError, null);
  assert.equal(refetched.starts_at, occurrence.starts_at);
});

void test('occurrence cannot be reassigned to a different parent event', async () => {
  const { event: eventA, occurrence } = await createEventWithOccurrence(actorA);
  const { event: eventA2 } = await createEventWithOccurrence(actorA);

  const { error } = await actorA.client
    .from('event_occurrences')
    .update({ event_id: eventA2.id })
    .eq('id', occurrence.id);
  assert.ok(
    error,
    'expected a permission error for reassigning event_id, even to another event the same owner owns',
  );

  const { data: refetched } = await actorA.client
    .from('event_occurrences')
    .select()
    .eq('id', occurrence.id)
    .single();
  assert.equal(refetched?.event_id, eventA.id);
});

// --- Negative: system-managed fields ---

void test('normal client cannot mutate id', async () => {
  const { occurrence } = await createEventWithOccurrence(actorA);
  const { error } = await actorA.client
    .from('event_occurrences')
    .update({ id: crypto.randomUUID() })
    .eq('id', occurrence.id);
  assert.ok(error, 'expected a permission error for changing id');
});

void test('normal client cannot mutate created_at', async () => {
  const { occurrence } = await createEventWithOccurrence(actorA);
  const { error } = await actorA.client
    .from('event_occurrences')
    .update({ created_at: new Date(0).toISOString() })
    .eq('id', occurrence.id);
  assert.ok(error, 'expected a permission error for changing created_at');
});

void test('updated_at is DB-managed on a real update', async () => {
  const { occurrence } = await createEventWithOccurrence(actorA);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const { data, error } = await actorA.client
    .from('event_occurrences')
    .update({ starts_at: new Date().toISOString() })
    .eq('id', occurrence.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.ok(data);
  assert.notEqual(data.updated_at, occurrence.updated_at);
  assert.ok(new Date(data.updated_at).getTime() > new Date(occurrence.updated_at).getTime());
});

void test('normal client cannot set updated_at directly', async () => {
  const { occurrence } = await createEventWithOccurrence(actorA);
  const { error } = await actorA.client
    .from('event_occurrences')
    .update({ updated_at: new Date(0).toISOString() })
    .eq('id', occurrence.id);
  assert.ok(error, 'expected a permission error for setting updated_at directly');
});

// --- Negative: DELETE unsupported ---

void test('owner cannot delete an occurrence', async () => {
  const { occurrence } = await createEventWithOccurrence(actorA);
  const { error } = await actorA.client.from('event_occurrences').delete().eq('id', occurrence.id);
  assert.ok(error, 'expected DELETE to be unsupported for a normal authenticated client');
});
