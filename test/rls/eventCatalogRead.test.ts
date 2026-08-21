import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  getEventWithOccurrences,
  listEventCatalog,
  listEventCatalogInRange,
  listEventCatalogOnDate,
  listEventOccurrences,
} from '../../src/infrastructure/supabase/eventCatalogRead.ts';
import { tokyoCalendarDayRangeUtc } from '../../src/domain/eventCatalog.ts';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';
import { createEventWithOccurrence, eventFixtureTitle } from './support/eventFixtures.ts';

// Real local Supabase/Postgres tests for the typed event catalog read
// layer itself (Issue #12), as opposed to test/rls/events.test.ts and
// eventOccurrences.test.ts, which exercise the raw tables directly. Every
// assertion here goes through src/infrastructure/supabase/eventCatalogRead.ts
// - the same functions a future authenticated Event catalog UI would call -
// so a passing run here is evidence the feature-level boundary actually
// works against the real DB/RLS baseline, not just that the tables do.
//
// Client conventions mirror test/rls/events.test.ts: an anon-key client
// with no session (anonymous), or signed in as a real test user
// (authenticated). service_role is only used in ./support/testActors.ts for
// fixture setup/teardown.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let actorA: TestActor;
let actorB: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  actorA = await createTestActor('rls-read-a', PASSWORD);
  createdActors.push(actorA);
  actorB = await createTestActor('rls-read-b', PASSWORD);
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

function requireOk<T>(result: { ok: true; data: T } | { ok: false; error: unknown }): T {
  assert.ok(
    result.ok,
    `expected ok:true, got error: ${JSON.stringify('error' in result ? result.error : null)}`,
  );
  return result.data;
}

// --- listEventCatalog: shared catalog read, authenticated ---

void test('listEventCatalog: authenticated user reads another user’s event and its occurrence through the read layer', async () => {
  const title = eventFixtureTitle();
  const { event, occurrence } = await createEventWithOccurrence(actorA, { title });

  const data = requireOk(await listEventCatalog(actorB.client));
  const found = data.find((group) => group.event.id === event.id);
  assert.ok(found, 'expected actor B to see actor A’s event via the shared catalog read layer');
  assert.equal(found.event.title, title);
  assert.deepEqual(
    found.occurrences.map((occ) => occ.id),
    [occurrence.id],
  );
});

// --- listEventCatalogInRange / listEventCatalogOnDate: period/day scoping ---

void test('listEventCatalogInRange: only returns events with an occurrence inside the range, and only those occurrences', async () => {
  const insideDate = '2026-09-10';
  const outsideDate = '2026-09-20';
  const insideRange = tokyoCalendarDayRangeUtc(insideDate);

  const { event: insideEvent, occurrence: insideOccurrence } = await createEventWithOccurrence(
    actorA,
    { title: eventFixtureTitle(), startsAt: insideRange.startUtc },
  );
  const outsideRange = tokyoCalendarDayRangeUtc(outsideDate);
  const { event: outsideEvent } = await createEventWithOccurrence(actorA, {
    title: eventFixtureTitle(),
    startsAt: outsideRange.startUtc,
  });

  const data = requireOk(await listEventCatalogInRange(actorB.client, insideRange));
  assert.ok(
    data.some((group) => group.event.id === insideEvent.id),
    'expected the in-range event to be present',
  );
  assert.ok(
    !data.some((group) => group.event.id === outsideEvent.id),
    'expected the out-of-range event to be absent, not fabricated',
  );

  const insideGroup = data.find((group) => group.event.id === insideEvent.id);
  assert.ok(insideGroup);
  assert.deepEqual(
    insideGroup.occurrences.map((occ) => occ.id),
    [insideOccurrence.id],
  );
});

void test('listEventCatalogOnDate: same-day multiple occurrences for one event are not lost', async () => {
  const date = '2026-09-11';
  const dayRange = tokyoCalendarDayRangeUtc(date);
  const matineeStartsAt = new Date(
    new Date(dayRange.startUtc).getTime() + 2 * 60 * 60 * 1000,
  ).toISOString();
  const eveningStartsAt = new Date(
    new Date(dayRange.startUtc).getTime() + 10 * 60 * 60 * 1000,
  ).toISOString();

  const { event, occurrence: matinee } = await createEventWithOccurrence(actorA, {
    title: eventFixtureTitle(),
    startsAt: matineeStartsAt,
  });
  const { data: evening, error: eveningError } = await actorA.client
    .from('event_occurrences')
    .insert({ event_id: event.id, starts_at: eveningStartsAt })
    .select()
    .single();
  assert.equal(eveningError, null);
  assert.ok(evening);

  const data = requireOk(await listEventCatalogOnDate(actorB.client, date));
  const group = data.find((g) => g.event.id === event.id);
  assert.ok(group, 'expected the event to appear for the day both its occurrences fall on');
  assert.deepEqual(group.occurrences.map((occ) => occ.id).sort(), [matinee.id, evening.id].sort());
});

void test('listEventCatalogOnDate: an empty period returns an empty result, not a fabricated day', async () => {
  // A far-future date no fixture in this test file ever schedules an
  // occurrence on, so this is an empty-period read against real Postgres/RLS.
  const data = requireOk(await listEventCatalogOnDate(actorB.client, '2099-01-01'));
  assert.deepEqual(data, []);
});

// --- listEventOccurrences: per-event ordering ---

void test('listEventOccurrences: an event’s occurrences are returned in starts_at order', async () => {
  const { event, occurrence: first } = await createEventWithOccurrence(actorA, {
    title: eventFixtureTitle(),
    startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
  const { data: second, error: secondError } = await actorA.client
    .from('event_occurrences')
    .insert({
      event_id: event.id,
      starts_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single();
  assert.equal(secondError, null);
  assert.ok(second);

  const occurrences = requireOk(await listEventOccurrences(actorB.client, event.id));
  assert.deepEqual(
    occurrences.map((occ) => occ.id),
    [first.id, second.id],
  );
});

// --- getEventWithOccurrences: single-event read, nullable ends_at ---

void test('getEventWithOccurrences: reads an event with an unset ends_at preserved as null', async () => {
  const { event } = await createEventWithOccurrence(actorA, { title: eventFixtureTitle() });

  const data = requireOk(await getEventWithOccurrences(actorB.client, event.id));
  assert.ok(data);
  assert.equal(data.event.id, event.id);
  assert.equal(data.occurrences.length, 1);
  assert.equal(data.occurrences[0]?.endsAt, null);
});

void test('getEventWithOccurrences: a non-existent event id is a null result, not an error', async () => {
  const data = requireOk(await getEventWithOccurrences(actorA.client, crypto.randomUUID()));
  assert.equal(data, null);
});

// --- Anonymous: RLS denies through the read layer, not application filtering ---

void test('listEventCatalog: anonymous gets an error result, not an empty (application-filtered) result', async () => {
  await createEventWithOccurrence(actorA, { title: eventFixtureTitle() });
  const anon = createAnonymousClient();

  const result = await listEventCatalog(anon);
  assert.equal(result.ok, false, 'expected RLS to surface as a read error for an anonymous caller');
});

void test('listEventCatalogInRange: anonymous gets an error result', async () => {
  const anon = createAnonymousClient();
  const result = await listEventCatalogInRange(anon, tokyoCalendarDayRangeUtc('2026-09-10'));
  assert.equal(result.ok, false, 'expected RLS to surface as a read error for an anonymous caller');
});

void test('listEventOccurrences: anonymous gets an error result', async () => {
  const { event } = await createEventWithOccurrence(actorA, { title: eventFixtureTitle() });
  const anon = createAnonymousClient();

  const result = await listEventOccurrences(anon, event.id);
  assert.equal(result.ok, false, 'expected RLS to surface as a read error for an anonymous caller');
});

void test('getEventWithOccurrences: anonymous gets an error result, not a fabricated null/not-found', async () => {
  const { event } = await createEventWithOccurrence(actorA, { title: eventFixtureTitle() });
  const anon = createAnonymousClient();

  const result = await getEventWithOccurrences(anon, event.id);
  assert.equal(
    result.ok,
    false,
    'expected an anonymous read to surface as a permission error, not a null (not-found) result - ' +
      'a null result here would be indistinguishable from RLS being silently substituted by application filtering',
  );
});
