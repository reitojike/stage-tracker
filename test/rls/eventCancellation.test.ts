import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import pg from 'pg';
import {
  createAdminClient,
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';
import { createEventWithOccurrence } from './support/eventFixtures.ts';
import {
  createOccurrenceWithAttendee,
  inviteToOccurrence,
  inviteToOccurrenceByEmail,
  requireActorEmail,
  setParticipation,
} from './support/participationFixtures.ts';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';

// Real local Supabase/Postgres RLS/trigger/RPC tests for Issue #125's
// Event/Occurrence cancellation lifecycle (PO decision #123) - see
// supabase/migrations/20260826000200_create_event_occurrence_cancellation.sql
// for the full design rationale this file exercises.
//
// Product semantics under test (product-rules.md "Cancellation"):
// - Event-level and Occurrence-level cancellation are independent booleans,
//   owner-only, both directions (cancel and uncancel) reversible.
// - Effective cancellation = Event canceled OR Occurrence canceled.
// - Un-canceling the Event never clears an Occurrence's own cancellation.
// - Cancellation never touches existing participation/invitation rows.
// - New active commitments (new participation, `considering -> attending`,
//   new invitation) are rejected (SQLSTATE 90002)
//   on an effectively-canceled occurrence; withdrawal (participation
//   DELETE) and unrelated updates stay available.

const PASSWORD = 'Str0ng-Test-Passw0rd!';
const status = readLocalSupabaseStatus();

let owner: TestActor;
let nonOwner: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  owner = await createTestActor('rls-cancel-owner', PASSWORD, { designatedCatalogCreator: true });
  createdActors.push(owner);
  nonOwner = await createTestActor('rls-cancel-non-owner', PASSWORD);
  createdActors.push(nonOwner);
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

async function readEventCanceledAt(eventId: string): Promise<string | null> {
  const { data, error } = await owner.client
    .from('events')
    .select('canceled_at')
    .eq('id', eventId)
    .single();
  if (error) {
    throw new Error(`event read failed: ${error.message}`);
  }
  return data.canceled_at;
}

async function readOccurrenceCanceledAt(occurrenceId: string): Promise<string | null> {
  const { data, error } = await owner.client
    .from('event_occurrences')
    .select('canceled_at')
    .eq('id', occurrenceId)
    .single();
  if (error) {
    throw new Error(`occurrence read failed: ${error.message}`);
  }
  return data.canceled_at;
}

// --- Event cancel/uncancel: positive, owner-only ---

void test('owner can cancel and then uncancel an event', async () => {
  const { event } = await createEventWithOccurrence(owner);
  assert.equal(await readEventCanceledAt(event.id), null);

  const { error: cancelError } = await owner.client
    .from('events')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', event.id);
  assert.equal(cancelError, null);
  assert.notEqual(await readEventCanceledAt(event.id), null);

  const { error: uncancelError } = await owner.client
    .from('events')
    .update({ canceled_at: null })
    .eq('id', event.id);
  assert.equal(uncancelError, null);
  assert.equal(await readEventCanceledAt(event.id), null);
});

void test('non-owner cannot cancel another owner’s event', async () => {
  const { event } = await createEventWithOccurrence(owner);
  const { data, error } = await nonOwner.client
    .from('events')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', event.id)
    .select();
  assert.equal(error, null);
  assert.deepEqual(data, [], 'expected RLS to filter out a non-owner update, affecting no rows');
  assert.equal(await readEventCanceledAt(event.id), null);
});

void test('anonymous cannot cancel an event', async () => {
  const { event } = await createEventWithOccurrence(owner);
  const anon = createAnonymousClient();
  const { error } = await anon
    .from('events')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', event.id);
  assert.ok(error, 'expected a permission error for an anonymous update');
  assert.equal(await readEventCanceledAt(event.id), null);
});

// --- Occurrence cancel/uncancel: positive, owner-only, independent of Event ---

void test('owner can cancel and then uncancel an occurrence independently of its event', async () => {
  const { event, occurrence } = await createEventWithOccurrence(owner);

  const { error: cancelError } = await owner.client
    .from('event_occurrences')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', occurrence.id);
  assert.equal(cancelError, null);
  assert.notEqual(await readOccurrenceCanceledAt(occurrence.id), null);
  assert.equal(
    await readEventCanceledAt(event.id),
    null,
    'occurrence cancel must not cancel the event',
  );

  const { error: uncancelError } = await owner.client
    .from('event_occurrences')
    .update({ canceled_at: null })
    .eq('id', occurrence.id);
  assert.equal(uncancelError, null);
  assert.equal(await readOccurrenceCanceledAt(occurrence.id), null);
});

void test('non-owner cannot cancel another owner’s occurrence', async () => {
  const { occurrence } = await createEventWithOccurrence(owner);
  const { data, error } = await nonOwner.client
    .from('event_occurrences')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', occurrence.id)
    .select();
  assert.equal(error, null);
  assert.deepEqual(data, []);
  assert.equal(await readOccurrenceCanceledAt(occurrence.id), null);
});

void test('event uncancel does not clear an already-canceled occurrence’s own cancellation', async () => {
  const { event, occurrence } = await createEventWithOccurrence(owner);

  await owner.client
    .from('events')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', event.id);
  await owner.client
    .from('event_occurrences')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', occurrence.id);

  const { error: uncancelEventError } = await owner.client
    .from('events')
    .update({ canceled_at: null })
    .eq('id', event.id);
  assert.equal(uncancelEventError, null);

  assert.equal(await readEventCanceledAt(event.id), null);
  assert.notEqual(
    await readOccurrenceCanceledAt(occurrence.id),
    null,
    'occurrence cancellation must survive an event-level uncancel',
  );
});

// --- Effective cancellation guard: new participation ---

void test('a new participation is rejected on an occurrence-canceled occurrence', async () => {
  const { occurrence } = await createEventWithOccurrence(owner);
  await owner.client
    .from('event_occurrences')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', occurrence.id);

  const { error } = await nonOwner.client
    .from('occurrence_participations')
    .insert({ occurrence_id: occurrence.id, user_id: nonOwner.user.id, status: 'considering' });
  assert.ok(error, 'expected the insert to be rejected');
  assert.equal(error.code, '90002');
});

void test('a new participation is rejected when the parent event (not the occurrence) is canceled', async () => {
  const { event, occurrence } = await createEventWithOccurrence(owner);
  await owner.client
    .from('events')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', event.id);

  const { error } = await nonOwner.client
    .from('occurrence_participations')
    .insert({ occurrence_id: occurrence.id, user_id: nonOwner.user.id, status: 'considering' });
  assert.ok(error, 'expected effective cancellation via the parent event to reject the insert');
  assert.equal(error.code, '90002');
});

void test('a new participation succeeds on a not-canceled occurrence', async () => {
  const { occurrence } = await createEventWithOccurrence(owner);
  const participation = await setParticipation(nonOwner, occurrence.id, 'considering');
  assert.equal(participation.status, 'considering');
});

// --- Effective cancellation guard: participation update ---

void test('considering -> attending is rejected once effectively canceled', async () => {
  const { occurrence } = await createEventWithOccurrence(owner);
  await setParticipation(nonOwner, occurrence.id, 'considering');
  await owner.client
    .from('event_occurrences')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', occurrence.id);

  const { error } = await nonOwner.client
    .from('occurrence_participations')
    .update({ status: 'attending' })
    .eq('occurrence_id', occurrence.id)
    .eq('user_id', nonOwner.user.id);
  assert.ok(error, 'expected the considering -> attending update to be rejected');
  assert.equal(error.code, '90002');
});

void test('attending -> considering is still allowed once effectively canceled', async () => {
  const { occurrence } = await createEventWithOccurrence(owner);
  await setParticipation(nonOwner, occurrence.id, 'attending');
  await owner.client
    .from('event_occurrences')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', occurrence.id);

  const { data, error } = await nonOwner.client
    .from('occurrence_participations')
    .update({ status: 'considering' })
    .eq('occurrence_id', occurrence.id)
    .eq('user_id', nonOwner.user.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.status, 'considering');
});

void test('an unchanged-status update (visibility only) is still allowed once effectively canceled', async () => {
  const { occurrence } = await createEventWithOccurrence(owner);
  await setParticipation(nonOwner, occurrence.id, 'attending');
  await owner.client
    .from('event_occurrences')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', occurrence.id);

  const { data, error } = await nonOwner.client
    .from('occurrence_participations')
    .update({ status: 'attending', visibility: 'public' })
    .eq('occurrence_id', occurrence.id)
    .eq('user_id', nonOwner.user.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.visibility, 'public');
});

void test('withdrawing (deleting) a participation is still allowed once effectively canceled', async () => {
  const { occurrence } = await createEventWithOccurrence(owner);
  await setParticipation(nonOwner, occurrence.id, 'attending');
  await owner.client
    .from('event_occurrences')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', occurrence.id);

  const { data, error } = await nonOwner.client
    .from('occurrence_participations')
    .delete()
    .eq('occurrence_id', occurrence.id)
    .eq('user_id', nonOwner.user.id)
    .select();
  assert.equal(error, null);
  assert.equal(data.length, 1);
});

// --- Effective cancellation guard: new invitation ---

void test('invite_to_occurrence is rejected once effectively canceled', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(owner, nonOwner);
  await owner.client
    .from('event_occurrences')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', occurrenceId);

  const invitee = await createTestActor(`rls-cancel-invitee-${String(Date.now())}`, PASSWORD);
  createdActors.push(invitee);

  const { error } = await inviteToOccurrence(nonOwner, occurrenceId, invitee.user.id);
  assert.ok(error, 'expected the invitation to be rejected');
  assert.equal(error.code, '90002');
});

void test('invite_to_occurrence_by_email is rejected once effectively canceled', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(owner, nonOwner);
  await owner.client
    .from('event_occurrences')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', occurrenceId);

  const invitee = await createTestActor(`rls-cancel-invitee-email-${String(Date.now())}`, PASSWORD);
  createdActors.push(invitee);

  const { error } = await inviteToOccurrenceByEmail(
    nonOwner,
    occurrenceId,
    requireActorEmail(invitee),
  );
  assert.ok(error, 'expected the invitation to be rejected');
  assert.equal(error.code, '90002');
});

// --- Cancellation never touches existing downstream data ---

void test('canceling an occurrence does not remove or change existing participation rows', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(owner, nonOwner);

  await owner.client
    .from('event_occurrences')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', occurrenceId);

  const { data: participation, error: participationError } = await nonOwner.client
    .from('occurrence_participations')
    .select()
    .eq('occurrence_id', occurrenceId)
    .eq('user_id', nonOwner.user.id)
    .single();
  assert.equal(participationError, null);
  assert.equal(participation.status, 'attending');
});

// --- service_role can reach the effective-cancellation guard (review
// finding): the occurrence_participations guard runs SECURITY INVOKER, so a
// service_role-performed INSERT (admin fixtures, backend tooling) calls
// event_occurrence_is_effectively_canceled as service_role too. Without an
// explicit EXECUTE grant to service_role on that function (table-level
// grants are a separate, still-enforced check from BYPASSRLS - see
// 20260820000000_create_events.sql's own comment on this), such an insert
// would fail with "permission denied for function
// event_occurrence_is_effectively_canceled" even on a perfectly ordinary,
// not-canceled occurrence.

void test('service_role can insert a participation on a not-canceled occurrence (guard function is reachable)', async () => {
  const { occurrence } = await createEventWithOccurrence(owner);
  const admin = createAdminClient();
  const { error } = await admin
    .from('occurrence_participations')
    .insert({ occurrence_id: occurrence.id, user_id: nonOwner.user.id, status: 'considering' });
  assert.equal(error, null);
});

// --- Race safety (review finding): event_occurrence_is_effectively_canceled
// takes `for share of eo, e`, which conflicts with the `FOR NO KEY UPDATE`
// lock an ordinary `update event_occurrences set canceled_at = ...` takes -
// so a cancel that is in-flight (holds the lock, not yet committed) blocks a
// concurrent guarded insert until the cancel resolves, and the insert then
// sees the true, post-commit state rather than a stale pre-cancel snapshot.
// Uses raw pg.Client connections, the same technique test/rls/
// eventDeletion.test.ts and test/rls/eventRangeConcurrency.test.ts use, so
// each side of the race can be controlled explicitly and proven to actually
// block (via pg_stat_activity) rather than merely asserting the end state.

async function newClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: status.dbUrl });
  await client.connect();
  return client;
}

async function backendPid(client: pg.Client): Promise<number> {
  const { rows } = await client.query<{ pid: number }>('select pg_backend_pid() as pid');
  const pid = rows[0]?.pid;
  if (pid === undefined) {
    throw new Error('failed to read backend pid');
  }
  return pid;
}

async function waitUntilBlocked(admin: pg.Client, pid: number): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const { rows } = await admin.query<{ wait_event_type: string | null }>(
      'select wait_event_type from pg_stat_activity where pid = $1',
      [pid],
    );
    if (rows[0]?.wait_event_type === 'Lock') {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for backend ${String(pid)} to block on a lock`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Simulates the auth context PostgREST would establish for `userId`, for
 * the current transaction only (matches auth.uid()'s own
 * request.jwt.claim.sub lookup). Must run after `begin`. */
async function actAsAuthenticated(client: pg.Client, userId: string): Promise<void> {
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
}

function pgErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : null;
  }
  return null;
}

interface InsertAttemptOutcome {
  committed: boolean;
  code: string | null;
}

void test('race safety: an in-flight cancel blocks a concurrent participation insert, which then correctly rejects once the cancel commits', async () => {
  const admin = await newClient();
  const txCancel = await newClient();
  const txInsert = await newClient();
  try {
    const { occurrence } = await createEventWithOccurrence(owner);
    const insertPid = await backendPid(txInsert);

    await txCancel.query('begin');
    await txCancel.query('update public.event_occurrences set canceled_at = now() where id = $1', [
      occurrence.id,
    ]);
    // txCancel now holds a FOR NO KEY UPDATE lock on the occurrence row,
    // uncommitted - this is what txInsert's `for share` guard read must
    // wait on.

    const insertResult: Promise<InsertAttemptOutcome> = (async () => {
      await txInsert.query('begin');
      await actAsAuthenticated(txInsert, nonOwner.user.id);
      try {
        await txInsert.query(
          'insert into public.occurrence_participations (occurrence_id, user_id, status) values ($1, $2, $3)',
          [occurrence.id, nonOwner.user.id, 'considering'],
        );
        await txInsert.query('commit');
        return { committed: true, code: null };
      } catch (error) {
        await txInsert.query('rollback').catch(() => {});
        return { committed: false, code: pgErrorCode(error) };
      }
    })();

    await waitUntilBlocked(admin, insertPid);
    await txCancel.query('commit');
    const outcome = await insertResult;

    assert.equal(
      outcome.committed,
      false,
      'expected the insert to be rejected once it sees the committed cancellation',
    );
    assert.equal(outcome.code, '90002');

    const { data, error } = await nonOwner.client
      .from('occurrence_participations')
      .select()
      .eq('occurrence_id', occurrence.id)
      .eq('user_id', nonOwner.user.id);
    assert.equal(error, null);
    assert.deepEqual(data, [], 'no participation row should have been left behind');
  } finally {
    await txCancel.end();
    await txInsert.end();
    await admin.end();
  }
});

void test('race safety: a cancel blocked by an in-flight participation insert proceeds once the insert commits, and the insert itself is unaffected', async () => {
  const admin = await newClient();
  const txInsert = await newClient();
  const txCancel = await newClient();
  try {
    const { occurrence } = await createEventWithOccurrence(owner);
    const cancelPid = await backendPid(txCancel);

    await txInsert.query('begin');
    await actAsAuthenticated(txInsert, nonOwner.user.id);
    await txInsert.query(
      'insert into public.occurrence_participations (occurrence_id, user_id, status) values ($1, $2, $3)',
      [occurrence.id, nonOwner.user.id, 'considering'],
    );
    // The guard trigger's `for share of eo, e` read holds a FOR SHARE lock
    // on the occurrence row, uncommitted - this is what txCancel's own
    // update must wait on (FOR NO KEY UPDATE conflicts with FOR SHARE).

    const cancelResult: Promise<{ committed: boolean }> = (async () => {
      await txCancel.query('begin');
      try {
        await txCancel.query(
          'update public.event_occurrences set canceled_at = now() where id = $1',
          [occurrence.id],
        );
        await txCancel.query('commit');
        return { committed: true };
      } catch {
        await txCancel.query('rollback').catch(() => {});
        return { committed: false };
      }
    })();

    await waitUntilBlocked(admin, cancelPid);
    await txInsert.query('commit');
    const cancelOutcome = await cancelResult;

    assert.equal(
      cancelOutcome.committed,
      true,
      'expected the cancel to proceed once the earlier, not-yet-canceled insert has committed',
    );

    const { data, error } = await nonOwner.client
      .from('occurrence_participations')
      .select()
      .eq('occurrence_id', occurrence.id)
      .eq('user_id', nonOwner.user.id)
      .single();
    assert.equal(error, null);
    assert.equal(
      data.status,
      'considering',
      'the participation created before the cancel committed must survive it (no cascade)',
    );
  } finally {
    await txInsert.end();
    await txCancel.end();
    await admin.end();
  }
});
