import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  groupHomeUpcomingItemsByDate,
  HOME_UPCOMING_LIMIT,
  selectHomeUpcomingItems,
  type HomeUpcomingItem,
  type HomeUpcomingOccurrenceCandidate,
  type HomeUpcomingScheduleCandidate,
} from '../homeUpcoming.ts';
import type { EventCatalogEvent, EventOccurrence } from '../eventCatalog.ts';
import type { Participation } from '../participation.ts';
import type { PersonalScheduleEntry } from '../personalSchedule.ts';

function event(overrides: Partial<EventCatalogEvent> = {}): EventCatalogEvent {
  return {
    id: 'event-1',
    ownerId: 'owner-1',
    title: 'Test Event',
    venue: null,
    sourceUrl: null,
    memo: null,
    startsOn: '2026-01-01',
    endsOn: '2026-12-31',
    canceledAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function occurrence(overrides: Partial<EventOccurrence> = {}): EventOccurrence {
  return {
    id: 'occ-1',
    eventId: 'event-1',
    doorsAt: null,
    startsAt: '2026-08-10T10:00:00Z',
    endsAt: null,
    canceledAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function participation(overrides: Partial<Participation> = {}): Participation {
  return {
    id: 'p-1',
    occurrenceId: 'occ-1',
    userId: 'user-1',
    status: 'attending',
    visibility: 'private',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function scheduleEntry(overrides: Partial<PersonalScheduleEntry> = {}): PersonalScheduleEntry {
  return {
    id: 'sched-1',
    ownerId: 'owner-1',
    title: 'その他',
    blocking: true,
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-08-10', endsOn: '2026-08-10' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function occurrenceCandidate(
  overrides: Partial<HomeUpcomingOccurrenceCandidate> = {},
): HomeUpcomingOccurrenceCandidate {
  return {
    event: event(),
    occurrence: occurrence(),
    participation: participation(),
    ...overrides,
  };
}

function scheduleCandidate(
  overrides: Partial<HomeUpcomingScheduleCandidate> = {},
): HomeUpcomingScheduleCandidate {
  return { entry: scheduleEntry(), isOwner: true, ...overrides };
}

const NOW = '2026-08-10T00:00:00.000Z';
const TODAY = '2026-08-10';

function itemIds(items: readonly HomeUpcomingItem[]): string[] {
  return items.map((item) => (item.kind === 'occurrence' ? item.occurrence.id : item.entry.id));
}

// --- occurrence candidacy ---

void test('a future occurrence participates regardless of attending/considering', () => {
  const items = selectHomeUpcomingItems(
    [
      occurrenceCandidate({
        occurrence: occurrence({ id: 'attending-occ', startsAt: '2026-08-11T00:00:00Z' }),
        participation: participation({ status: 'attending' }),
      }),
      occurrenceCandidate({
        occurrence: occurrence({ id: 'considering-occ', startsAt: '2026-08-12T00:00:00Z' }),
        participation: participation({ status: 'considering' }),
      }),
    ],
    [],
    NOW,
    TODAY,
  );
  assert.deepEqual(itemIds(items), ['attending-occ', 'considering-occ']);
});

void test('an occurrence that already started is excluded (strictly startsAt >= now)', () => {
  const items = selectHomeUpcomingItems(
    [
      occurrenceCandidate({
        occurrence: occurrence({ id: 'already-started', startsAt: '2026-08-09T23:59:59.000Z' }),
      }),
      occurrenceCandidate({
        occurrence: occurrence({ id: 'right-now', startsAt: NOW }),
      }),
    ],
    [],
    NOW,
    TODAY,
  );
  assert.deepEqual(itemIds(items), ['right-now']);
});

// --- schedule candidacy ---

void test('an all-day entry spanning today is a candidate even though it started before today', () => {
  const items = selectHomeUpcomingItems(
    [],
    [
      scheduleCandidate({
        entry: scheduleEntry({
          id: 'active-multi-day',
          temporal: { kind: 'all-day', startsOn: '2026-08-05', endsOn: '2026-08-12' },
        }),
      }),
    ],
    NOW,
    TODAY,
  );
  assert.deepEqual(itemIds(items), ['active-multi-day']);
});

void test('an all-day entry that fully ended before today is excluded', () => {
  const items = selectHomeUpcomingItems(
    [],
    [
      scheduleCandidate({
        entry: scheduleEntry({
          id: 'past',
          temporal: { kind: 'all-day', startsOn: '2026-08-01', endsOn: '2026-08-09' },
        }),
      }),
    ],
    NOW,
    TODAY,
  );
  assert.deepEqual(itemIds(items), []);
});

void test('a time-bounded entry with a known end is a candidate while the end is still future', () => {
  const items = selectHomeUpcomingItems(
    [],
    [
      scheduleCandidate({
        entry: scheduleEntry({
          id: 'ongoing-timed',
          temporal: {
            kind: 'time-bounded',
            startsAt: '2026-08-09T20:00:00Z',
            endsAt: '2026-08-10T02:00:00Z',
          },
        }),
      }),
      scheduleCandidate({
        entry: scheduleEntry({
          id: 'already-ended',
          temporal: {
            kind: 'time-bounded',
            startsAt: '2026-08-09T10:00:00Z',
            endsAt: '2026-08-09T12:00:00Z',
          },
        }),
      }),
    ],
    NOW,
    TODAY,
  );
  assert.deepEqual(itemIds(items), ['ongoing-timed']);
});

void test('an open-ended time-bounded entry is a candidate only while its own start date has not passed - never assumed to continue forever', () => {
  const items = selectHomeUpcomingItems(
    [],
    [
      scheduleCandidate({
        entry: scheduleEntry({
          id: 'future-open-ended',
          temporal: { kind: 'time-bounded', startsAt: '2026-08-11T09:00:00Z', endsAt: null },
        }),
      }),
      scheduleCandidate({
        entry: scheduleEntry({
          id: 'past-open-ended',
          temporal: { kind: 'time-bounded', startsAt: '2026-08-01T09:00:00Z', endsAt: null },
        }),
      }),
    ],
    NOW,
    TODAY,
  );
  assert.deepEqual(itemIds(items), ['future-open-ended']);
});

// --- ordering + cap ---

void test('occurrence and schedule candidates merge into one nearest-first order', () => {
  const items = selectHomeUpcomingItems(
    [
      occurrenceCandidate({
        occurrence: occurrence({ id: 'occ-far', startsAt: '2026-08-20T00:00:00Z' }),
      }),
      occurrenceCandidate({
        occurrence: occurrence({ id: 'occ-near', startsAt: '2026-08-11T00:00:00Z' }),
      }),
    ],
    [
      scheduleCandidate({
        entry: scheduleEntry({
          id: 'sched-active',
          temporal: { kind: 'all-day', startsOn: '2026-08-08', endsOn: '2026-08-15' },
        }),
      }),
    ],
    NOW,
    TODAY,
  );
  // sched-active's own start (08-08, before "now") naturally sorts first -
  // no special-cased "ongoing items first" branch needed.
  assert.deepEqual(itemIds(items), ['sched-active', 'occ-near', 'occ-far']);
});

void test('the result is capped at HOME_UPCOMING_LIMIT, keeping the nearest ones', () => {
  const many = Array.from({ length: HOME_UPCOMING_LIMIT + 5 }, (_, i) =>
    occurrenceCandidate({
      occurrence: occurrence({
        id: `occ-${String(i)}`,
        startsAt: `2026-08-${String(11 + i).padStart(2, '0')}T00:00:00Z`,
      }),
    }),
  );
  const items = selectHomeUpcomingItems(many, [], NOW, TODAY);
  assert.equal(items.length, HOME_UPCOMING_LIMIT);
  assert.deepEqual(
    itemIds(items),
    Array.from({ length: HOME_UPCOMING_LIMIT }, (_, i) => `occ-${String(i)}`),
  );
});

void test('empty candidates yield an empty list', () => {
  assert.deepEqual(selectHomeUpcomingItems([], [], NOW, TODAY), []);
});

// --- grouping ---

void test('groupHomeUpcomingItemsByDate groups contiguous same-date items, preserving order', () => {
  const items = selectHomeUpcomingItems(
    [
      occurrenceCandidate({
        occurrence: occurrence({ id: 'occ-a', startsAt: '2026-08-11T01:00:00Z' }),
      }),
      occurrenceCandidate({
        occurrence: occurrence({ id: 'occ-b', startsAt: '2026-08-11T05:00:00Z' }),
      }),
      occurrenceCandidate({
        occurrence: occurrence({ id: 'occ-c', startsAt: '2026-08-12T01:00:00Z' }),
      }),
    ],
    [],
    NOW,
    TODAY,
  );
  const groups = groupHomeUpcomingItemsByDate(items);
  assert.deepEqual(
    groups.map((g) => g.date),
    ['2026-08-11', '2026-08-12'],
  );
  assert.deepEqual(itemIds(groups[0]?.items ?? []), ['occ-a', 'occ-b']);
  assert.deepEqual(itemIds(groups[1]?.items ?? []), ['occ-c']);
});

void test('groupHomeUpcomingItemsByDate groups an all-day entry under its own startsOn date', () => {
  const groups = groupHomeUpcomingItemsByDate(
    selectHomeUpcomingItems(
      [],
      [
        scheduleCandidate({
          entry: scheduleEntry({
            id: 'multi-day',
            temporal: { kind: 'all-day', startsOn: '2026-08-08', endsOn: '2026-08-15' },
          }),
        }),
      ],
      NOW,
      TODAY,
    ),
  );
  assert.deepEqual(
    groups.map((g) => g.date),
    ['2026-08-08'],
  );
});
