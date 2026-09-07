import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';
import { createEventWithOccurrence, eventFixtureTitle } from './support/eventFixtures.ts';

// Real local Supabase/Postgres tests for reschedule_event (Issue #87/#88):
// the atomic owner-authenticated path that moves an event's Event range
// together with its occurrences, deferring the cross-table containment
// constraint triggers (20260825000200_add_event_range_containment_triggers.sql)
// to the end of its own transaction so this can succeed even when neither a
// range-first nor an occurrence-first plain UPDATE could
// (product-rules.md "Mutable / system-managed fields").

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let actorA: TestActor;
let actorB: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  actorA = await createTestActor('reschedule-owner', PASSWORD, { designatedCatalogCreator: true });
  createdActors.push(actorA);
  actorB = await createTestActor('reschedule-other', PASSWORD);
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

void test('owner atomically moves an event range together with its occurrence past what either update could do alone', async () => {
  const { event, occurrence } = await createEventWithOccurrence(actorA, {
    title: eventFixtureTitle(),
    startsOn: '2027-06-01',
    endsOn: '2027-06-10',
    startsAt: '2027-06-05T10:00:00+09:00',
  });

  // Neither order works as a plain UPDATE: moving the range first leaves it
  // not yet containing the still-old occurrence; moving the occurrence
  // first leaves it outside the still-old range. This is exactly the
  // deadlock reschedule_event exists to avoid.
  const { data, error } = await actorA.client.rpc('reschedule_event', {
    p_event_id: event.id,
    p_starts_on: '2027-07-01',
    p_ends_on: '2027-07-10',
    p_occurrences: [
      {
        id: occurrence.id,
        startsAt: '2027-07-05T10:00:00+09:00',
        endsAt: null,
        doorsAt: null,
      },
    ],
  });
  assert.equal(error, null);
  assert.equal(data.length, 1);
  assert.ok(data[0]);
  assert.equal(new Date(data[0].starts_at).toISOString(), '2027-07-05T01:00:00.000Z');

  const { data: refetchedEvent } = await actorA.client
    .from('events')
    .select('starts_on, ends_on')
    .eq('id', event.id)
    .single();
  assert.ok(refetchedEvent);
  assert.equal(refetchedEvent.starts_on, '2027-07-01');
  assert.equal(refetchedEvent.ends_on, '2027-07-10');
});

void test('reschedule_event carries an unnamed occurrence through unchanged, and it is still checked against the new range', async () => {
  const { event, occurrence } = await createEventWithOccurrence(actorA, {
    title: eventFixtureTitle(),
    startsOn: '2027-08-01',
    endsOn: '2027-08-10',
    startsAt: '2027-08-05T10:00:00+09:00',
  });

  // A range change that does not carry the existing occurrence's id in the
  // payload is a plain "move the range without moving occurrences" request
  // - it must fail exactly when a bare events UPDATE would, since the
  // occurrence is left at its old (now out-of-range) time.
  const { error } = await actorA.client.rpc('reschedule_event', {
    p_event_id: event.id,
    p_starts_on: '2027-09-01',
    p_ends_on: '2027-09-10',
    p_occurrences: [],
  });
  assert.ok(error, 'expected the containment trigger to reject the unmoved occurrence');
  assert.equal(error.code, '23514');

  const { data: refetchedEvent } = await actorA.client
    .from('events')
    .select('starts_on, ends_on')
    .eq('id', event.id)
    .single();
  assert.ok(refetchedEvent);
  assert.equal(refetchedEvent.starts_on, '2027-08-01', 'expected the range update to roll back');
  assert.equal(refetchedEvent.ends_on, '2027-08-10');

  const { data: refetchedOccurrence } = await actorA.client
    .from('event_occurrences')
    .select('starts_at')
    .eq('id', occurrence.id)
    .single();
  assert.ok(refetchedOccurrence);
  assert.equal(
    new Date(refetchedOccurrence.starts_at).toISOString(),
    new Date(occurrence.starts_at).toISOString(),
  );
});

void test('a widening range that already contains every occurrence unchanged succeeds', async () => {
  const { event } = await createEventWithOccurrence(actorA, {
    title: eventFixtureTitle(),
    startsOn: '2027-10-05',
    endsOn: '2027-10-05',
    startsAt: '2027-10-05T10:00:00+09:00',
  });

  const { error } = await actorA.client.rpc('reschedule_event', {
    p_event_id: event.id,
    p_starts_on: '2027-10-01',
    p_ends_on: '2027-10-10',
    p_occurrences: [],
  });
  assert.equal(error, null);
});

void test('a non-owner cannot reschedule another user’s event', async () => {
  const { event, occurrence } = await createEventWithOccurrence(actorA, {
    title: eventFixtureTitle(),
    startsOn: '2027-11-01',
    endsOn: '2027-11-10',
    startsAt: '2027-11-05T10:00:00+09:00',
  });

  const { error } = await actorB.client.rpc('reschedule_event', {
    p_event_id: event.id,
    p_starts_on: '2027-12-01',
    p_ends_on: '2027-12-10',
    p_occurrences: [
      { id: occurrence.id, startsAt: '2027-12-05T10:00:00+09:00', endsAt: null, doorsAt: null },
    ],
  });
  assert.ok(error, 'expected a permission error for a non-owner reschedule');
  assert.equal(error.code, '42501');

  const { data: refetchedEvent } = await actorA.client
    .from('events')
    .select('starts_on, ends_on')
    .eq('id', event.id)
    .single();
  assert.ok(refetchedEvent);
  assert.equal(refetchedEvent.starts_on, '2027-11-01');
  assert.equal(refetchedEvent.ends_on, '2027-11-10');
});

void test('anonymous cannot execute reschedule_event', async () => {
  const { event, occurrence } = await createEventWithOccurrence(actorA, {
    title: eventFixtureTitle(),
    startsOn: '2028-01-01',
    endsOn: '2028-01-10',
    startsAt: '2028-01-05T10:00:00+09:00',
  });
  const anon = createAnonymousClient();
  const { error } = await anon.rpc('reschedule_event', {
    p_event_id: event.id,
    p_starts_on: '2028-02-01',
    p_ends_on: '2028-02-10',
    p_occurrences: [
      { id: occurrence.id, startsAt: '2028-02-05T10:00:00+09:00', endsAt: null, doorsAt: null },
    ],
  });
  assert.ok(error, 'expected a permission error for anonymous execute');
});

void test('an occurrence id in the payload that does not belong to the event is rejected', async () => {
  const { event: eventA } = await createEventWithOccurrence(actorA, {
    title: eventFixtureTitle(),
    startsOn: '2028-03-01',
    endsOn: '2028-03-10',
    startsAt: '2028-03-05T10:00:00+09:00',
  });
  const { occurrence: occurrenceB } = await createEventWithOccurrence(actorA, {
    title: eventFixtureTitle(),
    startsOn: '2028-03-01',
    endsOn: '2028-03-10',
    startsAt: '2028-03-06T10:00:00+09:00',
  });

  const { error } = await actorA.client.rpc('reschedule_event', {
    p_event_id: eventA.id,
    p_starts_on: '2028-04-01',
    p_ends_on: '2028-04-10',
    p_occurrences: [
      { id: occurrenceB.id, startsAt: '2028-04-05T10:00:00+09:00', endsAt: null, doorsAt: null },
    ],
  });
  assert.ok(error, 'expected a mismatched-count error for an occurrence id from a different event');
  assert.equal(error.code, '23514');
});
