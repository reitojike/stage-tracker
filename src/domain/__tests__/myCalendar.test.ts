import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aggregateTicketDisplayStatus,
  buildMyCalendarDayMarkers,
  buildMyCalendarOccurrenceEntries,
  buildMyCalendarScheduleBandSegments,
  buildMyCalendarWeekBandLayouts,
  isSingleDayScheduleEntry,
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
    title: 'その他',
    blocking: true,
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
  assert.equal(day10.attendingCount, 1);
  assert.equal(day10.consideringCount, 0);
  assert.equal(day10.ownScheduleCount, 1);
  assert.equal(day10.sharedScheduleCount, 1);
  assert.equal(day10.role, 'weekday'); // 2026-08-10 is a Monday, not a holiday

  const day9 = markers.find((m) => m.date === '2026-08-09');
  assert.ok(day9);
  assert.equal(day9.attendingCount, 0);
  assert.equal(day9.consideringCount, 0);

  // 2026-08-09..11 are all within the Japanese-holiday snapshot's
  // confirmed coverage.
  assert.equal(day10.holidayDataConfirmed, true);
  assert.equal(day9.holidayDataConfirmed, true);
});

// --- attending/considering distinction (Issue #92) ---

void test('buildMyCalendarDayMarkers reports an attending-only day with zero considering, and a considering-only day with zero attending', () => {
  const attendingOnlyEv: EventWithOccurrences = {
    event: event({ id: 'event-attending' }),
    occurrences: [
      occurrence({
        id: 'occ-attending-only',
        eventId: 'event-attending',
        startsAt: '2026-08-11T10:00:00Z',
      }),
    ],
  };
  const attendingOnlyEntries = buildMyCalendarOccurrenceEntries(
    [attendingOnlyEv],
    new Map([
      [
        'occ-attending-only',
        participation({ occurrenceId: 'occ-attending-only', status: 'attending' }),
      ],
    ]),
    new Map(),
  );
  const attendingMarkers = buildMyCalendarDayMarkers(
    ['2026-08-11'],
    attendingOnlyEntries,
    [],
    'caller',
  );
  const attendingDay = attendingMarkers.find((m) => m.date === '2026-08-11');
  assert.ok(attendingDay);
  assert.equal(attendingDay.attendingCount, 1);
  assert.equal(attendingDay.consideringCount, 0);

  const consideringOnlyEv: EventWithOccurrences = {
    event: event({ id: 'event-considering' }),
    occurrences: [
      occurrence({
        id: 'occ-considering-only',
        eventId: 'event-considering',
        startsAt: '2026-08-12T10:00:00Z',
      }),
    ],
  };
  const consideringOnlyEntries = buildMyCalendarOccurrenceEntries(
    [consideringOnlyEv],
    new Map([
      [
        'occ-considering-only',
        participation({ occurrenceId: 'occ-considering-only', status: 'considering' }),
      ],
    ]),
    new Map(),
  );
  const consideringMarkers = buildMyCalendarDayMarkers(
    ['2026-08-12'],
    consideringOnlyEntries,
    [],
    'caller',
  );
  const consideringDay = consideringMarkers.find((m) => m.date === '2026-08-12');
  assert.ok(consideringDay);
  assert.equal(consideringDay.attendingCount, 0);
  assert.equal(consideringDay.consideringCount, 1);
});

void test('buildMyCalendarDayMarkers keeps attending and considering as distinct, non-collapsing counts on a day that mixes both (Issue #92)', () => {
  const ev: EventWithOccurrences = {
    event: event(),
    occurrences: [
      occurrence({ id: 'occ-attending', startsAt: '2026-08-10T10:00:00Z' }),
      occurrence({ id: 'occ-considering', startsAt: '2026-08-10T11:00:00Z' }),
    ],
  };
  const occurrenceEntries = buildMyCalendarOccurrenceEntries(
    [ev],
    new Map([
      [
        'occ-attending',
        participation({ id: 'p-a', occurrenceId: 'occ-attending', status: 'attending' }),
      ],
      [
        'occ-considering',
        participation({ id: 'p-c', occurrenceId: 'occ-considering', status: 'considering' }),
      ],
    ]),
    new Map(),
  );

  const markers = buildMyCalendarDayMarkers(['2026-08-10'], occurrenceEntries, [], 'caller');
  const day10 = markers.find((m) => m.date === '2026-08-10');
  assert.ok(day10);
  assert.equal(day10.attendingCount, 1);
  assert.equal(day10.consideringCount, 1);
});

void test('buildMyCalendarDayMarkers reports holidayDataConfirmed=false for a date outside the snapshot coverage, without fabricating a holiday role for it (PO adjudication, Issue #34)', () => {
  const markers = buildMyCalendarDayMarkers(['2027-11-23', '2027-11-24'], [], [], 'caller');

  const inCoverage = markers.find((m) => m.date === '2027-11-23');
  assert.ok(inCoverage);
  assert.equal(inCoverage.holidayDataConfirmed, true);

  const outOfCoverage = markers.find((m) => m.date === '2027-11-24');
  assert.ok(outOfCoverage);
  assert.equal(outOfCoverage.holidayDataConfirmed, false);
  assert.notEqual(outOfCoverage.role, 'holiday');
});

// --- dot state (Issue #142: "dot は1セル1個。決まっているイベント or
// blockingの予定があれば塗り、検討中 or non-blockingのみなら輪郭") ---

function singleDayOccurrenceEntries(
  status: 'attending' | 'considering',
  date: string,
  eventId = 'single',
): ReturnType<typeof buildMyCalendarOccurrenceEntries> {
  const ev: EventWithOccurrences = {
    event: event({ id: eventId, startsOn: date, endsOn: date }),
    occurrences: [
      occurrence({ id: `occ-${eventId}`, eventId: eventId, startsAt: `${date}T10:00:00Z` }),
    ],
  };
  return buildMyCalendarOccurrenceEntries(
    [ev],
    new Map([[`occ-${eventId}`, participation({ occurrenceId: `occ-${eventId}`, status })]]),
    new Map(),
  );
}

void test('dot: a single-day attending Event fills the dot', () => {
  const entries = singleDayOccurrenceEntries('attending', '2026-08-10');
  const markers = buildMyCalendarDayMarkers(['2026-08-10'], entries, [], 'caller');
  assert.equal(markers.find((m) => m.date === '2026-08-10')?.dot, 'filled');
});

void test('dot: a single-day considering-only Event outlines the dot', () => {
  const entries = singleDayOccurrenceEntries('considering', '2026-08-10');
  const markers = buildMyCalendarDayMarkers(['2026-08-10'], entries, [], 'caller');
  assert.equal(markers.find((m) => m.date === '2026-08-10')?.dot, 'outline');
});

void test('dot: a single-day blocking schedule entry fills the dot', () => {
  const entries = [scheduleEntry({ id: 'block', blocking: true })];
  const markers = buildMyCalendarDayMarkers(['2026-08-10'], [], entries, 'caller');
  assert.equal(markers.find((m) => m.date === '2026-08-10')?.dot, 'filled');
});

void test('dot: a single-day non-blocking schedule entry outlines the dot', () => {
  const entries = [scheduleEntry({ id: 'non-block', blocking: false })];
  const markers = buildMyCalendarDayMarkers(['2026-08-10'], [], entries, 'caller');
  assert.equal(markers.find((m) => m.date === '2026-08-10')?.dot, 'outline');
});

void test('dot: filled wins over outline when both a filled and an outline source share a day', () => {
  const occurrenceEntries = singleDayOccurrenceEntries('considering', '2026-08-10');
  const scheduleEntries = [scheduleEntry({ id: 'block', blocking: true })];
  const markers = buildMyCalendarDayMarkers(
    ['2026-08-10'],
    occurrenceEntries,
    scheduleEntries,
    'caller',
  );
  assert.equal(markers.find((m) => m.date === '2026-08-10')?.dot, 'filled');
});

void test('dot: no single-day source on a day is "none"', () => {
  const markers = buildMyCalendarDayMarkers(['2026-08-10'], [], [], 'caller');
  assert.equal(markers.find((m) => m.date === '2026-08-10')?.dot, 'none');
});

// --- Issue #174: a multi-day Event's participation marker is an exact-date
// dot on the registered occurrence's own date, never a band over the
// Event's whole starts_on..endsOn range (superseding #142's Event-band
// rule). ---

void test("dot: a multi-day Event with an attending occurrence fills the dot on the occurrence's own exact date", () => {
  const ev: EventWithOccurrences = {
    event: event({ id: 'multi', startsOn: '2026-08-08', endsOn: '2026-08-12' }),
    occurrences: [
      occurrence({ id: 'occ-multi', eventId: 'multi', startsAt: '2026-08-10T10:00:00Z' }),
    ],
  };
  const entries = buildMyCalendarOccurrenceEntries(
    [ev],
    new Map([['occ-multi', participation({ occurrenceId: 'occ-multi', status: 'attending' })]]),
    new Map(),
  );
  const markers = buildMyCalendarDayMarkers(
    ['2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12'],
    entries,
    [],
    'caller',
  );
  assert.equal(markers.find((m) => m.date === '2026-08-10')?.dot, 'filled');
});

void test("dot: a multi-day Event's participation marker never appears on any other date within the Event range, even days with no occurrence", () => {
  const ev: EventWithOccurrences = {
    event: event({ id: 'multi', startsOn: '2026-08-08', endsOn: '2026-08-12' }),
    occurrences: [
      occurrence({ id: 'occ-multi', eventId: 'multi', startsAt: '2026-08-10T10:00:00Z' }),
    ],
  };
  const entries = buildMyCalendarOccurrenceEntries(
    [ev],
    new Map([['occ-multi', participation({ occurrenceId: 'occ-multi', status: 'attending' })]]),
    new Map(),
  );
  const markers = buildMyCalendarDayMarkers(
    ['2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12'],
    entries,
    [],
    'caller',
  );
  for (const date of ['2026-08-08', '2026-08-09', '2026-08-11', '2026-08-12']) {
    assert.equal(markers.find((m) => m.date === date)?.dot, 'none', `expected no dot on ${date}`);
  }
});

void test("dot: a multi-day Event with only a considering occurrence outlines the dot on the occurrence's own exact date", () => {
  const ev: EventWithOccurrences = {
    event: event({ id: 'multi', startsOn: '2026-08-08', endsOn: '2026-08-12' }),
    occurrences: [
      occurrence({ id: 'occ-multi', eventId: 'multi', startsAt: '2026-08-10T10:00:00Z' }),
    ],
  };
  const entries = buildMyCalendarOccurrenceEntries(
    [ev],
    new Map([['occ-multi', participation({ occurrenceId: 'occ-multi', status: 'considering' })]]),
    new Map(),
  );
  const markers = buildMyCalendarDayMarkers(['2026-08-10'], entries, [], 'caller');
  assert.equal(markers.find((m) => m.date === '2026-08-10')?.dot, 'outline');
});

void test('dot: on the same day, attending wins over considering across multiple occurrences of a multi-day Event', () => {
  const ev: EventWithOccurrences = {
    event: event({ id: 'multi', startsOn: '2026-08-08', endsOn: '2026-08-12' }),
    occurrences: [
      occurrence({ id: 'occ-a', eventId: 'multi', startsAt: '2026-08-10T01:00:00Z' }),
      occurrence({ id: 'occ-b', eventId: 'multi', startsAt: '2026-08-10T09:00:00Z' }),
    ],
  };
  const entries = buildMyCalendarOccurrenceEntries(
    [ev],
    new Map([
      ['occ-a', participation({ id: 'p-a', occurrenceId: 'occ-a', status: 'considering' })],
      ['occ-b', participation({ id: 'p-b', occurrenceId: 'occ-b', status: 'attending' })],
    ]),
    new Map(),
  );
  const markers = buildMyCalendarDayMarkers(['2026-08-10'], entries, [], 'caller');
  assert.equal(markers.find((m) => m.date === '2026-08-10')?.dot, 'filled');
});

void test('dot: same-day multiple occurrences (single Event) still render exactly one dot for the day', () => {
  const ev: EventWithOccurrences = {
    event: event({ id: 'multi', startsOn: '2026-08-08', endsOn: '2026-08-12' }),
    occurrences: [
      occurrence({ id: 'occ-a', eventId: 'multi', startsAt: '2026-08-10T01:00:00Z' }),
      occurrence({ id: 'occ-b', eventId: 'multi', startsAt: '2026-08-10T09:00:00Z' }),
    ],
  };
  const entries = buildMyCalendarOccurrenceEntries(
    [ev],
    new Map([
      ['occ-a', participation({ id: 'p-a', occurrenceId: 'occ-a', status: 'considering' })],
      ['occ-b', participation({ id: 'p-b', occurrenceId: 'occ-b', status: 'considering' })],
    ]),
    new Map(),
  );
  const markers = buildMyCalendarDayMarkers(['2026-08-10'], entries, [], 'caller');
  // MyCalendarDotState is a single union value per day - by construction
  // there is only ever one dot regardless of how many occurrences fall on
  // it.
  assert.equal(markers.find((m) => m.date === '2026-08-10')?.dot, 'outline');
});

void test('dot: a multi-day schedule entry never fills/outlines the dot - it is represented by a band instead', () => {
  const entries = [
    scheduleEntry({
      id: 'multi-sched',
      blocking: true,
      temporal: { kind: 'all-day', startsOn: '2026-08-08', endsOn: '2026-08-12' },
    }),
  ];
  const markers = buildMyCalendarDayMarkers(['2026-08-10'], [], entries, 'caller');
  assert.equal(markers.find((m) => m.date === '2026-08-10')?.dot, 'none');
});

// --- isSingleDayScheduleEntry ---

void test('isSingleDayScheduleEntry: true for an all-day entry whose startsOn === endsOn', () => {
  assert.equal(
    isSingleDayScheduleEntry(
      scheduleEntry({
        temporal: { kind: 'all-day', startsOn: '2026-08-10', endsOn: '2026-08-10' },
      }),
    ),
    true,
  );
});

void test('isSingleDayScheduleEntry: false for an all-day entry spanning multiple dates', () => {
  assert.equal(
    isSingleDayScheduleEntry(
      scheduleEntry({
        temporal: { kind: 'all-day', startsOn: '2026-08-10', endsOn: '2026-08-11' },
      }),
    ),
    false,
  );
});

void test('isSingleDayScheduleEntry: true for a time-bounded entry with no endsAt', () => {
  assert.equal(
    isSingleDayScheduleEntry(
      scheduleEntry({
        temporal: { kind: 'time-bounded', startsAt: '2026-08-10T10:00:00Z', endsAt: null },
      }),
    ),
    true,
  );
});

void test('isSingleDayScheduleEntry: false for a time-bounded entry whose end falls on a later Tokyo date', () => {
  assert.equal(
    isSingleDayScheduleEntry(
      scheduleEntry({
        temporal: {
          kind: 'time-bounded',
          startsAt: '2026-08-10T10:00:00Z',
          endsAt: '2026-08-11T10:00:00Z',
        },
      }),
    ),
    false,
  );
});

// --- buildMyCalendarScheduleBandSegments ---

void test('buildMyCalendarScheduleBandSegments: a multi-day blocking entry bands filled', () => {
  const entries = [
    scheduleEntry({
      id: 'trip',
      title: '旅行',
      blocking: true,
      temporal: { kind: 'all-day', startsOn: '2026-08-08', endsOn: '2026-08-10' },
    }),
  ];
  assert.deepEqual(buildMyCalendarScheduleBandSegments(entries), [
    {
      eventId: 'trip',
      eventTitle: '旅行',
      startDate: '2026-08-08',
      endDate: '2026-08-10',
      isCanceled: false,
      kind: 'schedule',
      blocking: true,
    },
  ]);
});

void test('buildMyCalendarScheduleBandSegments: a multi-day non-blocking entry bands outline', () => {
  const entries = [
    scheduleEntry({
      id: 'tentative',
      blocking: false,
      temporal: { kind: 'all-day', startsOn: '2026-08-08', endsOn: '2026-08-10' },
    }),
  ];
  const segments = buildMyCalendarScheduleBandSegments(entries);
  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.blocking, false);
});

void test('buildMyCalendarScheduleBandSegments: a single-day entry never bands', () => {
  const entries = [scheduleEntry({ id: 'single-day' })];
  assert.deepEqual(buildMyCalendarScheduleBandSegments(entries), []);
});

// --- buildMyCalendarWeekBandLayouts ---

void test('buildMyCalendarWeekBandLayouts: lays out schedule bands (the only band source since Issue #174)', () => {
  const week = [
    '2026-08-09',
    '2026-08-10',
    '2026-08-11',
    '2026-08-12',
    '2026-08-13',
    '2026-08-14',
    '2026-08-15',
  ];
  const scheduleEntries = [
    scheduleEntry({
      id: 'trip',
      title: '旅行',
      blocking: true,
      temporal: { kind: 'all-day', startsOn: '2026-08-12', endsOn: '2026-08-13' },
    }),
  ];

  const [layout] = buildMyCalendarWeekBandLayouts([week], scheduleEntries);
  assert.ok(layout);
  assert.equal(layout.segments.length, 1);
  assert.equal(layout.segments[0]?.kind, 'schedule');
});

void test("buildMyCalendarWeekBandLayouts: a participation-registered occurrence of a multi-day Event never contributes a band, only the caller's schedule entries do (Issue #174)", () => {
  const week = [
    '2026-08-09',
    '2026-08-10',
    '2026-08-11',
    '2026-08-12',
    '2026-08-13',
    '2026-08-14',
    '2026-08-15',
  ];
  // A participating multi-day Event exists in the fetched data (as it would
  // via page.tsx's occurrenceEntries), but buildMyCalendarWeekBandLayouts no
  // longer takes it as input at all - it can only see schedule entries.
  const scheduleEntries = [
    scheduleEntry({
      id: 'trip',
      blocking: true,
      temporal: { kind: 'all-day', startsOn: '2026-08-12', endsOn: '2026-08-13' },
    }),
  ];
  const [layout] = buildMyCalendarWeekBandLayouts([week], scheduleEntries);
  assert.ok(layout);
  assert.equal(layout.segments.length, 1);
  assert.equal(layout.segments[0]?.kind, 'schedule');
});

void test('buildMyCalendarWeekBandLayouts: caps at MAX_BAND_LANES (2) with the third overflowing, matching the Event Catalog', () => {
  const week = [
    '2026-08-09',
    '2026-08-10',
    '2026-08-11',
    '2026-08-12',
    '2026-08-13',
    '2026-08-14',
    '2026-08-15',
  ];
  const scheduleEntries = ['a', 'b', 'c'].map((id) =>
    scheduleEntry({
      id,
      title: id,
      temporal: { kind: 'all-day', startsOn: '2026-08-09', endsOn: '2026-08-10' },
    }),
  );
  const [layout] = buildMyCalendarWeekBandLayouts([week], scheduleEntries);
  assert.ok(layout);
  assert.equal(layout.segments.length, 2);
  assert.equal(layout.overflowCount, 1);
});

// --- Issue #180: month-level participation dot/count is effective
// cancellation-aware (reusing src/domain/eventCancellation.ts's
// isEffectivelyCanceled - Event canceled OR Occurrence canceled). ---

const DATE = '2026-08-10';

function occurrenceEntriesFor(
  status: 'attending' | 'considering',
  overrides: { eventCanceledAt?: string | null; occurrenceCanceledAt?: string | null } = {},
): ReturnType<typeof buildMyCalendarOccurrenceEntries> {
  const ev: EventWithOccurrences = {
    event: event({ canceledAt: overrides.eventCanceledAt ?? null }),
    occurrences: [
      occurrence({
        startsAt: `${DATE}T10:00:00Z`,
        canceledAt: overrides.occurrenceCanceledAt ?? null,
      }),
    ],
  };
  return buildMyCalendarOccurrenceEntries(
    [ev],
    new Map([['occ-1', participation({ occurrenceId: 'occ-1', status })]]),
    new Map(),
  );
}

void test('dot: active attending only fills the dot', () => {
  const markers = buildMyCalendarDayMarkers(
    [DATE],
    occurrenceEntriesFor('attending'),
    [],
    'caller',
  );
  const day = markers.find((m) => m.date === DATE);
  assert.ok(day);
  assert.equal(day.dot, 'filled');
  assert.equal(day.attendingCount, 1);
});

void test('dot: active considering only outlines the dot', () => {
  const markers = buildMyCalendarDayMarkers(
    [DATE],
    occurrenceEntriesFor('considering'),
    [],
    'caller',
  );
  const day = markers.find((m) => m.date === DATE);
  assert.ok(day);
  assert.equal(day.dot, 'outline');
  assert.equal(day.consideringCount, 1);
});

void test('dot: an effectively Occurrence-canceled attending occurrence contributes no participation dot or count', () => {
  const entries = occurrenceEntriesFor('attending', {
    occurrenceCanceledAt: '2026-08-01T00:00:00Z',
  });
  const markers = buildMyCalendarDayMarkers([DATE], entries, [], 'caller');
  const day = markers.find((m) => m.date === DATE);
  assert.ok(day);
  assert.equal(day.dot, 'none');
  assert.equal(day.attendingCount, 0);
});

void test('dot: an effectively Occurrence-canceled considering occurrence contributes no participation dot or count', () => {
  const entries = occurrenceEntriesFor('considering', {
    occurrenceCanceledAt: '2026-08-01T00:00:00Z',
  });
  const markers = buildMyCalendarDayMarkers([DATE], entries, [], 'caller');
  const day = markers.find((m) => m.date === DATE);
  assert.ok(day);
  assert.equal(day.dot, 'none');
  assert.equal(day.consideringCount, 0);
});

void test('dot: an Event-level canceled attending occurrence contributes no participation dot or count', () => {
  const entries = occurrenceEntriesFor('attending', { eventCanceledAt: '2026-08-01T00:00:00Z' });
  const markers = buildMyCalendarDayMarkers([DATE], entries, [], 'caller');
  const day = markers.find((m) => m.date === DATE);
  assert.ok(day);
  assert.equal(day.dot, 'none');
  assert.equal(day.attendingCount, 0);
});

void test('dot: canceled attending + active considering on the same day is outline, not filled (canceled attending never wins)', () => {
  const ev: EventWithOccurrences = {
    event: event(),
    occurrences: [
      occurrence({
        id: 'occ-canceled-attending',
        startsAt: `${DATE}T09:00:00Z`,
        canceledAt: '2026-08-01T00:00:00Z',
      }),
      occurrence({ id: 'occ-active-considering', startsAt: `${DATE}T11:00:00Z` }),
    ],
  };
  const entries = buildMyCalendarOccurrenceEntries(
    [ev],
    new Map([
      [
        'occ-canceled-attending',
        participation({ id: 'p-a', occurrenceId: 'occ-canceled-attending', status: 'attending' }),
      ],
      [
        'occ-active-considering',
        participation({
          id: 'p-c',
          occurrenceId: 'occ-active-considering',
          status: 'considering',
        }),
      ],
    ]),
    new Map(),
  );
  const markers = buildMyCalendarDayMarkers([DATE], entries, [], 'caller');
  const day = markers.find((m) => m.date === DATE);
  assert.ok(day);
  assert.equal(day.dot, 'outline');
  assert.equal(day.attendingCount, 0);
  assert.equal(day.consideringCount, 1);
});

void test('dot: active attending + canceled considering on the same day is filled', () => {
  const ev: EventWithOccurrences = {
    event: event(),
    occurrences: [
      occurrence({ id: 'occ-active-attending', startsAt: `${DATE}T09:00:00Z` }),
      occurrence({
        id: 'occ-canceled-considering',
        startsAt: `${DATE}T11:00:00Z`,
        canceledAt: '2026-08-01T00:00:00Z',
      }),
    ],
  };
  const entries = buildMyCalendarOccurrenceEntries(
    [ev],
    new Map([
      [
        'occ-active-attending',
        participation({ id: 'p-a', occurrenceId: 'occ-active-attending', status: 'attending' }),
      ],
      [
        'occ-canceled-considering',
        participation({
          id: 'p-c',
          occurrenceId: 'occ-canceled-considering',
          status: 'considering',
        }),
      ],
    ]),
    new Map(),
  );
  const markers = buildMyCalendarDayMarkers([DATE], entries, [], 'caller');
  const day = markers.find((m) => m.date === DATE);
  assert.ok(day);
  assert.equal(day.dot, 'filled');
  assert.equal(day.attendingCount, 1);
  assert.equal(day.consideringCount, 0);
});

void test('dot: canceled-only participation plus a blocking schedule entry still fills (schedule marker semantics unchanged)', () => {
  const occurrenceEntries = occurrenceEntriesFor('attending', {
    occurrenceCanceledAt: '2026-08-01T00:00:00Z',
  });
  const scheduleEntries = [
    scheduleEntry({
      id: 'block',
      blocking: true,
      temporal: { kind: 'all-day', startsOn: DATE, endsOn: DATE },
    }),
  ];
  const markers = buildMyCalendarDayMarkers([DATE], occurrenceEntries, scheduleEntries, 'caller');
  const day = markers.find((m) => m.date === DATE);
  assert.ok(day);
  assert.equal(day.dot, 'filled');
  assert.equal(day.attendingCount, 0);
});

void test('dot: canceled-only participation plus a non-blocking schedule entry still outlines (schedule marker semantics unchanged)', () => {
  const occurrenceEntries = occurrenceEntriesFor('attending', {
    occurrenceCanceledAt: '2026-08-01T00:00:00Z',
  });
  const scheduleEntries = [
    scheduleEntry({
      id: 'non-block',
      blocking: false,
      temporal: { kind: 'all-day', startsOn: DATE, endsOn: DATE },
    }),
  ];
  const markers = buildMyCalendarDayMarkers([DATE], occurrenceEntries, scheduleEntries, 'caller');
  const day = markers.find((m) => m.date === DATE);
  assert.ok(day);
  assert.equal(day.dot, 'outline');
  assert.equal(day.consideringCount, 0);
});

void test('selectMyCalendarOccurrenceEntries: an effectively canceled occurrence remains in the selected-day detail set (only the month-level dot/count excludes it)', () => {
  const entries = occurrenceEntriesFor('attending', {
    occurrenceCanceledAt: '2026-08-01T00:00:00Z',
  });
  const selected = selectMyCalendarOccurrenceEntries(entries, DATE);
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.occurrence.canceledAt, '2026-08-01T00:00:00Z');
});

void test('dot: a day with both a canceled attending and a canceled considering occurrence (no active participation, no schedule) has no dot and zero counts', () => {
  const ev: EventWithOccurrences = {
    event: event(),
    occurrences: [
      occurrence({
        id: 'occ-canceled-attending-only',
        startsAt: `${DATE}T09:00:00Z`,
        canceledAt: '2026-08-01T00:00:00Z',
      }),
      occurrence({
        id: 'occ-canceled-considering-only',
        startsAt: `${DATE}T11:00:00Z`,
        canceledAt: '2026-08-01T00:00:00Z',
      }),
    ],
  };
  const entries = buildMyCalendarOccurrenceEntries(
    [ev],
    new Map([
      [
        'occ-canceled-attending-only',
        participation({
          id: 'p-a',
          occurrenceId: 'occ-canceled-attending-only',
          status: 'attending',
        }),
      ],
      [
        'occ-canceled-considering-only',
        participation({
          id: 'p-c',
          occurrenceId: 'occ-canceled-considering-only',
          status: 'considering',
        }),
      ],
    ]),
    new Map(),
  );
  const markers = buildMyCalendarDayMarkers([DATE], entries, [], 'caller');
  const day = markers.find((m) => m.date === DATE);
  assert.ok(day);
  assert.equal(day.dot, 'none');
  assert.equal(day.attendingCount, 0);
  assert.equal(day.consideringCount, 0);
});
