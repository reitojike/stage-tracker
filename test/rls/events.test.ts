import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';

// Real local Supabase/Postgres RLS tests for public.events (Issue #3 / PR
// B). Every assertion below runs as an anon-key client with no session
// (anonymous), or an anon-key client signed in as a real test user
// (authenticated) - never as service_role. service_role is used only in
// ./support/testActors.ts to create/delete the fixture users themselves.
//
// A denied UPDATE is not always a request error: when RLS's USING clause
// filters a row out of visibility for the caller, the UPDATE simply matches
// zero rows and returns successfully with empty data. A denied INSERT (RLS
// WITH CHECK failure) and a denied column mutation (missing column
// privilege) do surface as request errors. Each test below asserts the
// actual observed shape for its case, not just "an error happened".

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let actorA: TestActor;
let actorB: TestActor;
// Tracks only the actors setup actually finished creating, independent of
// actorA/actorB's declared (always-defined-by-test-time) type, so a partial
// `before()` failure doesn't make cleanup dereference an uncreated actor.
const createdActors: TestActor[] = [];

before(async () => {
  actorA = await createTestActor('rls-owner', PASSWORD);
  createdActors.push(actorA);
  actorB = await createTestActor('rls-other', PASSWORD);
  createdActors.push(actorB);
});

after(async () => {
  // Don't let one actor's cleanup failure prevent the other's from being
  // attempted.
  await Promise.all(
    createdActors.map((actor) =>
      deleteTestActor(actor).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`cleanup failed for test user ${actor.user.id}: ${message}`);
      }),
    ),
  );
});

function eventPayload(ownerId: string) {
  return {
    owner_id: ownerId,
    title: `rls test event ${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    starts_at: new Date().toISOString(),
  };
}

async function insertAsOwner(actor: TestActor) {
  const { data, error } = await actor.client
    .from('events')
    .insert(eventPayload(actor.user.id))
    .select()
    .single();
  if (error) {
    throw new Error(`setup insert failed: ${error.message}`);
  }
  return data;
}

// --- Positive ---

void test('authenticated user creates their own event', async () => {
  const { data, error } = await actorA.client
    .from('events')
    .insert(eventPayload(actorA.user.id))
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.owner_id, actorA.user.id);
});

void test('authenticated user can read another user’s event', async () => {
  const created = await insertAsOwner(actorA);
  const { data, error } = await actorB.client.from('events').select().eq('id', created.id);
  assert.equal(error, null);
  assert.equal(data.length, 1);
  const [row] = data;
  assert.ok(row);
  assert.equal(row.id, created.id);
});

void test('owner can update mutable event information', async () => {
  const created = await insertAsOwner(actorA);
  const { data, error } = await actorA.client
    .from('events')
    .update({ title: 'updated title' })
    .eq('id', created.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.title, 'updated title');
});

// --- Negative: anonymous ---

void test('anonymous cannot read events', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.from('events').select();
  assert.ok(error, 'expected a permission error for anonymous select');
});

void test('anonymous cannot create events', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.from('events').insert(eventPayload(actorA.user.id));
  assert.ok(error, 'expected a permission error for anonymous insert');
});

void test('anonymous cannot update events', async () => {
  const created = await insertAsOwner(actorA);
  const anon = createAnonymousClient();
  const { error } = await anon.from('events').update({ title: 'anon edit' }).eq('id', created.id);
  assert.ok(error, 'expected a permission error for anonymous update');
});

void test('anonymous cannot delete events', async () => {
  const created = await insertAsOwner(actorA);
  const anon = createAnonymousClient();
  const { error } = await anon.from('events').delete().eq('id', created.id);
  assert.ok(error, 'expected a permission error for anonymous delete');
});

// --- Negative: ownership ---

void test('user A cannot create an event owned by user B', async () => {
  const { error } = await actorA.client.from('events').insert(eventPayload(actorB.user.id));
  assert.ok(error, 'expected an RLS violation for owner spoofing');
});

void test('user B cannot update user A’s event, and the row stays unchanged', async () => {
  const created = await insertAsOwner(actorA);

  const { data: updateData, error: updateError } = await actorB.client
    .from('events')
    .update({ title: 'hijacked title' })
    .eq('id', created.id)
    .select();
  assert.equal(updateError, null);
  assert.deepEqual(updateData, []);

  const { data: refetched, error: refetchError } = await actorA.client
    .from('events')
    .select()
    .eq('id', created.id)
    .single();
  assert.equal(refetchError, null);
  assert.equal(refetched.title, created.title);
});

void test('owner cannot transfer ownership to another user', async () => {
  const created = await insertAsOwner(actorA);
  const { error } = await actorA.client
    .from('events')
    .update({ owner_id: actorB.user.id })
    .eq('id', created.id);
  assert.ok(error, 'expected a permission error for changing owner_id');

  const { data: refetched } = await actorA.client
    .from('events')
    .select()
    .eq('id', created.id)
    .single();
  assert.equal(refetched?.owner_id, actorA.user.id);
});

// --- Negative: system-managed fields ---

void test('normal client cannot mutate id', async () => {
  const created = await insertAsOwner(actorA);
  const { error } = await actorA.client
    .from('events')
    .update({ id: crypto.randomUUID() })
    .eq('id', created.id);
  assert.ok(error, 'expected a permission error for changing id');
});

void test('normal client cannot mutate created_at', async () => {
  const created = await insertAsOwner(actorA);
  const { error } = await actorA.client
    .from('events')
    .update({ created_at: new Date(0).toISOString() })
    .eq('id', created.id);
  assert.ok(error, 'expected a permission error for changing created_at');
});

void test('updated_at is DB-managed on a real update', async () => {
  const created = await insertAsOwner(actorA);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const { data, error } = await actorA.client
    .from('events')
    .update({ title: 'trigger updated_at' })
    .eq('id', created.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.ok(data);
  assert.notEqual(data.updated_at, created.updated_at);
  assert.ok(new Date(data.updated_at).getTime() > new Date(created.updated_at).getTime());
});

void test('normal client cannot set updated_at directly', async () => {
  const created = await insertAsOwner(actorA);
  const { error } = await actorA.client
    .from('events')
    .update({ updated_at: new Date(0).toISOString() })
    .eq('id', created.id);
  assert.ok(error, 'expected a permission error for setting updated_at directly');
});

// --- Negative: DELETE unsupported ---

void test('owner cannot delete an event', async () => {
  const created = await insertAsOwner(actorA);
  const { error } = await actorA.client.from('events').delete().eq('id', created.id);
  assert.ok(error, 'expected DELETE to be unsupported for a normal authenticated client');
});
