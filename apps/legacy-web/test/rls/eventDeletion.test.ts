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
import {
  createEventWithOccurrence,
  createEventWithoutOccurrence,
} from './support/eventFixtures.ts';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';
import { setParticipation } from './support/participationFixtures.ts';

// Real local Supabase/Postgres RLS/RPC tests for Issue #124's Event/
// Occurrence hard deletion (delete_event_occurrence / delete_event, both
// SECURITY DEFINER - see supabase/migrations/20260826000100_create_event_
// delete_rpcs.sql for the full design rationale this file exercises).
//
// Product semantics under test (product-rules.md "Deletion"):
// - owner-only, for both RPCs.
// - an occurrence cannot be deleted while occurrence_participations /
//   occurrence_invitations reference it - no cascade.
// - an event's delete is atomic across itself and every child occurrence:
//   it only proceeds if EVERY child is independently safe to delete: one
//   unsafe child rejects the whole operation, never a partial delete.
// - a 0-occurrence event (or an occurrence's deletion that leaves its
//   parent at 0 occurrences) is a valid end state (Issue #87/#88).
//
// See test/rls/events.test.ts's header comment for the general anon/
// service_role/authenticated client conventions used throughout.

const PASSWORD = 'Str0ng-Test-Passw0rd!';
const status = readLocalSupabaseStatus();

let owner: TestActor;
let otherOwner: TestActor;
let nonOwner: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  // Both `owner` and `otherOwner` create fixture events, so both need
  // designated catalog creator membership (Issue #29); `nonOwner` is used
  // only to prove ownership denial and deliberately lacks it.
  owner = await createTestActor('rls-del-owner', PASSWORD, { designatedCatalogCreator: true });
  createdActors.push(owner);
  otherOwner = await createTestActor('rls-del-other-owner', PASSWORD, {
    designatedCatalogCreator: true,
  });
  createdActors.push(otherOwner);
  nonOwner = await createTestActor('rls-del-non-owner', PASSWORD);
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

async function occurrenceExists(occurrenceId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.from('event_occurrences').select('id').eq('id', occurrenceId);
  if (error) {
    throw new Error(`admin occurrence read failed: ${error.message}`);
  }
  return data.length === 1;
}

async function eventExists(eventId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.from('events').select('id').eq('id', eventId);
  if (error) {
    throw new Error(`admin event read failed: ${error.message}`);
  }
  return data.length === 1;
}

async function occurrenceCount(eventId: string): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('event_occurrences')
    .select('id')
    .eq('event_id', eventId);
  if (error) {
    throw new Error(`admin occurrence count read failed: ${error.message}`);
  }
  return data.length;
}

// --- Occurrence delete: positive ---

void test('owner can delete a safe occurrence (no downstream data)', async () => {
  const { occurrence } = await createEventWithOccurrence(owner);
  const { error } = await owner.client.rpc('delete_event_occurrence', {
    p_occurrence_id: occurrence.id,
  });
  assert.equal(error, null);
  assert.equal(await occurrenceExists(occurrence.id), false);
});

void test('deleting the last occurrence leaves a valid 0-occurrence event, not a deleted event', async () => {
  const { event, occurrence } = await createEventWithOccurrence(owner);
  const { error } = await owner.client.rpc('delete_event_occurrence', {
    p_occurrence_id: occurrence.id,
  });
  assert.equal(error, null);
  assert.equal(await eventExists(event.id), true);
  assert.equal(await occurrenceCount(event.id), 0);
});

// --- Occurrence delete: negative permission ---

void test('non-owner cannot delete another owner’s occurrence', async () => {
  const { occurrence } = await createEventWithOccurrence(owner);
  const { error } = await nonOwner.client.rpc('delete_event_occurrence', {
    p_occurrence_id: occurrence.id,
  });
  assert.ok(error, 'expected a permission error for a non-owner delete');
  assert.equal(error.code, '42501');
  assert.equal(await occurrenceExists(occurrence.id), true);
});

void test('anonymous cannot delete an occurrence', async () => {
  const { occurrence } = await createEventWithOccurrence(owner);
  const anon = createAnonymousClient();
  const { error } = await anon.rpc('delete_event_occurrence', {
    p_occurrence_id: occurrence.id,
  });
  assert.ok(error, 'expected a permission error for an anonymous delete');
  assert.equal(await occurrenceExists(occurrence.id), true);
});

// --- Occurrence delete: downstream blockers ---

void test('occurrence delete is blocked while a participation references it', async () => {
  const { occurrence } = await createEventWithOccurrence(owner);
  await setParticipation(nonOwner, occurrence.id, 'considering');

  const { error } = await owner.client.rpc('delete_event_occurrence', {
    p_occurrence_id: occurrence.id,
  });
  assert.ok(error, 'expected the delete to be blocked by an existing participation');
  assert.equal(error.code, '90001');
  assert.equal(await occurrenceExists(occurrence.id), true);
});

void test('occurrence delete is blocked while an invitation references it', async () => {
  const { occurrence } = await createEventWithOccurrence(owner);
  // Inserted directly via the admin path rather than through
  // invite_to_occurrence: a real invite can leave the invitee with a
  // `considering` participation alongside the invitation (Issue #225/#230:
  // only when the invitee already had one before the invite - see
  // occurrenceInvitations.test.ts), which would risk conflating this test
  // with the participation blocker above. Isolating occurrence_invitations
  // by itself proves the guard's invitation branch specifically, not just
  // the participation one.
  const admin = createAdminClient();
  const { error: insertError } = await admin.from('occurrence_invitations').insert({
    occurrence_id: occurrence.id,
    inviter_id: owner.user.id,
    invitee_id: nonOwner.user.id,
  });
  assert.equal(insertError, null);

  const { error } = await owner.client.rpc('delete_event_occurrence', {
    p_occurrence_id: occurrence.id,
  });
  assert.ok(error, 'expected the delete to be blocked by an existing invitation');
  assert.equal(error.code, '90001');
  assert.equal(await occurrenceExists(occurrence.id), true);
});

void test('a blocked occurrence delete does not disturb an unrelated occurrence’s downstream data', async () => {
  const { occurrence: blockedOccurrence } = await createEventWithOccurrence(owner);
  await setParticipation(nonOwner, blockedOccurrence.id, 'considering');
  const { occurrence: unrelatedOccurrence } = await createEventWithOccurrence(owner);
  await setParticipation(nonOwner, unrelatedOccurrence.id, 'attending');

  const { error } = await owner.client.rpc('delete_event_occurrence', {
    p_occurrence_id: blockedOccurrence.id,
  });
  assert.ok(error);
  assert.equal(error.code, '90001');

  const { data: unrelatedParticipation, error: readError } = await nonOwner.client
    .from('occurrence_participations')
    .select()
    .eq('occurrence_id', unrelatedOccurrence.id)
    .single();
  assert.equal(readError, null);
  assert.equal(unrelatedParticipation.status, 'attending');
});

// --- Event delete: positive ---

void test('owner can delete a 0-occurrence event', async () => {
  const { event } = await createEventWithoutOccurrence(owner, '2031-01-01', '2031-01-31');
  const { error } = await owner.client.rpc('delete_event', { p_event_id: event.id });
  assert.equal(error, null);
  assert.equal(await eventExists(event.id), false);
});

void test('owner can atomically delete an event whose children are all safe to delete', async () => {
  const { event } = await createEventWithoutOccurrence(owner, '2031-02-01', '2031-02-10');
  const { data: occA, error: insertAError } = await owner.client
    .from('event_occurrences')
    .insert({ event_id: event.id, starts_at: '2031-02-02T10:00:00Z' })
    .select()
    .single();
  assert.equal(insertAError, null);
  const { data: occB, error: insertBError } = await owner.client
    .from('event_occurrences')
    .insert({ event_id: event.id, starts_at: '2031-02-05T10:00:00Z' })
    .select()
    .single();
  assert.equal(insertBError, null);

  const { error } = await owner.client.rpc('delete_event', { p_event_id: event.id });
  assert.equal(error, null);
  assert.equal(await eventExists(event.id), false);
  assert.equal(await occurrenceExists(occA.id), false);
  assert.equal(await occurrenceExists(occB.id), false);
});

// --- Event delete: negative permission ---

void test('non-owner cannot delete another owner’s event', async () => {
  const { event } = await createEventWithoutOccurrence(owner, '2031-03-01', '2031-03-31');
  const { error } = await nonOwner.client.rpc('delete_event', { p_event_id: event.id });
  assert.ok(error, 'expected a permission error for a non-owner delete');
  assert.equal(error.code, '42501');
  assert.equal(await eventExists(event.id), true);
});

void test('anonymous cannot delete an event', async () => {
  const { event } = await createEventWithoutOccurrence(owner, '2031-04-01', '2031-04-30');
  const anon = createAnonymousClient();
  const { error } = await anon.rpc('delete_event', { p_event_id: event.id });
  assert.ok(error, 'expected a permission error for an anonymous delete');
  assert.equal(await eventExists(event.id), true);
});

// --- Event delete: partial-block invariant (no cascade, all-or-nothing) ---

void test('one unsafe child rejects the whole event delete - no partial delete', async () => {
  const { event } = await createEventWithoutOccurrence(owner, '2031-05-01', '2031-05-10');
  const { data: safeOcc, error: insertSafeError } = await owner.client
    .from('event_occurrences')
    .insert({ event_id: event.id, starts_at: '2031-05-02T10:00:00Z' })
    .select()
    .single();
  assert.equal(insertSafeError, null);
  const { data: unsafeOcc, error: insertUnsafeError } = await owner.client
    .from('event_occurrences')
    .insert({ event_id: event.id, starts_at: '2031-05-05T10:00:00Z' })
    .select()
    .single();
  assert.equal(insertUnsafeError, null);
  await setParticipation(nonOwner, unsafeOcc.id, 'considering');

  const { error } = await owner.client.rpc('delete_event', { p_event_id: event.id });
  assert.ok(error, 'expected the whole event delete to be rejected');
  assert.equal(error.code, '90001');

  // Nothing was removed: not the event, not the safe child, not the unsafe
  // child, and not the participation blocking it.
  assert.equal(await eventExists(event.id), true);
  assert.equal(await occurrenceExists(safeOcc.id), true);
  assert.equal(await occurrenceExists(unsafeOcc.id), true);
  const { data: participation, error: readError } = await nonOwner.client
    .from('occurrence_participations')
    .select()
    .eq('occurrence_id', unsafeOcc.id)
    .single();
  assert.equal(readError, null);
  assert.equal(participation.status, 'considering');
});

void test('a rejected event delete does not disturb an unrelated event owned by someone else', async () => {
  const { event: blockedEvent, occurrence: blockedOccurrence } =
    await createEventWithOccurrence(owner);
  await setParticipation(nonOwner, blockedOccurrence.id, 'considering');

  const { event: unrelatedEvent } = await createEventWithoutOccurrence(
    otherOwner,
    '2031-07-01',
    '2031-07-31',
  );

  const { error } = await owner.client.rpc('delete_event', { p_event_id: blockedEvent.id });
  assert.ok(error, 'expected the blocked event delete to be rejected');
  assert.equal(error.code, '90001');

  assert.equal(await eventExists(blockedEvent.id), true);
  assert.equal(await eventExists(unrelatedEvent.id), true);
});

// --- Race safety (Issue #124: FOR UPDATE locking closes the guard-check-
// then-delete window; see the migration's own comment for the mechanism) ---
//
// Uses raw pg.Client connections (not the typed, RLS-governed actor.client)
// so each side of the race can be controlled explicitly and proven to
// actually block (via pg_stat_activity), the same technique
// test/rls/eventRangeConcurrency.test.ts uses for the Issue #88 containment
// invariant. delete_event_occurrence is SECURITY DEFINER, so its ownership
// check reads auth.uid() - simulated on a raw connection the same way
// PostgREST itself establishes request context, by setting
// request.jwt.claim.sub for the duration of the transaction.

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

interface DeleteAttemptOutcome {
  committed: boolean;
  code: string | null;
}

void test('race safety: a participation insert blocked mid-delete correctly fails once the occurrence is gone', async () => {
  const admin = await newClient();
  const txDelete = await newClient();
  const txInsert = await newClient();
  try {
    const { occurrence } = await createEventWithOccurrence(owner);
    const insertPid = await backendPid(txInsert);

    await txDelete.query('begin');
    await actAsAuthenticated(txDelete, owner.user.id);
    await txDelete.query('select public.delete_event_occurrence($1)', [occurrence.id]);
    // txDelete has run the guard check (found nothing) and issued the
    // DELETE, but has not committed - the row's lock is still held.

    const insertResult = (async () => {
      await txInsert.query('begin');
      try {
        await txInsert.query(
          'insert into public.occurrence_participations (occurrence_id, user_id, status) values ($1, $2, $3)',
          [occurrence.id, nonOwner.user.id, 'considering'],
        );
        await txInsert.query('commit');
        return { committed: true };
      } catch {
        await txInsert.query('rollback').catch(() => {});
        return { committed: false };
      }
    })();

    await waitUntilBlocked(admin, insertPid);
    await txDelete.query('commit');
    const outcome = await insertResult;

    assert.equal(
      outcome.committed,
      false,
      'expected the participation insert to fail its FK check once it sees the occurrence is gone',
    );
    assert.equal(await occurrenceExists(occurrence.id), false);
  } finally {
    await txDelete.end();
    await txInsert.end();
    await admin.end();
  }
});

void test('race safety: a delete blocked by an in-flight participation insert correctly rejects once it commits', async () => {
  const admin = await newClient();
  const txInsert = await newClient();
  const txDelete = await newClient();
  try {
    const { occurrence } = await createEventWithOccurrence(owner);
    const deletePid = await backendPid(txDelete);

    await txInsert.query('begin');
    await txInsert.query(
      'insert into public.occurrence_participations (occurrence_id, user_id, status) values ($1, $2, $3)',
      [occurrence.id, nonOwner.user.id, 'considering'],
    );
    // txInsert's FK check holds a FOR KEY SHARE lock on the occurrence row,
    // uncommitted - this is what txDelete's FOR UPDATE below must wait on.

    const deleteResult: Promise<DeleteAttemptOutcome> = (async () => {
      await txDelete.query('begin');
      await actAsAuthenticated(txDelete, owner.user.id);
      try {
        await txDelete.query('select public.delete_event_occurrence($1)', [occurrence.id]);
        await txDelete.query('commit');
        return { committed: true, code: null };
      } catch (error) {
        await txDelete.query('rollback').catch(() => {});
        return { committed: false, code: pgErrorCode(error) };
      }
    })();

    await waitUntilBlocked(admin, deletePid);
    await txInsert.query('commit');
    const outcome = await deleteResult;

    assert.equal(
      outcome.committed,
      false,
      'expected the delete to be rejected once it sees the committed participation',
    );
    assert.equal(outcome.code, '90001');
    assert.equal(await occurrenceExists(occurrence.id), true);
  } finally {
    await txInsert.end();
    await txDelete.end();
    await admin.end();
  }
});
