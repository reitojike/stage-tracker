import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  getEventWithOccurrences,
  listEventCatalog,
  listEventCatalogInRange,
  listEventCatalogOnDate,
  listEventOccurrences,
} from '../../src/infrastructure/supabase/eventCatalogRead.ts';
import {
  tokyoCalendarDateFromInstant,
  tokyoCalendarDayRangeUtc,
} from '../../src/domain/eventCatalog.ts';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';
import {
  createEventWithOccurrence,
  createEventWithoutOccurrence,
  eventFixtureTitle,
} from './support/eventFixtures.ts';
import { requireOk } from './support/result.ts';

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
  // actorA produces the fixture catalog, so it needs designated catalog
  // creator membership (Issue #29). actorB reads it without that
  // membership, which is also the point: shared catalog read stays open to
  // every authenticated user regardless of who may write.
  actorA = await createTestActor('rls-read-a', PASSWORD, { designatedCatalogCreator: true });
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

function secondsAfter(isoStart: string, offsetSeconds: number): string {
  return new Date(new Date(isoStart).getTime() + offsetSeconds * 1000).toISOString();
}

/**
 * Inserts occurrences directly (bypassing create_event,
 * which only creates one at a time) in bounded-size batches, so tests can
 * cheaply produce more rows than supabase/config.toml's `api.max_rows`
 * (1000) without one request per row.
 */
async function bulkInsertOccurrences(
  actor: TestActor,
  eventId: string,
  startTimes: readonly string[],
): Promise<void> {
  const INSERT_BATCH_SIZE = 500;
  for (let start = 0; start < startTimes.length; start += INSERT_BATCH_SIZE) {
    const batch = startTimes
      .slice(start, start + INSERT_BATCH_SIZE)
      .map((startsAt) => ({ event_id: eventId, starts_at: startsAt }));
    const { error } = await actor.client.from('event_occurrences').insert(batch);
    if (error !== null) {
      throw new Error(`bulk occurrence insert failed: ${error.message}`);
    }
  }
}

// --- Pagination past api.max_rows (1000): P1 fix for PR #19 / Issue #12 ---
//
// supabase/config.toml caps any single PostgREST response at `api.max_rows`
// (1000) silently - no error, no indication of truncation. Before the fix,
// listEventCatalog/listEventCatalogInRange/listEventOccurrences (and
// getEventWithOccurrences, which calls listEventOccurrences) each did a
// single unranged `.select()`, so a table/event/period with more than 1000
// matching rows would silently lose everything past the cap. These tests
// prove real rows past that boundary are not lost.

void test('listEventOccurrences: returns every occurrence for one event even past api.max_rows (1000)', async () => {
  const TOTAL = 1200;
  const baseInstant = '2026-11-01T00:00:00.000Z';
  const { event, occurrence: first } = await createEventWithOccurrence(actorA, {
    title: eventFixtureTitle(),
    startsAt: secondsAfter(baseInstant, 0),
  });
  const remainingStartTimes = Array.from({ length: TOTAL - 1 }, (_, i) =>
    secondsAfter(baseInstant, i + 1),
  );
  await bulkInsertOccurrences(actorA, event.id, remainingStartTimes);

  const occurrences = requireOk(await listEventOccurrences(actorB.client, event.id));
  assert.equal(
    occurrences.length,
    TOTAL,
    'expected every occurrence, not just the first max_rows worth',
  );
  assert.ok(occurrences.some((occ) => occ.id === first.id));

  const expectedOrder = [...occurrences]
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id))
    .map((occ) => occ.id);
  assert.deepEqual(
    occurrences.map((occ) => occ.id),
    expectedOrder,
    'expected deterministic starts_at/id ordering to hold across the full, paginated result',
  );
});

void test('listEventCatalogInRange: an event whose only in-range occurrence sorts past api.max_rows (1000) earlier ones is still returned', async () => {
  const date = '2026-11-05';
  const dayRange = tokyoCalendarDayRangeUtc(date);
  const FILLER_TOTAL = 1005;

  const { event: fillerEvent, occurrence: fillerFirst } = await createEventWithOccurrence(actorA, {
    title: eventFixtureTitle(),
    startsAt: secondsAfter(dayRange.startUtc, 0),
  });
  const remainingFillerStartTimes = Array.from({ length: FILLER_TOTAL - 1 }, (_, i) =>
    secondsAfter(dayRange.startUtc, i + 1),
  );
  await bulkInsertOccurrences(actorA, fillerEvent.id, remainingFillerStartTimes);

  // Chronologically last that day - past every filler occurrence above (all
  // within the first ~17 minutes of the day), and past position 1000 in
  // starts_at order.
  const { event: targetEvent, occurrence: targetOccurrence } = await createEventWithOccurrence(
    actorA,
    { title: eventFixtureTitle(), startsAt: secondsAfter(dayRange.startUtc, 20 * 60 * 60) },
  );

  const data = requireOk(await listEventCatalogInRange(actorB.client, dayRange));

  const fillerGroup = data.find((group) => group.event.id === fillerEvent.id);
  assert.ok(fillerGroup, 'expected the filler event (>1000 occurrences that day) to be present');
  assert.equal(fillerGroup.occurrences.length, FILLER_TOTAL);
  assert.ok(fillerGroup.occurrences.some((occ) => occ.id === fillerFirst.id));

  const targetGroup = data.find((group) => group.event.id === targetEvent.id);
  assert.ok(
    targetGroup,
    'expected the event whose only occurrence sorts past the 1000-row cap to still be returned, ' +
      'not silently dropped by an unpaginated read',
  );
  assert.deepEqual(
    targetGroup.occurrences.map((occ) => occ.id),
    [targetOccurrence.id],
  );
});

void test('listEventCatalogInRange: parent event lookup is batched past the id-batch size and drops none', async () => {
  const date = '2026-11-06';
  const dayRange = tokyoCalendarDayRangeUtc(date);
  const EVENT_COUNT = 250; // > this module's internal id-batch size (200)
  const CONCURRENCY = 25;

  const created: Awaited<ReturnType<typeof createEventWithOccurrence>>[] = [];
  for (let start = 0; start < EVENT_COUNT; start += CONCURRENCY) {
    const indexes = Array.from(
      { length: Math.min(CONCURRENCY, EVENT_COUNT - start) },
      (_, i) => start + i,
    );
    const batch = await Promise.all(
      indexes.map((i) =>
        createEventWithOccurrence(actorA, {
          title: eventFixtureTitle(),
          startsAt: secondsAfter(dayRange.startUtc, i),
        }),
      ),
    );
    created.push(...batch);
  }

  const data = requireOk(await listEventCatalogInRange(actorB.client, dayRange));
  const returnedEventIds = new Set(data.map((group) => group.event.id));
  for (const { event } of created) {
    assert.ok(
      returnedEventIds.has(event.id),
      `expected event ${event.id} to be present - batched parent event lookup must not drop ids past the first batch`,
    );
  }
  assert.equal(data.length, EVENT_COUNT);
});

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

// Issue #88: listEventCatalogOnDate's own contract ("その日に公演回がある
// event") is narrower than listEventCatalogInRange's - a range-only event
// whose Event range covers the day but has no occurrence on it must not
// leak through the day-scoped wrapper, even though the period-scoped
// function it wraps deliberately includes such events.
void test('listEventCatalogOnDate: a range-only event covering the day but with no occurrence on it is absent', async () => {
  const { event } = await createEventWithoutOccurrence(actorA, '2027-06-01', '2027-06-30', {
    title: eventFixtureTitle(),
  });
  const data = requireOk(await listEventCatalogOnDate(actorB.client, '2027-06-15'));
  assert.ok(
    !data.some((group) => group.event.id === event.id),
    'expected a range-only event with no occurrence on this specific day to be absent',
  );
});

// --- listEventCatalogInRange: Event range overlap, independent of occurrences (Issue #88) ---

void test('listEventCatalogInRange: a 0-occurrence event is surfaced when its Event range overlaps the period', async () => {
  const rangeStart = '2027-01-05';
  const rangeEnd = '2027-01-15';
  const { event } = await createEventWithoutOccurrence(actorA, rangeStart, rangeEnd, {
    title: eventFixtureTitle(),
  });

  const queryRange = tokyoCalendarDayRangeUtc('2027-01-10');
  const data = requireOk(await listEventCatalogInRange(actorB.client, queryRange));
  const group = data.find((g) => g.event.id === event.id);
  assert.ok(
    group,
    'expected a 0-occurrence event whose Event range overlaps the queried period to be present',
  );
  assert.deepEqual(group.occurrences, []);
});

void test('listEventCatalogInRange: an event outside the query range on both axes stays absent', async () => {
  const { event } = await createEventWithoutOccurrence(actorA, '2027-02-01', '2027-02-05', {
    title: eventFixtureTitle(),
  });
  const queryRange = tokyoCalendarDayRangeUtc('2027-03-01');
  const data = requireOk(await listEventCatalogInRange(actorB.client, queryRange));
  assert.ok(
    !data.some((g) => g.event.id === event.id),
    'expected an event whose range does not overlap the query period to be absent',
  );
});

void test('listEventCatalogInRange: an event matching both the occurrence-based and range-overlap queries appears exactly once, with its real occurrences', async () => {
  const rangeStart = '2027-04-05';
  const rangeEnd = '2027-04-15';
  const queryDate = '2027-04-10';
  const queryRange = tokyoCalendarDayRangeUtc(queryDate);
  const { event, occurrence } = await createEventWithOccurrence(actorA, {
    title: eventFixtureTitle(),
    startsAt: queryRange.startUtc,
    startsOn: rangeStart,
    endsOn: rangeEnd,
  });

  const data = requireOk(await listEventCatalogInRange(actorB.client, queryRange));
  const matches = data.filter((g) => g.event.id === event.id);
  assert.equal(matches.length, 1, 'expected the event to appear exactly once, not duplicated');
  assert.deepEqual(
    matches[0]?.occurrences.map((occ) => occ.id),
    [occurrence.id],
    'expected the occurrence-bearing entry (real data), not an empty range-overlap-only entry',
  );
});

void test('listEventCatalogInRange: occurrence-bearing events sort before range-overlap-only events', async () => {
  const queryDate = '2027-05-10';
  const queryRange = tokyoCalendarDayRangeUtc(queryDate);

  const { event: rangeOnlyEvent } = await createEventWithoutOccurrence(
    actorA,
    '2027-05-01',
    '2027-05-20',
    { title: eventFixtureTitle() },
  );
  const { event: occurrenceEvent } = await createEventWithOccurrence(actorA, {
    title: eventFixtureTitle(),
    startsAt: queryRange.startUtc,
    startsOn: queryDate,
    endsOn: queryDate,
  });

  const data = requireOk(await listEventCatalogInRange(actorB.client, queryRange));
  const occurrenceIndex = data.findIndex((g) => g.event.id === occurrenceEvent.id);
  const rangeOnlyIndex = data.findIndex((g) => g.event.id === rangeOnlyEvent.id);
  assert.ok(occurrenceIndex !== -1 && rangeOnlyIndex !== -1);
  assert.ok(
    occurrenceIndex < rangeOnlyIndex,
    'expected the occurrence-bearing event to sort before the range-overlap-only event',
  );
});

// --- listEventOccurrences: per-event ordering ---

void test('listEventOccurrences: an event’s occurrences are returned in starts_at order', async () => {
  const firstStartsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const secondStartsAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const { event, occurrence: first } = await createEventWithOccurrence(actorA, {
    title: eventFixtureTitle(),
    startsAt: firstStartsAt,
    // The second occurrence inserted below lands on a later Tokyo calendar
    // day than the fixture's own (single-day, by default) Event range - the
    // range has to be widened to cover both (Issue #88 containment
    // invariant).
    endsOn: tokyoCalendarDateFromInstant(secondStartsAt),
  });
  const { data: second, error: secondError } = await actorA.client
    .from('event_occurrences')
    .insert({
      event_id: event.id,
      starts_at: secondStartsAt,
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
