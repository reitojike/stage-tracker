import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aggregateTicketDisplayStatus,
  buildMyCalendarDayMarkers,
  buildMyCalendarOccurrenceEntries,
  scheduleEntryDatesInRange,
  isOccurrenceStartUtcDateInGridSuperset,
  selectMyCalendarOccurrenceEntries,
  selectMyCalendarScheduleEntries,
} from '../myCalendar.ts';
import type { EventCatalogEvent, EventOccurrence, EventWithOccurrences } from '../eventCatalog.ts';
import type { Participation } from '../participation.ts';
import type { PersonalScheduleEntry } from '../personalSchedule.ts';
import type { TicketAcquisition } from '../ticketAcquisition.ts';

function event(overrides: Partial<EventCatalogEvent> = {}): EventCatalogEvent {
  return {
    id: 'event-1',
    ownerId: 'owner-1',
    title: 'Test Event',
    venue: null,
    sourceUrl: null,
    memo: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function occurrence(overrides: Partial<EventOccurrence> = {}): EventOccurrence {
  return {
    id: 'occ-1',
    eventId: 'event-1',
    startsAt: '2026-08-10T10:00:00Z',
    endsAt: null,
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

function acquisition(overrides: Partial<TicketAcquisition> = {}): TicketAcquisition {
  return {
    id: 'a-1',
    ownerId: 'user-1',
    occurrenceId: 'occ-1',
    status: 'pending',
    memo: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function scheduleEntry(overrides: Partial<PersonalScheduleEntry> = {}): PersonalScheduleEntry {
  return {
    id: 'sched-1',
    ownerId: 'owner-1',
    scheduleType: 'other',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-08-10', endsOn: '2026-08-10' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// --- aggregateTicketDisplayStatus ---

void test('aggregateTicketDisplayStatus: no acquisitions is none', () => {
  assert.equal(aggregateTicketDisplayStatus([]), 'none');
});

void test('aggregateTicketDisplayStatus: any secured wins over pending/unsuccessful', () => {
  const acquisitions = [
    acquisition({ id: 'a1', status: 'unsuccessful' }),
    acquisition({ id: 'a2', status: 'pending' }),
    acquisition({ id: 'a3', status: 'secured' }),
  ];
  assert.equal(aggregateTicketDisplayStatus(acquisitions), 'secured');
});

void test('aggregateTicketDisplayStatus: pending wins over unsuccessful when no secured exists', () => {
  const acquisitions = [
    acquisition({ id: 'a1', status: 'unsuccessful' }),
    acquisition({ id: 'a2', status: 'pending' }),
  ];
  assert.equal(aggregateTicketDisplayStatus(acquisitions), 'pending');
});

void test('aggregateTicketDisplayStatus: all-unsuccessful is unsuccessful', () => {
  assert.equal(
    aggregateTicketDisplayStatus([acquisition({ status: 'unsuccessful' })]),
    'unsuccessful',
  );
});

// --- buildMyCalendarOccurrenceEntries / selectMyCalendarOccurrenceEntries ---

void test('buildMyCalendarOccurrenceEntries only includes participation-registered occurrences', () => {
  const ev: EventWithOccurrences = {
    event: event(),
    occurrences: [
      occurrence({ id: 'occ-registered' }),
      occurrence({ id: 'occ-not-registered', startsAt: '2026-08-11T10:00:00Z' }),
    ],
  };
  const participations = new Map([
    ['occ-registered', participation({ occurrenceId: 'occ-registered' })],
  ]);
  const acquisitions = new Map<string, TicketAcquisition[]>();

  const entries = buildMyCalendarOccurrenceEntries([ev], participations, acquisitions);

  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.ok(entry);
  assert.equal(entry.occurrence.id, 'occ-registered');
  assert.equal(entry.ticketStatus, 'none');
});

void test('selectMyCalendarOccurrenceEntries filters to the Asia/Tokyo calendar date', () => {
  const ev: EventWithOccurrences = {
    event: event(),
    occurrences: [
      // 2026-08-10T10:00:00Z is 2026-08-10 19:00 JST -> Tokyo date 2026-08-10.
      occurrence({ id: 'occ-a', startsAt: '2026-08-10T10:00:00Z' }),
      // 2026-08-10T16:00:00Z is 2026-08-11 01:00 JST -> Tokyo date 2026-08-11.
      occurrence({ id: 'occ-b', startsAt: '2026-08-10T16:00:00Z' }),
    ],
  };
  const participations = new Map([
    ['occ-a', participation({ occurrenceId: 'occ-a' })],
    ['occ-b', participation({ occurrenceId: 'occ-b' })],
  ]);
  const entries = buildMyCalendarOccurrenceEntries([ev], participations, new Map());

  assert.deepEqual(
    selectMyCalendarOccurrenceEntries(entries, '2026-08-10').map((e) => e.occurrence.id),
    ['occ-a'],
  );
  assert.deepEqual(
    selectMyCalendarOccurrenceEntries(entries, '2026-08-11').map((e) => e.occurrence.id),
    ['occ-b'],
  );
});

// --- scheduleEntryDatesInRange ---

void test('scheduleEntryDatesInRange: all-day multi-day entry enumerates every date', () => {
  const entry = scheduleEntry({
    temporal: { kind: 'all-day', startsOn: '2026-08-09', endsOn: '2026-08-11' },
  });
  assert.deepEqual(scheduleEntryDatesInRange(entry, '2026-08-01', '2026-08-31'), [
    '2026-08-09',
    '2026-08-10',
    '2026-08-11',
  ]);
});

void test('scheduleEntryDatesInRange: clips to the given range', () => {
  const entry = scheduleEntry({
    temporal: { kind: 'all-day', startsOn: '2026-07-30', endsOn: '2026-08-02' },
  });
  assert.deepEqual(scheduleEntryDatesInRange(entry, '2026-08-01', '2026-08-31'), [
    '2026-08-01',
    '2026-08-02',
  ]);
});

void test('scheduleEntryDatesInRange: time-bounded entry with a known end spans both dates', () => {
  const entry = scheduleEntry({
    temporal: {
      kind: 'time-bounded',
      startsAt: '2026-08-10T23:00:00Z',
      endsAt: '2026-08-11T02:00:00Z',
    },
  });
  // 2026-08-10T23:00Z = 2026-08-11 08:00 JST; 2026-08-11T02:00Z = 2026-08-11
  // 11:00 JST - both fall on the same Tokyo date here.
  assert.deepEqual(scheduleEntryDatesInRange(entry, '2026-08-01', '2026-08-31'), ['2026-08-11']);
});

void test('scheduleEntryDatesInRange: an unresolved end is never extended past its start date', () => {
  const entry = scheduleEntry({
    temporal: { kind: 'time-bounded', startsAt: '2026-08-10T10:00:00Z', endsAt: null },
  });
  assert.deepEqual(scheduleEntryDatesInRange(entry, '2026-08-01', '2026-08-31'), ['2026-08-10']);
});

void test('scheduleEntryDatesInRange: entirely outside the range yields no dates', () => {
  const entry = scheduleEntry({
    temporal: { kind: 'all-day', startsOn: '2026-06-01', endsOn: '2026-06-02' },
  });
  assert.deepEqual(scheduleEntryDatesInRange(entry, '2026-08-01', '2026-08-31'), []);
});

// --- isOccurrenceStartUtcDateInGridSuperset ---

void test('isOccurrenceStartUtcDateInGridSuperset includes an occurrence whose UTC date equals gridFirstDate', () => {
  assert.equal(
    isOccurrenceStartUtcDateInGridSuperset('2026-08-01T10:00:00Z', '2026-08-01', '2026-08-31'),
    true,
  );
});

void test('isOccurrenceStartUtcDateInGridSuperset includes an early-morning-JST occurrence whose UTC date is one day before gridFirstDate (regression: was silently excluded)', () => {
  // startsAt = "2026-07-31T16:30:00Z" is 2026-08-01 01:30 JST - true Tokyo
  // date is gridFirstDate itself, but the raw UTC-sliced date is
  // "2026-07-31", one day earlier. A prior revision of this filter
  // compared the UTC-sliced date directly against gridFirstDate with no
  // widening, which silently dropped this occurrence from My Calendar.
  assert.equal(
    isOccurrenceStartUtcDateInGridSuperset('2026-07-31T16:30:00Z', '2026-08-01', '2026-08-31'),
    true,
  );
});

void test('isOccurrenceStartUtcDateInGridSuperset excludes a UTC date two days before gridFirstDate', () => {
  assert.equal(
    isOccurrenceStartUtcDateInGridSuperset('2026-07-30T10:00:00Z', '2026-08-01', '2026-08-31'),
    false,
  );
});

void test('isOccurrenceStartUtcDateInGridSuperset excludes a UTC date after gridLastDate', () => {
  assert.equal(
    isOccurrenceStartUtcDateInGridSuperset('2026-09-01T10:00:00Z', '2026-08-01', '2026-08-31'),
    false,
  );
});

// --- selectMyCalendarScheduleEntries / buildMyCalendarDayMarkers ---

void test('selectMyCalendarScheduleEntries labels owner vs. shared correctly', () => {
  const own = scheduleEntry({ id: 'own', ownerId: 'caller' });
  const shared = scheduleEntry({ id: 'shared', ownerId: 'someone-else' });
  const result = selectMyCalendarScheduleEntries(
    [own, shared],
    'caller',
    '2026-08-10',
    '2026-08-01',
    '2026-08-31',
  );
  assert.deepEqual(
    result.map((r) => [r.entry.id, r.isOwner]),
    [
      ['own', true],
      ['shared', false],
    ],
  );
});

void test('buildMyCalendarDayMarkers reports weekday role, occurrence/ticket state, and schedule counts', () => {
  const ev: EventWithOccurrences = {
    event: event(),
    occurrences: [occurrence({ id: 'occ-1', startsAt: '2026-08-10T10:00:00Z' })],
  };
  const occurrenceEntries = buildMyCalendarOccurrenceEntries(
    [ev],
    new Map([['occ-1', participation({ occurrenceId: 'occ-1' })]]),
    new Map(),
  );
  const scheduleEntries = [
    scheduleEntry({ id: 'own', ownerId: 'caller' }),
    scheduleEntry({ id: 'shared', ownerId: 'someone-else' }),
  ];

  const markers = buildMyCalendarDayMarkers(
    ['2026-08-09', '2026-08-10', '2026-08-11'],
    occurrenceEntries,
    scheduleEntries,
    'caller',
  );

  const day10 = markers.find((m) => m.date === '2026-08-10');
  assert.ok(day10);
  assert.equal(day10.occurrenceCount, 1);
  assert.equal(day10.hasUnconfirmedTicket, true); // ticketStatus defaulted to 'none'
  assert.equal(day10.ownScheduleCount, 1);
  assert.equal(day10.sharedScheduleCount, 1);
  assert.equal(day10.role, 'weekday'); // 2026-08-10 is a Monday, not a holiday

  const day9 = markers.find((m) => m.date === '2026-08-09');
  assert.ok(day9);
  assert.equal(day9.occurrenceCount, 0);
  assert.equal(day9.hasUnconfirmedTicket, false);
});
