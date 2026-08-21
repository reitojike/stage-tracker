import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import pg from 'pg';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';
import {
  callCreateEventRpcRaw,
  createEventWithOccurrence,
  eventFixtureTitle,
} from './support/eventFixtures.ts';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';

// Real local Supabase/Postgres RLS tests for public.events (Issue #3 / PR
// B, extended by Issue #17). Every assertion below runs as an anon-key
// client with no session (anonymous), or an anon-key client signed in as a
// real test user (authenticated) - never as service_role. service_role is
// used only in ./support/testActors.ts to create/delete the fixture users
// themselves.
//
// Since Issue #17, direct authenticated INSERT into events is revoked:
// create_event_with_occurrence (test/rls/support/eventFixtures.ts) is the
// only supported create path, and is what every fixture event below goes
// through.
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
  // actorA is a designated catalog creator because it produces every
  // fixture event below; actorB deliberately is not, so the non-owner and
  // non-creator denials it proves cannot pass for the wrong reason.
  actorA = await createTestActor('rls-owner', PASSWORD, { designatedCatalogCreator: true });
  createdActors.push(actorA);
  actorB = await createTestActor('rls-other', PASSWORD);
  createdActors.push(actorB);
});

after(async () => {
  // Attempt every actor's cleanup even if one fails, but still fail the run
  // overall if any cleanup failed - a silently-swallowed cleanup failure
  // would leave stale users/events behind while reporting success.
  const results = await Promise.allSettled(createdActors.map((actor) => deleteTestActor(actor)));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    const messages = failures.map((failure) =>
      failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
    );
    throw new Error(`test actor cleanup failed:\n${messages.join('\n')}`);
  }
});

// --- Positive: create RPC ---

void test('authenticated user creates an event with its initial occurrence via RPC', async () => {
  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { event, occurrence } = await createEventWithOccurrence(actorA, {
    startsAt,
    endsAt,
  });
  assert.equal(event.owner_id, actorA.user.id);
  assert.equal(occurrence.event_id, event.id);
  // Postgres/PostgREST render timestamptz as "+00:00", not "Z" - normalize
  // through Date before comparing, since both spellings mean the same
  // instant.
  assert.equal(new Date(occurrence.starts_at).toISOString(), startsAt);
  assert.ok(occurrence.ends_at);
  assert.equal(new Date(occurrence.ends_at).toISOString(), endsAt);
});

void test('initial occurrence ends_at may be left unset', async () => {
  const { occurrence } = await createEventWithOccurrence(actorA);
  assert.equal(occurrence.ends_at, null);
});

void test('authenticated user can read another user’s event', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const { data, error } = await actorB.client.from('events').select().eq('id', event.id);
  assert.equal(error, null);
  assert.equal(data.length, 1);
  const [row] = data;
  assert.ok(row);
  assert.equal(row.id, event.id);
});

void test('owner can update mutable event information', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const { data, error } = await actorA.client
    .from('events')
    .update({ title: 'updated title' })
    .eq('id', event.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.title, 'updated title');
});

// --- Negative: create boundary ---

// Sends only owner_id + title - the same narrow column subset the original
// (pre-Issue #17) migration granted INSERT on - and sets owner_id to the
// caller's own id, which events_insert_own's WITH CHECK (owner_id =
// auth.uid()) would happily allow. If any column-level INSERT grant for
// authenticated had survived the revokes in
// 20260821000200_create_event_with_occurrence_rpc.sql, this exact request
// would succeed (RLS would not be the thing stopping it). It doesn't, so
// this isolates the grant layer specifically, not just "some error
// occurred".
void test('authenticated client cannot directly INSERT into events, even with only the old granted columns', async () => {
  const { error } = await actorA.client.from('events').insert({
    owner_id: actorA.user.id,
    title: eventFixtureTitle(),
  });
  assert.ok(error, 'expected direct authenticated INSERT into events to be unsupported');
});

// Direct privilege inspection (not a PostgREST-level behavioral probe like
// the test above) proving the actual root cause: no column-level INSERT
// grant survives for authenticated on any column of events, including the
// ones the original migration granted (owner_id, title, venue, source_url,
// memo) and not just the temporal columns dropped in
// 20260821000100_backfill_and_drop_event_temporal_columns.sql. Connects as
// the DB superuser (like guardrail-proof.mjs's admin path) since this
// reads catalog metadata, not RLS-governed application data.
void test('no column-level INSERT grant survives for authenticated on events', async () => {
  const status = readLocalSupabaseStatus();
  const client = new pg.Client({ connectionString: status.dbUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select column_name
       from information_schema.role_column_grants
       where table_schema = 'public'
         and table_name = 'events'
         and grantee = 'authenticated'
         and privilege_type = 'INSERT'`,
    );
    assert.deepEqual(
      rows,
      [],
      'expected zero column-level INSERT grants for authenticated on events',
    );
  } finally {
    await client.end();
  }
});

void test('anonymous cannot directly INSERT into events', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.from('events').insert({
    owner_id: actorA.user.id,
    title: eventFixtureTitle(),
  });
  assert.ok(error, 'expected a permission error for anonymous insert');
});

void test('anonymous cannot execute the create_event_with_occurrence RPC', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.rpc('create_event_with_occurrence', {
    p_title: eventFixtureTitle(),
    p_starts_at: new Date().toISOString(),
  });
  assert.ok(error, 'expected a permission error for anonymous RPC execution');
});

void test('create RPC has no input surface for owner spoofing', async () => {
  const { error } = await actorA.client.rpc('create_event_with_occurrence', {
    p_title: eventFixtureTitle(),
    p_starts_at: new Date().toISOString(),
    // owner_id is not a parameter of this function at all - passing it
    // must be rejected outright, not silently ignored.
    owner_id: actorB.user.id,
  });
  assert.ok(error, 'expected an unknown-parameter error, not a silently-ignored owner_id');
});

// The typed actor.client.rpc(...) call cannot even express a request
// missing the required p_starts_at (the generated Args type has no `?` for
// it) - which is itself useful evidence that a real TypeScript caller can't
// accidentally omit it. To prove the *server* also rejects it (not just the
// generated types), this goes around the typed client with a raw HTTP call.
// This is a PostgREST function-resolution rejection (no matching overload)
// - the function body never runs, so this does not exercise rollback; see
// the next test for that.
void test('a request omitting starts_at is rejected before the function even runs', async () => {
  const title = eventFixtureTitle();
  const response = await callCreateEventRpcRaw(actorA, { p_title: title });
  assert.equal(response.ok, false, 'expected the RPC call to be rejected without p_starts_at');

  const { data, error: selectError } = await actorA.client
    .from('events')
    .select()
    .eq('title', title);
  assert.equal(selectError, null);
  assert.deepEqual(
    data,
    [],
    'expected no event row to survive a request missing the required starts_at',
  );
});

// Unlike omitting p_starts_at (above), sending it explicitly as null passes
// PostgREST's function-resolution step and actually enters the function
// body: the first insert (into events) succeeds, then the second insert
// (into event_occurrences) hits its starts_at NOT NULL constraint and
// raises. This is what actually proves the whole function call - both
// inserts - rolls back together, not just that the endpoint rejects a
// malformed request.
void test('RPC create is atomic: a null starts_at rolls back the whole event, not just the occurrence', async () => {
  const title = eventFixtureTitle();
  const response = await callCreateEventRpcRaw(actorA, { p_title: title, p_starts_at: null });
  assert.equal(
    response.ok,
    false,
    'expected the occurrence NOT NULL constraint to reject a null starts_at',
  );

  const { data, error: selectError } = await actorA.client
    .from('events')
    .select()
    .eq('title', title);
  assert.equal(selectError, null);
  assert.deepEqual(data, [], 'expected no event row to survive a failed initial occurrence insert');
});

// --- Negative: ownership ---

void test('user B cannot update user A’s event, and the row stays unchanged', async () => {
  const { event } = await createEventWithOccurrence(actorA);

  const { data: updateData, error: updateError } = await actorB.client
    .from('events')
    .update({ title: 'hijacked title' })
    .eq('id', event.id)
    .select();
  assert.equal(updateError, null);
  assert.deepEqual(updateData, []);

  const { data: refetched, error: refetchError } = await actorA.client
    .from('events')
    .select()
    .eq('id', event.id)
    .single();
  assert.equal(refetchError, null);
  assert.equal(refetched.title, event.title);
});

void test('owner cannot transfer ownership to another user', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const { error } = await actorA.client
    .from('events')
    .update({ owner_id: actorB.user.id })
    .eq('id', event.id);
  assert.ok(error, 'expected a permission error for changing owner_id');

  const { data: refetched } = await actorA.client
    .from('events')
    .select()
    .eq('id', event.id)
    .single();
  assert.equal(refetched?.owner_id, actorA.user.id);
});

// --- Negative: system-managed fields ---

void test('normal client cannot mutate id', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const { error } = await actorA.client
    .from('events')
    .update({ id: crypto.randomUUID() })
    .eq('id', event.id);
  assert.ok(error, 'expected a permission error for changing id');
});

void test('normal client cannot mutate created_at', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const { error } = await actorA.client
    .from('events')
    .update({ created_at: new Date(0).toISOString() })
    .eq('id', event.id);
  assert.ok(error, 'expected a permission error for changing created_at');
});

void test('updated_at is DB-managed on a real update', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const { data, error } = await actorA.client
    .from('events')
    .update({ title: 'trigger updated_at' })
    .eq('id', event.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.ok(data);
  assert.notEqual(data.updated_at, event.updated_at);
  assert.ok(new Date(data.updated_at).getTime() > new Date(event.updated_at).getTime());
});

void test('normal client cannot set updated_at directly', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const { error } = await actorA.client
    .from('events')
    .update({ updated_at: new Date(0).toISOString() })
    .eq('id', event.id);
  assert.ok(error, 'expected a permission error for setting updated_at directly');
});

// --- Negative: DELETE unsupported ---

void test('owner cannot delete an event', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const { error } = await actorA.client.from('events').delete().eq('id', event.id);
  assert.ok(error, 'expected DELETE to be unsupported for a normal authenticated client');
});

// --- Negative: anonymous read ---

void test('anonymous cannot read events', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.from('events').select();
  assert.ok(error, 'expected a permission error for anonymous select');
});

void test('anonymous cannot update events', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const anon = createAnonymousClient();
  const { error } = await anon.from('events').update({ title: 'anon edit' }).eq('id', event.id);
  assert.ok(error, 'expected a permission error for anonymous update');
});

void test('anonymous cannot delete events', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const anon = createAnonymousClient();
  const { error } = await anon.from('events').delete().eq('id', event.id);
  assert.ok(error, 'expected a permission error for anonymous delete');
});
