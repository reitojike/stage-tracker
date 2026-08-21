import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDaysToDate,
  buildMonthCalendarViewModel,
  buildMonthGrid,
  computeBadgeCounts,
  computeBandSegments,
  isBandEvent,
  layoutWeekBands,
  monthBounds,
  selectDayOccurrences,
  type BandSegment,
} from '../calendarMonth.ts';
import { mapEventRow, mapOccurrenceRow, type EventWithOccurrences } from '../eventCatalog.ts';

// Pure, DB-free tests for the Issue #20 month-calendar derivation: band
// classification/segmentation, badge counting, band layout/overflow, and
// selected-day full detail. Real Supabase/RLS wiring for the Catalog page
// itself is covered separately (test/integration/catalog.test.ts).

function event(overrides: Partial<Parameters<typeof mapEventRow>[0]> = {}) {
  return mapEventRow({
    id: 'event-1',
    owner_id: 'owner-1',
    title: 'Sample event',
    venue: null,
    source_url: null,
    memo: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  });
}

function occurrence(overrides: Partial<Parameters<typeof mapOccurrenceRow>[0]> = {}) {
  return mapOccurrenceRow({
    id: 'occurrence-1',
    event_id: 'event-1',
    starts_at: '2026-08-10T10:00:00Z',
    ends_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  });
}

// --- monthBounds / buildMonthGrid ---

void test('monthBounds: ordinary month', () => {
  assert.deepEqual(monthBounds('2026-08'), { firstDate: '2026-08-01', lastDate: '2026-08-31' });
});

void test('monthBounds: February in a non-leap year', () => {
  assert.deepEqual(monthBounds('2026-02'), { firstDate: '2026-02-01', lastDate: '2026-02-28' });
});

void test('monthBounds: February in a leap year', () => {
  assert.deepEqual(monthBounds('2028-02'), { firstDate: '2028-02-01', lastDate: '2028-02-29' });
});

void test('addDaysToDate: crosses a month/year boundary', () => {
  assert.equal(addDaysToDate('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysToDate('2027-01-01', -1), '2026-12-31');
});

void test('buildMonthGrid: every week has 7 days and covers the whole month', () => {
  const grid = buildMonthGrid('2026-08');
  for (const week of grid.weeks) {
    assert.equal(week.length, 7);
  }
  const allDates = grid.weeks.flat();
  assert.ok(allDates.includes('2026-08-01'));
  assert.ok(allDates.includes('2026-08-31'));
  // Sunday-start: the first date of every week is a Sunday (weekday 0).
  for (const week of grid.weeks) {
    const first = week[0];
    assert.ok(first);
    const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
    assert.equal(weekday, 0, `expected ${first} to be a Sunday`);
  }
});

void test('buildMonthGrid: lead/trail days from adjacent months fill the first/last week', () => {
  // 2026-08-01 is a Saturday, so the first week must lead with July dates.
  const grid = buildMonthGrid('2026-08');
  const firstWeek = grid.weeks[0];
  assert.ok(firstWeek);
  assert.ok(firstWeek.some((date) => date.startsWith('2026-07')));
  const lastWeek = grid.weeks.at(-1);
  assert.ok(lastWeek);
  assert.equal(firstWeek.length, 7);
  assert.equal(lastWeek.length, 7);
});

// --- isBandEvent / computeBandSegments (rest-day handling) ---

void test('isBandEvent: a single day with multiple occurrences (matinee + evening) is not a band', () => {
  const occurrences = [
    occurrence({ id: 'o1', starts_at: '2026-08-10T02:00:00Z' }),
    occurrence({ id: 'o2', starts_at: '2026-08-10T10:00:00Z' }),
  ];
  assert.equal(isBandEvent(occurrences), false);
});

void test('isBandEvent: occurrences on 2+ distinct Tokyo days is a band', () => {
  const occurrences = [
    occurrence({ id: 'o1', starts_at: '2026-08-10T02:00:00Z' }),
    occurrence({ id: 'o2', starts_at: '2026-08-11T02:00:00Z' }),
  ];
  assert.equal(isBandEvent(occurrences), true);
});

void test('computeBandSegments: a run with a rest day in the middle splits into two segments', () => {
  // 08-10, 08-11, [08-12 rest day: no occurrence], 08-13
  const kabuki = event({ id: 'kabuki', title: '歌舞伎公演' });
  const occurrences = [
    occurrence({ id: 'o1', event_id: 'kabuki', starts_at: '2026-08-10T02:00:00Z' }),
    occurrence({ id: 'o2', event_id: 'kabuki', starts_at: '2026-08-10T10:00:00Z' }),
    occurrence({ id: 'o3', event_id: 'kabuki', starts_at: '2026-08-11T02:00:00Z' }),
    occurrence({ id: 'o4', event_id: 'kabuki', starts_at: '2026-08-13T02:00:00Z' }),
  ];

  const segments = computeBandSegments(kabuki, occurrences);

  assert.deepEqual(segments, [
    { eventId: 'kabuki', eventTitle: '歌舞伎公演', startDate: '2026-08-10', endDate: '2026-08-11' },
    { eventId: 'kabuki', eventTitle: '歌舞伎公演', startDate: '2026-08-13', endDate: '2026-08-13' },
  ]);
  // The rest day itself (08-12) must not be covered by any segment.
  for (const segment of segments) {
    assert.ok(!(segment.startDate <= '2026-08-12' && '2026-08-12' <= segment.endDate));
  }
});

void test('computeBandSegments: fully consecutive occurrences produce one segment spanning the whole run', () => {
  const run = event({ id: 'run' });
  const occurrences = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13'].map((date, i) =>
    occurrence({ id: `o${String(i)}`, event_id: 'run', starts_at: `${date}T02:00:00Z` }),
  );
  const segments = computeBandSegments(run, occurrences);
  assert.deepEqual(segments, [
    { eventId: 'run', eventTitle: 'Sample event', startDate: '2026-08-10', endDate: '2026-08-13' },
  ]);
});

// --- computeBadgeCounts (double-counting rule) ---

void test('computeBadgeCounts: a band event alone on a day contributes 0 to that day badge', () => {
  const kabuki = event({ id: 'kabuki' });
  const catalog: EventWithOccurrences[] = [
    {
      event: kabuki,
      occurrences: [
        occurrence({ id: 'o1', event_id: 'kabuki', starts_at: '2026-08-10T02:00:00Z' }),
        occurrence({ id: 'o2', event_id: 'kabuki', starts_at: '2026-08-10T10:00:00Z' }),
        occurrence({ id: 'o3', event_id: 'kabuki', starts_at: '2026-08-11T02:00:00Z' }),
      ],
    },
  ];
  const counts = computeBadgeCounts(catalog);
  assert.equal(counts.get('2026-08-10') ?? 0, 0);
  assert.equal(counts.get('2026-08-11') ?? 0, 0);
});

void test('computeBadgeCounts: band + one standalone occurrence the same day counts only the standalone one', () => {
  const kabuki = event({ id: 'kabuki' });
  const live = event({ id: 'live', title: 'ライブ' });
  const catalog: EventWithOccurrences[] = [
    {
      event: kabuki,
      occurrences: [
        occurrence({ id: 'o1', event_id: 'kabuki', starts_at: '2026-08-10T02:00:00Z' }),
        occurrence({ id: 'o2', event_id: 'kabuki', starts_at: '2026-08-11T02:00:00Z' }),
      ],
    },
    {
      event: live,
      occurrences: [occurrence({ id: 'o3', event_id: 'live', starts_at: '2026-08-10T10:00:00Z' })],
    },
  ];
  const counts = computeBadgeCounts(catalog);
  assert.equal(counts.get('2026-08-10'), 1);
});

void test('computeBadgeCounts: band + two standalone occurrences the same day counts 2', () => {
  const kabuki = event({ id: 'kabuki' });
  const live = event({ id: 'live', title: 'ライブ' });
  const another = event({ id: 'another', title: '朗読劇' });
  const catalog: EventWithOccurrences[] = [
    {
      event: kabuki,
      occurrences: [
        occurrence({ id: 'o1', event_id: 'kabuki', starts_at: '2026-08-10T02:00:00Z' }),
        occurrence({ id: 'o2', event_id: 'kabuki', starts_at: '2026-08-11T02:00:00Z' }),
      ],
    },
    {
      event: live,
      occurrences: [occurrence({ id: 'o3', event_id: 'live', starts_at: '2026-08-10T10:00:00Z' })],
    },
    {
      event: another,
      occurrences: [
        occurrence({ id: 'o4', event_id: 'another', starts_at: '2026-08-10T11:00:00Z' }),
      ],
    },
  ];
  const counts = computeBadgeCounts(catalog);
  assert.equal(counts.get('2026-08-10'), 2);
});

void test('computeBadgeCounts: a rest day with no occurrence for any event is absent (not zero-fabricated as a performance day)', () => {
  const kabuki = event({ id: 'kabuki' });
  const catalog: EventWithOccurrences[] = [
    {
      event: kabuki,
      occurrences: [
        occurrence({ id: 'o1', event_id: 'kabuki', starts_at: '2026-08-10T02:00:00Z' }),
        occurrence({ id: 'o2', event_id: 'kabuki', starts_at: '2026-08-13T02:00:00Z' }),
      ],
    },
  ];
  const counts = computeBadgeCounts(catalog);
  assert.equal(counts.has('2026-08-11'), false);
  assert.equal(counts.has('2026-08-12'), false);
});

// --- layoutWeekBands (multiple bands / overflow) ---

const WEEK = [
  '2026-08-09',
  '2026-08-10',
  '2026-08-11',
  '2026-08-12',
  '2026-08-13',
  '2026-08-14',
  '2026-08-15',
];

function seg(eventId: string, startDate: string, endDate: string): BandSegment {
  return { eventId, eventTitle: eventId, startDate, endDate };
}

void test('layoutWeekBands: a single segment is placed in lane 0 at the right columns', () => {
  const layout = layoutWeekBands(WEEK, [seg('a', '2026-08-10', '2026-08-12')]);
  assert.equal(layout.segments.length, 1);
  assert.equal(layout.overflowCount, 0);
  const only = layout.segments[0];
  assert.ok(only);
  assert.equal(only.lane, 0);
  assert.equal(only.startCol, 1);
  assert.equal(only.endCol, 3);
});

void test('layoutWeekBands: two non-overlapping bands can share lane 0', () => {
  const layout = layoutWeekBands(WEEK, [
    seg('a', '2026-08-09', '2026-08-10'),
    seg('b', '2026-08-12', '2026-08-13'),
  ]);
  assert.equal(layout.segments.length, 2);
  assert.equal(layout.overflowCount, 0);
  assert.ok(layout.segments.every((segment) => segment.lane === 0));
});

void test('layoutWeekBands: two overlapping bands get distinct lanes', () => {
  const layout = layoutWeekBands(WEEK, [
    seg('a', '2026-08-09', '2026-08-13'),
    seg('b', '2026-08-10', '2026-08-11'),
  ]);
  assert.equal(layout.segments.length, 2);
  assert.equal(layout.overflowCount, 0);
  const lanes = new Set(layout.segments.map((segment) => segment.lane));
  assert.equal(lanes.size, 2);
});

void test('layoutWeekBands: bands beyond the lane cap overflow instead of being dropped silently', () => {
  const overlapping = ['a', 'b', 'c', 'd'].map((id) => seg(id, '2026-08-10', '2026-08-11'));
  const layout = layoutWeekBands(WEEK, overlapping, 3);
  assert.equal(layout.segments.length, 3);
  assert.equal(layout.overflowCount, 1);
});

void test('layoutWeekBands: a run spanning a week boundary is clipped per week', () => {
  const spanning = seg('a', '2026-08-13', '2026-08-17');
  const thisWeek = layoutWeekBands(WEEK, [spanning]);
  assert.equal(thisWeek.segments.length, 1);
  assert.equal(thisWeek.segments[0]?.startCol, 4); // 08-13
  assert.equal(thisWeek.segments[0].endCol, 6); // 08-15 (week end, clipped)

  const nextWeek = [
    '2026-08-16',
    '2026-08-17',
    '2026-08-18',
    '2026-08-19',
    '2026-08-20',
    '2026-08-21',
    '2026-08-22',
  ];
  const nextWeekLayout = layoutWeekBands(nextWeek, [spanning]);
  assert.equal(nextWeekLayout.segments.length, 1);
  assert.equal(nextWeekLayout.segments[0]?.startCol, 0); // 08-16 (week start, clipped)
  assert.equal(nextWeekLayout.segments[0].endCol, 1); // 08-17
});

// --- buildMonthCalendarViewModel (integration of grid + bands + badges) ---

void test('buildMonthCalendarViewModel: a rest day inside a run shows badgeCount 0 and no band segment covers it', () => {
  const kabuki = event({ id: 'kabuki' });
  const catalog: EventWithOccurrences[] = [
    {
      event: kabuki,
      occurrences: [
        occurrence({ id: 'o1', event_id: 'kabuki', starts_at: '2026-08-10T02:00:00Z' }),
        occurrence({ id: 'o2', event_id: 'kabuki', starts_at: '2026-08-11T02:00:00Z' }),
        occurrence({ id: 'o3', event_id: 'kabuki', starts_at: '2026-08-13T02:00:00Z' }),
      ],
    },
  ];
  const model = buildMonthCalendarViewModel('2026-08', catalog);
  const day = model.weeks.flatMap((w) => w.days).find((d) => d.date === '2026-08-12');
  assert.ok(day);
  assert.equal(day.badgeCount, 0);

  const coveringSegment = model.weeks
    .flatMap((w) => w.bandLayout.segments)
    .find((segment) => segment.startDate <= '2026-08-12' && '2026-08-12' <= segment.endDate);
  assert.equal(coveringSegment, undefined, 'a rest day must not be covered by any band segment');
});

void test('buildMonthCalendarViewModel: multiple concurrent bands can appear the same week', () => {
  const a = event({ id: 'a', title: 'A' });
  const b = event({ id: 'b', title: 'B' });
  const catalog: EventWithOccurrences[] = [
    {
      event: a,
      occurrences: [
        occurrence({ id: 'a1', event_id: 'a', starts_at: '2026-08-10T02:00:00Z' }),
        occurrence({ id: 'a2', event_id: 'a', starts_at: '2026-08-11T02:00:00Z' }),
        occurrence({ id: 'a3', event_id: 'a', starts_at: '2026-08-12T02:00:00Z' }),
      ],
    },
    {
      event: b,
      occurrences: [
        occurrence({ id: 'b1', event_id: 'b', starts_at: '2026-08-11T02:00:00Z' }),
        occurrence({ id: 'b2', event_id: 'b', starts_at: '2026-08-12T02:00:00Z' }),
        occurrence({ id: 'b3', event_id: 'b', starts_at: '2026-08-13T02:00:00Z' }),
      ],
    },
  ];
  const model = buildMonthCalendarViewModel('2026-08', catalog);
  const week = model.weeks.find((w) => w.days.some((d) => d.date === '2026-08-10'));
  assert.ok(week);
  const lanes = new Set(week.bandLayout.segments.map((s) => s.lane));
  assert.ok(lanes.size >= 2, 'expected both concurrent bands to be laid out');
});

// --- selectDayOccurrences (full, lossless day detail) ---

void test('selectDayOccurrences: same-day multiple occurrences are listed individually, not collapsed', () => {
  const kabuki = event({ id: 'kabuki', title: '歌舞伎' });
  const live = event({ id: 'live', title: 'ライブ' });
  const catalog: EventWithOccurrences[] = [
    {
      event: kabuki,
      occurrences: [
        occurrence({ id: 'matinee', event_id: 'kabuki', starts_at: '2026-08-10T02:00:00Z' }), // 11:00 JST
        occurrence({ id: 'evening', event_id: 'kabuki', starts_at: '2026-08-10T07:00:00Z' }), // 16:00 JST
        // A second run day makes this event a band (isBandEvent requires
        // >= 2 distinct days), so this test also covers a band event's
        // occurrences still appearing individually in the day list.
        occurrence({ id: 'next-day', event_id: 'kabuki', starts_at: '2026-08-11T02:00:00Z' }),
      ],
    },
    {
      event: live,
      occurrences: [
        occurrence({ id: 'live1', event_id: 'live', starts_at: '2026-08-10T10:30:00Z' }),
      ], // 19:30 JST
    },
  ];

  const result = selectDayOccurrences(catalog, '2026-08-10');

  assert.equal(result.length, 3);
  assert.deepEqual(
    result.map((r) => r.occurrence.id),
    ['matinee', 'evening', 'live1'],
  );
  assert.equal(result[0]?.isBandEvent, true);
  assert.equal(result[1]?.isBandEvent, true);
  assert.equal(result[2]?.isBandEvent, false);
});

void test('selectDayOccurrences: reaches band-event occurrences even when the month view would have omitted the band from overflow', () => {
  const kabuki = event({ id: 'kabuki' });
  const catalog: EventWithOccurrences[] = [
    {
      event: kabuki,
      occurrences: [
        occurrence({ id: 'o1', event_id: 'kabuki', starts_at: '2026-08-10T02:00:00Z' }),
      ],
    },
  ];
  // Even a single-occurrence band-eligible check: full day detail does not
  // depend on isBandEvent/overflow status at all.
  const result = selectDayOccurrences(catalog, '2026-08-10');
  assert.equal(result.length, 1);
});

void test('selectDayOccurrences: nullable end time is passed through as null, never fabricated', () => {
  const withUnknownEnd = event({ id: 'e1' });
  const catalog: EventWithOccurrences[] = [
    {
      event: withUnknownEnd,
      occurrences: [
        occurrence({ id: 'o1', event_id: 'e1', starts_at: '2026-08-10T02:00:00Z', ends_at: null }),
      ],
    },
  ];
  const result = selectDayOccurrences(catalog, '2026-08-10');
  assert.equal(result[0]?.occurrence.endsAt, null);
});

void test('selectDayOccurrences: a day with no occurrences returns an empty array, not a fabricated entry', () => {
  const result = selectDayOccurrences([], '2026-08-10');
  assert.deepEqual(result, []);
});
