import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import pg from 'pg';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';
import { createEventWithOccurrence } from './support/eventFixtures.ts';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';
import { postgrestFetchAs } from './support/postgrest.ts';
import { readOwnParticipation, setParticipation } from './support/participationFixtures.ts';

// Real local Supabase/Postgres RLS tests for public.occurrence_participations
// (Issue #30). See test/rls/events.test.ts's header comment for the
// anon/service_role/authenticated client conventions used throughout, and
// for why a denied UPDATE/DELETE surfaces as an empty result set rather than
// an error while a denied INSERT or an ungranted column surfaces as a
// request error.
//
// The distinction that matters most here: participation is a *personal*
// concept layered on the shared catalog, so unlike events/event_occurrences
// the default is private, and owning the parent event grants nothing.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let catalogOwner: TestActor;
let actorA: TestActor;
let actorB: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  catalogOwner = await createTestActor('rls-part-catalog', PASSWORD);
  createdActors.push(catalogOwner);
  actorA = await createTestActor('rls-part-a', PASSWORD);
  createdActors.push(actorA);
  actorB = await createTestActor('rls-part-b', PASSWORD);
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

// --- Positive ---

void test('a user can record their own participation as considering', async () => {
  const occurrence = await occurrenceId();
  const row = await setParticipation(actorA, occurrence, 'considering');
  assert.equal(row.occurrence_id, occurrence);
  assert.equal(row.user_id, actorA.user.id);
  assert.equal(row.status, 'considering');
});

void test('a user can record their own participation as attending', async () => {
  const occurrence = await occurrenceId();
  const row = await setParticipation(actorA, occurrence, 'attending');
  assert.equal(row.status, 'attending');
});

void test('visibility defaults to private when the client does not send it', async () => {
  const occurrence = await occurrenceId();
  const row = await setParticipation(actorA, occurrence, 'considering');
  assert.equal(row.visibility, 'private');
});

void test('the participant can move their own considering to attending', async () => {
  const occurrence = await occurrenceId();
  const row = await setParticipation(actorA, occurrence, 'considering');
  const { data, error } = await actorA.client
    .from('occurrence_participations')
    .update({ status: 'attending' })
    .eq('id', row.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.status, 'attending');
});

void test('the participant can opt their own row into public visibility', async () => {
  const occurrence = await occurrenceId();
  const row = await setParticipation(actorA, occurrence, 'attending');
  const { data, error } = await actorA.client
    .from('occurrence_participations')
    .update({ visibility: 'public' })
    .eq('id', row.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.visibility, 'public');
});

void test('another authenticated user can read a public participation', async () => {
  const occurrence = await occurrenceId();
  const row = await setParticipation(actorA, occurrence, 'attending', 'public');
  const { data, error } = await actorB.client
    .from('occurrence_participations')
    .select()
    .eq('id', row.id);
  assert.equal(error, null);
  assert.equal(data.length, 1);
});

// "No row" is the canonical representation of not participating -
// product-rules.md rules out persisting `not_attending` alongside it - so
// withdrawing has to be expressible, or `considering`/`attending` would be
// one-way doors.
void test('the participant can withdraw by deleting their own row', async () => {
  const occurrence = await occurrenceId();
  await setParticipation(actorA, occurrence, 'considering');

  const { error } = await actorA.client
    .from('occurrence_participations')
    .delete()
    .eq('occurrence_id', occurrence)
    .eq('user_id', actorA.user.id);
  assert.equal(error, null);
  assert.equal(await readOwnParticipation(actorA, occurrence), null);
});

// --- Negative: visibility ---

void test('another authenticated user cannot read a private participation', async () => {
  const occurrence = await occurrenceId();
  const row = await setParticipation(actorA, occurrence, 'attending');
  const { data, error } = await actorB.client
    .from('occurrence_participations')
    .select()
    .eq('id', row.id);
  assert.equal(error, null);
  assert.deepEqual(data, [], 'private participation must not be visible to other users');
});

// Owning the event is an information-management role, not a participation
// one: it must not grant a window into who is privately planning to attend.
void test('the parent event owner cannot read a private participation on their own occurrence', async () => {
  const occurrence = await occurrenceId();
  const row = await setParticipation(actorA, occurrence, 'attending');
  const { data, error } = await catalogOwner.client
    .from('occurrence_participations')
    .select()
    .eq('id', row.id);
  assert.equal(error, null);
  assert.deepEqual(data, [], 'event ownership must not expose private participation');
});

void test('a participation reverted to private stops being readable by others', async () => {
  const occurrence = await occurrenceId();
  const row = await setParticipation(actorA, occurrence, 'attending', 'public');
  await actorA.client
    .from('occurrence_participations')
    .update({ visibility: 'private' })
    .eq('id', row.id);

  const { data, error } = await actorB.client
    .from('occurrence_participations')
    .select()
    .eq('id', row.id);
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

// --- Negative: anonymous ---

void test('anonymous cannot read participations', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.from('occurrence_participations').select();
  assert.ok(error, 'expected a permission error for anonymous select');
});

void test('anonymous cannot insert participations', async () => {
  const occurrence = await occurrenceId();
  const anon = createAnonymousClient();
  const { error } = await anon.from('occurrence_participations').insert({
    occurrence_id: occurrence,
    user_id: actorA.user.id,
    status: 'considering',
  });
  assert.ok(error, 'expected a permission error for anonymous insert');
});

void test('anonymous cannot update participations', async () => {
  const occurrence = await occurrenceId();
  const row = await setParticipation(actorA, occurrence, 'considering');
  const anon = createAnonymousClient();
  const { error } = await anon
    .from('occurrence_participations')
    .update({ status: 'attending' })
    .eq('id', row.id);
  assert.ok(error, 'expected a permission error for anonymous update');
});

void test('anonymous cannot delete participations', async () => {
  const occurrence = await occurrenceId();
  const row = await setParticipation(actorA, occurrence, 'considering');
  const anon = createAnonymousClient();
  const { error } = await anon.from('occurrence_participations').delete().eq('id', row.id);
  assert.ok(error, 'expected a permission error for anonymous delete');
});

// --- Negative: ownership ---

void test('a user cannot create a participation on someone else’s behalf', async () => {
  const occurrence = await occurrenceId();
  const { error } = await actorB.client.from('occurrence_participations').insert({
    occurrence_id: occurrence,
    user_id: actorA.user.id,
    status: 'attending',
  });
  assert.ok(error, 'expected an RLS violation for inserting another user’s participation');
});

void test('a user cannot update someone else’s participation, and the row stays unchanged', async () => {
  const occurrence = await occurrenceId();
  const row = await setParticipation(actorA, occurrence, 'attending');

  const { data: updated, error: updateError } = await actorB.client
    .from('occurrence_participations')
    .update({ status: 'considering' })
    .eq('id', row.id)
    .select();
  assert.equal(updateError, null);
  assert.deepEqual(updated, []);

  const refetched = await readOwnParticipation(actorA, occurrence);
  assert.equal(refetched?.status, 'attending');
});

void test('a user cannot delete someone else’s participation, and the row survives', async () => {
  const occurrence = await occurrenceId();
  await setParticipation(actorA, occurrence, 'considering');

  const { data: deleted, error: deleteError } = await actorB.client
    .from('occurrence_participations')
    .delete()
    .eq('occurrence_id', occurrence)
    .eq('user_id', actorA.user.id)
    .select();
  assert.equal(deleteError, null);
  assert.deepEqual(deleted, []);

  const refetched = await readOwnParticipation(actorA, occurrence);
  assert.ok(refetched, 'another user’s DELETE must not remove the row');
});

void test('a participation cannot be reassigned to another user', async () => {
  const occurrence = await occurrenceId();
  const row = await setParticipation(actorA, occurrence, 'considering');
  const { error } = await actorA.client
    .from('occurrence_participations')
    .update({ user_id: actorB.user.id })
    .eq('id', row.id);
  assert.ok(error, 'expected a permission error for changing user_id');
});

void test('a participation cannot be moved to a different occurrence', async () => {
  const first = await occurrenceId();
  const second = await occurrenceId();
  const row = await setParticipation(actorA, first, 'considering');

  const { error } = await actorA.client
    .from('occurrence_participations')
    .update({ occurrence_id: second })
    .eq('id', row.id);
  assert.ok(error, 'expected a permission error for changing occurrence_id');

  const refetched = await readOwnParticipation(actorA, first);
  assert.equal(refetched?.id, row.id);
});

// --- Negative: status vocabulary ---

// The generated Database types already make `not_attending` unrepresentable
// through the typed client, which is useful but proves nothing about the
// server. This goes around the typed client to show the enum itself rejects
// it. The `considering` request beneath it is the control: without it, a
// typo in the URL or headers would make the negative assertion pass for the
// wrong reason.
void test('not_attending is not a persistable participation status', async () => {
  const occurrence = await occurrenceId();
  const response = await postgrestFetchAs(actorA, 'rest/v1/occurrence_participations', {
    occurrence_id: occurrence,
    user_id: actorA.user.id,
    status: 'not_attending',
  });
  assert.equal(
    response.ok,
    false,
    'expected the participation_status enum to reject not_attending',
  );

  assert.equal(await readOwnParticipation(actorA, occurrence), null);
});

void test('control: the same raw request shape succeeds with a canonical status', async () => {
  const occurrence = await occurrenceId();
  const response = await postgrestFetchAs(actorA, 'rest/v1/occurrence_participations', {
    occurrence_id: occurrence,
    user_id: actorA.user.id,
    status: 'considering',
  });
  assert.equal(response.ok, true, 'expected the raw request shape itself to be valid');

  const stored = await readOwnParticipation(actorA, occurrence);
  assert.equal(stored?.status, 'considering');
});

// --- Negative: uniqueness ---

void test('a user cannot hold two participations for the same occurrence', async () => {
  const occurrence = await occurrenceId();
  await setParticipation(actorA, occurrence, 'considering');
  const { error } = await actorA.client.from('occurrence_participations').insert({
    occurrence_id: occurrence,
    user_id: actorA.user.id,
    status: 'attending',
  });
  assert.ok(error, 'expected a unique violation for a duplicate (occurrence, user) participation');
});

// --- Negative: system-managed fields ---

void test('normal client cannot mutate id', async () => {
  const occurrence = await occurrenceId();
  const row = await setParticipation(actorA, occurrence, 'considering');
  const { error } = await actorA.client
    .from('occurrence_participations')
    .update({ id: crypto.randomUUID() })
    .eq('id', row.id);
  assert.ok(error, 'expected a permission error for changing id');
});

void test('normal client cannot mutate created_at', async () => {
  const occurrence = await occurrenceId();
  const row = await setParticipation(actorA, occurrence, 'considering');
  const { error } = await actorA.client
    .from('occurrence_participations')
    .update({ created_at: new Date(0).toISOString() })
    .eq('id', row.id);
  assert.ok(error, 'expected a permission error for changing created_at');
});

void test('updated_at is DB-managed on a real update', async () => {
  const occurrence = await occurrenceId();
  const row = await setParticipation(actorA, occurrence, 'considering');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const { data, error } = await actorA.client
    .from('occurrence_participations')
    .update({ status: 'attending' })
    .eq('id', row.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.ok(new Date(data.updated_at).getTime() > new Date(row.updated_at).getTime());
});

void test('normal client cannot set updated_at directly', async () => {
  const occurrence = await occurrenceId();
  const row = await setParticipation(actorA, occurrence, 'considering');
  const { error } = await actorA.client
    .from('occurrence_participations')
    .update({ updated_at: new Date(0).toISOString() })
    .eq('id', row.id);
  assert.ok(error, 'expected a permission error for setting updated_at directly');
});

// Direct privilege inspection rather than a behavioral probe: this pins the
// exact column boundary the tests above exercise one column at a time, so a
// future migration that widened a grant would fail here even if no
// behavioral test happened to cover the newly-writable column. Connects as
// the DB superuser since this reads catalog metadata, not RLS-governed
// application data.
void test('authenticated holds exactly the intended column grants on participations', async () => {
  const status = readLocalSupabaseStatus();
  const client = new pg.Client({ connectionString: status.dbUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ privilege_type: string; column_name: string }>(
      `select privilege_type, column_name
       from information_schema.role_column_grants
       where table_schema = 'public'
         and table_name = 'occurrence_participations'
         and grantee = 'authenticated'
         and privilege_type in ('INSERT', 'UPDATE')
       order by privilege_type, column_name`,
    );
    assert.deepEqual(
      rows.map((row) => `${row.privilege_type} ${row.column_name}`),
      [
        'INSERT occurrence_id',
        'INSERT status',
        'INSERT user_id',
        'INSERT visibility',
        'UPDATE status',
        'UPDATE visibility',
      ],
      'id/created_at/updated_at must never be writable, and user_id/occurrence_id INSERT-only',
    );
  } finally {
    await client.end();
  }
});
