import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import pg from 'pg';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  grantCatalogCreator,
  revokeCatalogCreator,
  type TestActor,
} from './support/testActors.ts';
import { createEventWithOccurrence, eventFixtureTitle } from './support/eventFixtures.ts';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';

// Real local Supabase/Postgres tests for the MVP Event catalog write
// boundary (Issue #29): event creation is restricted to designated catalog
// creators, everything else about the catalog is unchanged.
//
// As in events.test.ts, every assertion runs as an anon-key client with no
// session (anonymous) or signed in as a real test user (authenticated) -
// never as service_role. service_role appears only in the fixture helpers
// (grantCatalogCreator / revokeCatalogCreator), which is itself part of
// what is being asserted: membership is granted operationally, never by
// the client whose permission it decides.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let creator: TestActor;
let plainUser: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  creator = await createTestActor('rls-creator', PASSWORD, { designatedCatalogCreator: true });
  createdActors.push(creator);
  plainUser = await createTestActor('rls-noncreator', PASSWORD);
  createdActors.push(plainUser);
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

// --- Create permission ---

void test('a designated catalog creator can create an event with its initial occurrence', async () => {
  const { event, occurrence } = await createEventWithOccurrence(creator);
  assert.equal(event.owner_id, creator.user.id);
  assert.equal(occurrence.event_id, event.id);
});

void test('an authenticated user without membership cannot create an event', async () => {
  const { error } = await plainUser.client.rpc('create_event_with_occurrence', {
    p_title: eventFixtureTitle(),
    p_starts_at: new Date().toISOString(),
  });
  assert.ok(error, 'expected event creation to be denied for a non-designated creator');
});

// PostgREST maps SQLSTATE 42501 to HTTP 403. The application relies on
// that specific code to tell a permission denial apart from a validation
// or infrastructure failure (src/domain/eventCatalogWrite.ts's
// classifyWriteError), so this pins the code, not merely "some error".
void test('the create denial is reported as insufficient_privilege, not a generic failure', async () => {
  const { error } = await plainUser.client.rpc('create_event_with_occurrence', {
    p_title: eventFixtureTitle(),
    p_starts_at: new Date().toISOString(),
  });
  assert.ok(error);
  assert.equal(error.code, '42501');
});

// A denied create must leave nothing behind - not an event, and not an
// orphaned occurrence.
void test('a denied create persists no event row', async () => {
  const title = eventFixtureTitle();
  const { error } = await plainUser.client.rpc('create_event_with_occurrence', {
    p_title: title,
    p_starts_at: new Date().toISOString(),
  });
  assert.ok(error);

  const { data, error: selectError } = await creator.client
    .from('events')
    .select()
    .eq('title', title);
  assert.equal(selectError, null);
  assert.deepEqual(data, [], 'expected no event row to survive a denied create');
});

// The gate is membership, nothing else about the account: the same user
// that was just denied succeeds once granted, and is denied again once
// revoked.
void test('granting then revoking membership flips create permission for the same user', async () => {
  const grantedTitle = eventFixtureTitle();
  await grantCatalogCreator(plainUser.user.id);
  try {
    const { data, error } = await plainUser.client.rpc('create_event_with_occurrence', {
      p_title: grantedTitle,
      p_starts_at: new Date().toISOString(),
    });
    assert.equal(error, null, 'expected creation to succeed once membership is granted');
    assert.ok(data);
    // Creator becomes owner - the membership gate does not change who owns
    // what it creates.
    assert.equal(data.owner_id, plainUser.user.id);
  } finally {
    await revokeCatalogCreator(plainUser.user.id);
  }

  const { error: deniedAgain } = await plainUser.client.rpc('create_event_with_occurrence', {
    p_title: eventFixtureTitle(),
    p_starts_at: new Date().toISOString(),
  });
  assert.ok(deniedAgain, 'expected creation to be denied again once membership is revoked');
});

// --- Shared read is unaffected ---

void test('an authenticated user without membership can still read the shared catalog', async () => {
  const { event } = await createEventWithOccurrence(creator);
  const { data, error } = await plainUser.client.from('events').select().eq('id', event.id);
  assert.equal(error, null);
  assert.equal(data.length, 1);
});

void test('an authenticated user without membership can still read occurrences', async () => {
  const { occurrence } = await createEventWithOccurrence(creator);
  const { data, error } = await plainUser.client
    .from('event_occurrences')
    .select()
    .eq('id', occurrence.id);
  assert.equal(error, null);
  assert.equal(data.length, 1);
});

// --- Update authority derives from ownership, not from membership ---

// Losing designated creator status must not strand an owner with events
// they can no longer maintain: update authority comes from ownership
// alone (see src/domain/eventPermissions.ts).
void test('an owner whose membership was revoked can still update their own event', async () => {
  await grantCatalogCreator(plainUser.user.id);
  const { event } = await createEventWithOccurrence(plainUser);
  await revokeCatalogCreator(plainUser.user.id);

  const { data, error } = await plainUser.client
    .from('events')
    .update({ title: 'updated after revocation' })
    .eq('id', event.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.title, 'updated after revocation');
});

void test('an owner whose membership was revoked can still add an occurrence', async () => {
  await grantCatalogCreator(plainUser.user.id);
  const { event } = await createEventWithOccurrence(plainUser);
  await revokeCatalogCreator(plainUser.user.id);

  const { data, error } = await plainUser.client
    .from('event_occurrences')
    .insert({ event_id: event.id, starts_at: new Date().toISOString() })
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.event_id, event.id);
});

// Membership grants creation only. It confers no authority over events
// somebody else owns.
void test('membership does not let a creator update another user’s event', async () => {
  await grantCatalogCreator(plainUser.user.id);
  const { event } = await createEventWithOccurrence(plainUser);
  await revokeCatalogCreator(plainUser.user.id);

  const { data, error } = await creator.client
    .from('events')
    .update({ title: 'hijacked by another creator' })
    .eq('id', event.id)
    .select();
  assert.equal(error, null);
  assert.deepEqual(data, [], 'expected a non-owner creator to match zero rows');
});

// --- catalog_creators table visibility and immutability ---

void test('an authenticated user can read their own membership row', async () => {
  const { data, error } = await creator.client
    .from('catalog_creators')
    .select()
    .eq('user_id', creator.user.id);
  assert.equal(error, null);
  assert.equal(data.length, 1);
});

// Own-row only: the allowlist is not a directory of who the catalog
// creators are.
void test('an authenticated user cannot read another user’s membership row', async () => {
  const { data, error } = await plainUser.client
    .from('catalog_creators')
    .select()
    .eq('user_id', creator.user.id);
  assert.equal(error, null);
  assert.deepEqual(data, [], 'expected another user’s membership row to be invisible');
});

void test('an unfiltered read returns only the caller’s own membership row', async () => {
  const { data, error } = await creator.client.from('catalog_creators').select();
  assert.equal(error, null);
  assert.deepEqual(
    data.map((row) => row.user_id),
    [creator.user.id],
  );
});

void test('an authenticated user cannot grant themselves membership', async () => {
  const { error } = await plainUser.client
    .from('catalog_creators')
    .insert({ user_id: plainUser.user.id });
  assert.ok(error, 'expected self-promotion to be denied');

  // And the denial is real, not just an error on the way back: the user
  // still cannot create an event afterwards.
  const { error: stillDenied } = await plainUser.client.rpc('create_event_with_occurrence', {
    p_title: eventFixtureTitle(),
    p_starts_at: new Date().toISOString(),
  });
  assert.ok(stillDenied, 'expected creation to remain denied after a failed self-promotion');
});

void test('an authenticated user cannot revoke another user’s membership', async () => {
  const { error } = await plainUser.client
    .from('catalog_creators')
    .delete()
    .eq('user_id', creator.user.id);
  assert.ok(error, 'expected DELETE on catalog_creators to be unsupported for a normal client');

  const { data } = await creator.client
    .from('catalog_creators')
    .select()
    .eq('user_id', creator.user.id);
  assert.equal(data?.length, 1, 'expected the membership row to survive');
});

void test('a designated creator cannot modify their own membership row', async () => {
  const { error } = await creator.client
    .from('catalog_creators')
    .update({ created_at: new Date(0).toISOString() })
    .eq('user_id', creator.user.id);
  assert.ok(error, 'expected UPDATE on catalog_creators to be unsupported for a normal client');
});

void test('anonymous cannot read catalog_creators', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.from('catalog_creators').select();
  assert.ok(error, 'expected a permission error for anonymous select');
});

void test('anonymous cannot insert into catalog_creators', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.from('catalog_creators').insert({ user_id: creator.user.id });
  assert.ok(error, 'expected a permission error for anonymous insert');
});

// Direct privilege inspection (not a PostgREST behavioral probe like the
// tests above) proving the root cause: authenticated holds no write
// privilege of any kind on this table, so no future policy change alone
// could open a self-promotion path.
void test('authenticated holds no INSERT/UPDATE/DELETE privilege on catalog_creators', async () => {
  const status = readLocalSupabaseStatus();
  const client = new pg.Client({ connectionString: status.dbUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ privilege_type: string }>(
      `select distinct privilege_type
       from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'catalog_creators'
         and grantee = 'authenticated'
       union
       select distinct privilege_type
       from information_schema.role_column_grants
       where table_schema = 'public'
         and table_name = 'catalog_creators'
         and grantee = 'authenticated'`,
    );
    assert.deepEqual(
      rows.map((row) => row.privilege_type).sort(),
      ['SELECT'],
      'expected authenticated to hold SELECT and nothing else on catalog_creators',
    );
  } finally {
    await client.end();
  }
});
