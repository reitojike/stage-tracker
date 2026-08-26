import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
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
import { createAcquisition } from './support/ticketFixtures.ts';

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
// - Cancellation never touches existing participation/invitation/ticket
//   acquisition rows.
// - New active commitments (new participation, `considering -> attending`,
//   new invitation, new ticket acquisition) are rejected (SQLSTATE 90002)
//   on an effectively-canceled occurrence; withdrawal (participation
//   DELETE) and unrelated updates stay available.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

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

// --- Effective cancellation guard: new ticket acquisition ---

void test('a new ticket acquisition is rejected once effectively canceled', async () => {
  const { occurrence } = await createEventWithOccurrence(owner);
  await owner.client
    .from('event_occurrences')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', occurrence.id);

  const { error } = await nonOwner.client
    .from('ticket_acquisitions')
    .insert({ owner_id: nonOwner.user.id, occurrence_id: occurrence.id });
  assert.ok(error, 'expected the ticket acquisition insert to be rejected');
  assert.equal(error.code, '90002');
});

void test('a new ticket acquisition succeeds on a not-canceled occurrence', async () => {
  const { occurrence } = await createEventWithOccurrence(owner);
  const acquisition = await createAcquisition(nonOwner, occurrence.id);
  assert.equal(acquisition.occurrence_id, occurrence.id);
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

void test('canceling an occurrence does not remove or change existing participation/invitation/ticket acquisition rows', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(owner, nonOwner);
  const acquisition = await createAcquisition(nonOwner, occurrenceId, { status: 'secured' });

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

  const { data: acquisitionRow, error: acquisitionError } = await nonOwner.client
    .from('ticket_acquisitions')
    .select()
    .eq('id', acquisition.id)
    .single();
  assert.equal(acquisitionError, null);
  assert.equal(acquisitionRow.status, 'secured');
});
