import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDaysToDate,
  buildMonthCalendarViewModel,
  buildMonthGrid,
  computeBadgeCounts,
  eventRangeBandSegment,
  isSingleDayEvent,
  isValidCalendarDate,
  isValidYearMonth,
  layoutWeekBands,
  monthBounds,
  selectDayOccurrences,
  selectEventLevelFallback,
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
    starts_on: '2026-01-01',
    ends_on: '2026-12-31',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  });
}

function occurrence(overrides: Partial<Parameters<typeof mapOccurrenceRow>[0]> = {}) {
  return mapOccurrenceRow({
    id: 'occurrence-1',
    event_id: 'event-1',
    doors_at: null,
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

void test('isValidYearMonth: accepts real months, rejects shape-valid-but-invalid ones', () => {
  assert.equal(isValidYearMonth('2026-08'), true);
  assert.equal(isValidYearMonth('2026-13'), false); // out-of-range month
  assert.equal(isValidYearMonth('2026-00'), false);
  assert.equal(isValidYearMonth('not-a-month'), false);
  // A 1-2 digit year would trigger JS's legacy Date.UTC 19xx remap if not
  // caught: Date.UTC(50, ...) resolves to 1950, which the round-trip check
  // must reject rather than silently accept as "year 50".
  assert.equal(isValidYearMonth('0050-06'), false);
});

void test('isValidCalendarDate: accepts real dates, rejects shape-valid-but-invalid ones', () => {
  assert.equal(isValidCalendarDate('2026-08-21'), true);
  assert.equal(isValidCalendarDate('2026-02-30'), false);
  assert.equal(isValidCalendarDate('2026-13-01'), false);
  assert.equal(isValidCalendarDate('not-a-date'), false);
});

void test('monthBounds: throws on a calendar-invalid month rather than silently rolling over', () => {
  assert.throws(() => monthBounds('2026-13'));
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

// --- isSingleDayEvent (Issue #91 PO decision: single-day/multi-day classification) ---

void test('isSingleDayEvent: true when starts_on === ends_on', () => {
  const single = event({ starts_on: '2026-08-10', ends_on: '2026-08-10' });
  assert.equal(isSingleDayEvent(single), true);
});

void test('isSingleDayEvent: false when starts_on < ends_on', () => {
  const multi = event({ starts_on: '2026-08-10', ends_on: '2026-08-11' });
  assert.equal(isSingleDayEvent(multi), false);
});

// --- eventRangeBandSegment (band source is the Event range, multi-day only) ---

void test('eventRangeBandSegment: a multi-day range produces one segment spanning starts_on..ends_on, regardless of an occurrence gap inside it', () => {
  // 08-10, 08-11, [08-12: no occurrence at all], 08-13 - the range still
  // covers the whole span; a day with no occurrence is not a reason to
  // split the band (Issue #91 supersedes the old rest-day-splitting rule).
  const kabuki = event({
    id: 'kabuki',
    title: '歌舞伎公演',
    starts_on: '2026-08-10',
    ends_on: '2026-08-13',
  });
  const segment = eventRangeBandSegment(kabuki);
  assert.deepEqual(segment, {
    eventId: 'kabuki',
    eventTitle: '歌舞伎公演',
    startDate: '2026-08-10',
    endDate: '2026-08-13',
  });
});

void test('eventRangeBandSegment: is derived from the event alone - a 0-occurrence event still produces a segment', () => {
  const rangeOnly = event({ id: 'range-only', starts_on: '2026-09-01', ends_on: '2026-09-03' });
  const segment = eventRangeBandSegment(rangeOnly);
  assert.deepEqual(segment, {
    eventId: 'range-only',
    eventTitle: 'Sample event',
    startDate: '2026-09-01',
    endDate: '2026-09-03',
  });
});

// --- computeBadgeCounts (Issue #91 PO decision: single-day Event count, not occurrence count) ---

void test('computeBadgeCounts: a single-day event with 0 occurrences still counts once on its own date', () => {
  const single = event({ id: 'single', starts_on: '2026-08-10', ends_on: '2026-08-10' });
  const catalog: EventWithOccurrences[] = [{ event: single, occurrences: [] }];
  const counts = computeBadgeCounts(catalog);
  assert.equal(counts.get('2026-08-10'), 1);
});

void test('computeBadgeCounts: a single-day event with several occurrences (matinee + evening) still counts once, not once per occurrence', () => {
  const single = event({ id: 'single', starts_on: '2026-08-10', ends_on: '2026-08-10' });
  const catalog: EventWithOccurrences[] = [
    {
      event: single,
      occurrences: [
        occurrence({ id: 'o1', event_id: 'single', starts_at: '2026-08-10T02:00:00Z' }),
        occurrence({ id: 'o2', event_id: 'single', starts_at: '2026-08-10T10:00:00Z' }),
      ],
    },
  ];
  const counts = computeBadgeCounts(catalog);
  assert.equal(counts.get('2026-08-10'), 1);
});

void test('computeBadgeCounts: a multi-day event never contributes, with or without occurrences', () => {
  const withOccurrences = event({ id: 'a', starts_on: '2026-08-10', ends_on: '2026-08-11' });
  const withoutOccurrences = event({ id: 'b', starts_on: '2026-08-12', ends_on: '2026-08-13' });
  const catalog: EventWithOccurrences[] = [
    {
      event: withOccurrences,
      occurrences: [
        occurrence({ id: 'o1', event_id: 'a', starts_at: '2026-08-10T02:00:00Z' }),
        occurrence({ id: 'o2', event_id: 'a', starts_at: '2026-08-11T02:00:00Z' }),
      ],
    },
    { event: withoutOccurrences, occurrences: [] },
  ];
  const counts = computeBadgeCounts(catalog);
  assert.equal(counts.size, 0);
});

void test('computeBadgeCounts: counts multiple single-day events landing on the same date', () => {
  const a = event({ id: 'a', title: 'A', starts_on: '2026-08-10', ends_on: '2026-08-10' });
  const b = event({ id: 'b', title: 'B', starts_on: '2026-08-10', ends_on: '2026-08-10' });
  const c = event({ id: 'c', title: 'C', starts_on: '2026-08-10', ends_on: '2026-08-10' });
  const catalog: EventWithOccurrences[] = [
    { event: a, occurrences: [] },
    {
      event: b,
      occurrences: [occurrence({ id: 'o1', event_id: 'b', starts_at: '2026-08-10T10:00:00Z' })],
    },
    {
      event: c,
      occurrences: [
        occurrence({ id: 'o2', event_id: 'c', starts_at: '2026-08-10T11:00:00Z' }),
        occurrence({ id: 'o3', event_id: 'c', starts_at: '2026-08-10T12:00:00Z' }),
      ],
    },
  ];
  const counts = computeBadgeCounts(catalog);
  assert.equal(counts.get('2026-08-10'), 3);
});

void test('computeBadgeCounts: mixed same-day single-day and multi-day events - count reflects single-day events only', () => {
  // PO minimum regression case 5.
  const singleA = event({ id: 'single-a', starts_on: '2026-08-10', ends_on: '2026-08-10' });
  const singleB = event({ id: 'single-b', starts_on: '2026-08-10', ends_on: '2026-08-10' });
  const multi = event({ id: 'multi', starts_on: '2026-08-09', ends_on: '2026-08-11' });
  const catalog: EventWithOccurrences[] = [
    { event: singleA, occurrences: [] },
    {
      event: singleB,
      occurrences: [
        occurrence({ id: 'o1', event_id: 'single-b', starts_at: '2026-08-10T02:00:00Z' }),
      ],
    },
    {
      event: multi,
      occurrences: [occurrence({ id: 'o2', event_id: 'multi', starts_at: '2026-08-10T10:00:00Z' })],
    },
  ];
  const counts = computeBadgeCounts(catalog);
  assert.equal(counts.get('2026-08-10'), 2);
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

void test('layoutWeekBands: bands beyond the lane cap overflow instead of being dropped silently, and overflowEvents names which one', () => {
  const overlapping = ['a', 'b', 'c', 'd'].map((id) => seg(id, '2026-08-10', '2026-08-11'));
  const layout = layoutWeekBands(WEEK, overlapping, 3);
  assert.equal(layout.segments.length, 3);
  assert.equal(layout.overflowCount, 1);
  assert.deepEqual(layout.overflowEvents, [{ eventId: 'd', eventTitle: 'd' }]);
});

void test('layoutWeekBands: start-ascending lane assignment fits everything a length-first sort would spuriously overflow', () => {
  // A spans the whole week; B/C/D/E are pairwise non-overlapping with each
  // other and only conflict with A, so optimal packing needs just 2 lanes
  // (A alone in one; B, C, D, E sharing the other). A length-descending
  // sort can instead place a later-starting, shorter segment (E) into the
  // shared lane before an earlier-starting one (C/D) gets a chance,
  // artificially forcing C/D into overflow even though 2 lanes suffice.
  const segments = [
    seg('A', '2026-08-09', '2026-08-15'),
    seg('B', '2026-08-09', '2026-08-11'),
    seg('C', '2026-08-12', '2026-08-12'),
    seg('D', '2026-08-13', '2026-08-13'),
    seg('E', '2026-08-14', '2026-08-15'),
  ];
  const layout = layoutWeekBands(WEEK, segments, 2);
  assert.equal(layout.overflowCount, 0, 'expected all 5 segments to fit within 2 lanes');
  assert.equal(layout.segments.length, 5);
});

void test('layoutWeekBands: one event split into two segments by a rest day counts as one overflow, not two', () => {
  // Event X's run is split by a rest day into two segments within the same
  // week; three unrelated events fill every lane for the whole week, so
  // both of X's segments overflow - but that is still only one hidden
  // *event*, not two.
  const xSegments = [seg('x', '2026-08-09', '2026-08-10'), seg('x', '2026-08-12', '2026-08-13')];
  const fillers = ['a', 'b', 'c'].map((id) => seg(id, '2026-08-09', '2026-08-15'));
  const layout = layoutWeekBands(WEEK, [...fillers, ...xSegments], 3);
  assert.equal(
    layout.overflowCount,
    1,
    'expected one overflowing event (x), not one per overflowing segment',
  );
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

void test('buildMonthCalendarViewModel: a day inside the Event range with no occurrence shows badgeCount 0 but is still covered by the range band (Issue #91)', () => {
  const kabuki = event({ id: 'kabuki', starts_on: '2026-08-10', ends_on: '2026-08-13' });
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
  // No occurrence on 08-12: badge stays 0, the badge is occurrence-only.
  assert.equal(day.badgeCount, 0);

  // But the band itself is the Event range as-is (08-10..08-13), so 08-12
  // - inside the range despite having no occurrence evidence - is still
  // covered by the band. The band never means "there is an occurrence here".
  const coveringSegment = model.weeks
    .flatMap((w) => w.bandLayout.segments)
    .find((segment) => segment.startDate <= '2026-08-12' && '2026-08-12' <= segment.endDate);
  assert.ok(coveringSegment, 'the Event range band must cover every day in starts_on..ends_on');
});

void test('buildMonthCalendarViewModel: a 0-occurrence event is banded by its Event range', () => {
  const rangeOnly = event({ id: 'range-only', starts_on: '2026-08-05', ends_on: '2026-08-07' });
  const catalog: EventWithOccurrences[] = [{ event: rangeOnly, occurrences: [] }];
  const model = buildMonthCalendarViewModel('2026-08', catalog);

  const segments = model.weeks.flatMap((w) => w.bandLayout.segments);
  assert.ok(
    segments.some(
      (s) =>
        s.eventId === 'range-only' && s.startDate === '2026-08-05' && s.endDate === '2026-08-07',
    ),
  );
  // No occurrence anywhere in the range: every day's badge stays 0.
  const days = model.weeks
    .flatMap((w) => w.days)
    .filter((d) => d.date >= '2026-08-05' && d.date <= '2026-08-07');
  assert.ok(days.every((d) => d.badgeCount === 0));
});

void test('buildMonthCalendarViewModel: an occurrence-bearing event does not double-band (range band only, no separate occurrence-derived band)', () => {
  const multi = event({ id: 'multi', starts_on: '2026-08-10', ends_on: '2026-08-12' });
  const catalog: EventWithOccurrences[] = [
    {
      event: multi,
      occurrences: [
        occurrence({ id: 'o1', event_id: 'multi', starts_at: '2026-08-10T02:00:00Z' }),
        occurrence({ id: 'o2', event_id: 'multi', starts_at: '2026-08-12T02:00:00Z' }),
      ],
    },
  ];
  const model = buildMonthCalendarViewModel('2026-08', catalog);
  const segmentsForEvent = model.weeks
    .flatMap((w) => w.bandLayout.segments)
    .filter((s) => s.eventId === 'multi');
  // Exactly one band segment covering the whole displayed range (clipped
  // per week by layoutWeekBands, so this may be >1 positioned segment only
  // if the range crosses a week boundary - it does not here).
  assert.equal(segmentsForEvent.length, 1);
  const [only] = segmentsForEvent;
  assert.ok(only);
  assert.equal(only.startDate, '2026-08-10');
  assert.equal(only.endDate, '2026-08-12');
});

// --- PO minimum regression cases (Issue #91 "restore single-day count / multi-day band presentation") ---

void test('buildMonthCalendarViewModel: case 1 - a 0-occurrence single-day event has no band, counts +1 on its date, and has no selected-day occurrence', () => {
  const single = event({
    id: 'single',
    title: '単発公演',
    starts_on: '2026-08-10',
    ends_on: '2026-08-10',
  });
  const catalog: EventWithOccurrences[] = [{ event: single, occurrences: [] }];

  const model = buildMonthCalendarViewModel('2026-08', catalog);
  const segments = model.weeks.flatMap((w) => w.bandLayout.segments);
  assert.equal(
    segments.some((s) => s.eventId === 'single'),
    false,
    'a single-day event must never band',
  );
  const day = model.weeks.flatMap((w) => w.days).find((d) => d.date === '2026-08-10');
  assert.ok(day);
  assert.equal(day.badgeCount, 1);

  assert.deepEqual(selectDayOccurrences(catalog, '2026-08-10'), []);
});

void test('buildMonthCalendarViewModel: case 2 - a single-day event with one or more occurrences has no band, still counts +1 (not per-occurrence), and shows its actual occurrences in the selected-day list', () => {
  const single = event({
    id: 'single',
    title: '単発公演',
    starts_on: '2026-08-10',
    ends_on: '2026-08-10',
  });
  const catalog: EventWithOccurrences[] = [
    {
      event: single,
      occurrences: [
        occurrence({ id: 'matinee', event_id: 'single', starts_at: '2026-08-10T02:00:00Z' }),
        occurrence({ id: 'evening', event_id: 'single', starts_at: '2026-08-10T10:00:00Z' }),
      ],
    },
  ];

  const model = buildMonthCalendarViewModel('2026-08', catalog);
  const segments = model.weeks.flatMap((w) => w.bandLayout.segments);
  assert.equal(
    segments.some((s) => s.eventId === 'single'),
    false,
  );
  const day = model.weeks.flatMap((w) => w.days).find((d) => d.date === '2026-08-10');
  assert.ok(day);
  assert.equal(day.badgeCount, 1, 'two occurrences still count as one Event, not two');

  const dayOccurrences = selectDayOccurrences(catalog, '2026-08-10');
  assert.equal(dayOccurrences.length, 2);
  assert.deepEqual(
    dayOccurrences.map((r) => r.occurrence.id),
    ['matinee', 'evening'],
  );
});

void test('buildMonthCalendarViewModel: case 3 - a 0-occurrence multi-day event renders a range band and contributes +0 to any day count', () => {
  const multi = event({
    id: 'multi',
    title: '長期公演',
    starts_on: '2026-08-10',
    ends_on: '2026-08-13',
  });
  const catalog: EventWithOccurrences[] = [{ event: multi, occurrences: [] }];

  const model = buildMonthCalendarViewModel('2026-08', catalog);
  const segments = model.weeks
    .flatMap((w) => w.bandLayout.segments)
    .filter((s) => s.eventId === 'multi');
  assert.equal(segments.length, 1);
  const [only] = segments;
  assert.ok(only);
  assert.equal(only.startDate, '2026-08-10');
  assert.equal(only.endDate, '2026-08-13');

  const days = model.weeks
    .flatMap((w) => w.days)
    .filter((d) => d.date >= '2026-08-10' && d.date <= '2026-08-13');
  assert.ok(days.every((d) => d.badgeCount === 0));
});

void test('buildMonthCalendarViewModel: case 4 - a multi-day event with occurrences renders a range band, contributes +0 to any day count, and shows only its actual occurrences in the selected-day list', () => {
  const multi = event({
    id: 'multi',
    title: '長期公演',
    starts_on: '2026-08-10',
    ends_on: '2026-08-13',
  });
  const catalog: EventWithOccurrences[] = [
    {
      event: multi,
      occurrences: [
        occurrence({ id: 'o1', event_id: 'multi', starts_at: '2026-08-10T02:00:00Z' }),
        occurrence({ id: 'o2', event_id: 'multi', starts_at: '2026-08-13T02:00:00Z' }),
      ],
    },
  ];

  const model = buildMonthCalendarViewModel('2026-08', catalog);
  const segments = model.weeks
    .flatMap((w) => w.bandLayout.segments)
    .filter((s) => s.eventId === 'multi');
  assert.equal(segments.length, 1);

  const days = model.weeks
    .flatMap((w) => w.days)
    .filter((d) => d.date >= '2026-08-10' && d.date <= '2026-08-13');
  assert.ok(days.every((d) => d.badgeCount === 0));

  assert.equal(selectDayOccurrences(catalog, '2026-08-10').length, 1);
  assert.equal(selectDayOccurrences(catalog, '2026-08-11').length, 0);
  assert.equal(selectDayOccurrences(catalog, '2026-08-13').length, 1);
});

void test('buildMonthCalendarViewModel: case 5 - a single-day and a multi-day event on the same date: the count reflects only the single-day event, the multi-day event is represented only by its band', () => {
  const single = event({
    id: 'single',
    title: '単発公演',
    starts_on: '2026-08-10',
    ends_on: '2026-08-10',
  });
  const multi = event({
    id: 'multi',
    title: '長期公演',
    starts_on: '2026-08-08',
    ends_on: '2026-08-12',
  });
  const catalog: EventWithOccurrences[] = [
    { event: single, occurrences: [] },
    {
      event: multi,
      occurrences: [occurrence({ id: 'o1', event_id: 'multi', starts_at: '2026-08-10T02:00:00Z' })],
    },
  ];

  const model = buildMonthCalendarViewModel('2026-08', catalog);
  const day = model.weeks.flatMap((w) => w.days).find((d) => d.date === '2026-08-10');
  assert.ok(day);
  assert.equal(day.badgeCount, 1, 'count reflects the single-day event only');

  const segments = model.weeks.flatMap((w) => w.bandLayout.segments);
  assert.equal(
    segments.some((s) => s.eventId === 'single'),
    false,
  );
  assert.equal(
    segments.some((s) => s.eventId === 'multi'),
    true,
  );
});

void test('buildMonthCalendarViewModel: an event overflowing a week where it has no occurrence is still reachable via overflowEvents, since no day in that week would surface it via selectDayOccurrences', () => {
  // week1 of the 2026-08 grid is 2026-08-02..2026-08-08 (2026-08-01 is a
  // Saturday). Three fillers occupy every lane that whole week.
  const fillers = ['filler-a', 'filler-b', 'filler-c'].map((id) =>
    event({ id, title: id, starts_on: '2026-08-02', ends_on: '2026-08-08' }),
  );
  // target's Event range also covers week1, but its only occurrence is in
  // week3 (2026-08-16..2026-08-22) - week1 has no occurrence evidence for
  // it at all, unlike the old occurrence-derived band rule where an
  // overflowing band always had an occurrence somewhere in that same week.
  const target = event({
    id: 'target',
    title: 'Target',
    starts_on: '2026-08-02',
    ends_on: '2026-08-20',
  });
  const catalog: EventWithOccurrences[] = [
    ...fillers.map((f) => ({ event: f, occurrences: [] })),
    {
      event: target,
      occurrences: [
        occurrence({ id: 'o1', event_id: 'target', starts_at: '2026-08-18T02:00:00Z' }),
      ],
    },
  ];

  const model = buildMonthCalendarViewModel('2026-08', catalog);
  const week1 = model.weeks.find((w) => w.days.some((d) => d.date === '2026-08-02'));
  assert.ok(week1);
  assert.equal(
    week1.bandLayout.segments.some((s) => s.eventId === 'target'),
    false,
  );
  assert.deepEqual(week1.bandLayout.overflowEvents, [{ eventId: 'target', eventTitle: 'Target' }]);

  // Confirms the gap this closes: no day in week1 has an occurrence for
  // target, so selectDayOccurrences alone would never surface it there.
  for (const day of week1.days) {
    const dayResult = selectDayOccurrences(catalog, day.date).filter(
      (r) => r.event.id === 'target',
    );
    assert.equal(dayResult.length, 0);
  }
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

void test('buildMonthCalendarViewModel: applies the global weekday/holiday role to each day cell, reusing calendarDayRole.ts rather than a Catalog-local rule', () => {
  const model = buildMonthCalendarViewModel('2026-01', []);
  const days = model.weeks.flatMap((w) => w.days);
  // 2026-01-01 (元日) is a Thursday - holiday role wins over the plain
  // weekday, matching calendarDayRole.ts's own priority.
  assert.equal(days.find((d) => d.date === '2026-01-01')?.role, 'holiday');
  // 2026-01-03 is a Saturday, 2026-01-04 is a Sunday, and neither is a
  // holiday.
  assert.equal(days.find((d) => d.date === '2026-01-03')?.role, 'saturday');
  assert.equal(days.find((d) => d.date === '2026-01-04')?.role, 'sunday');
  assert.equal(days.find((d) => d.date === '2026-01-05')?.role, 'weekday');
});

void test('buildMonthCalendarViewModel: hasUnconfirmedHolidayCoverage is false for a month fully inside the Japanese-holiday snapshot coverage', () => {
  const model = buildMonthCalendarViewModel('2026-08', []);
  assert.equal(model.hasUnconfirmedHolidayCoverage, false);
  const days = model.weeks.flatMap((w) => w.days);
  assert.ok(days.every((d) => d.holidayDataConfirmed));
});

void test("buildMonthCalendarViewModel: hasUnconfirmedHolidayCoverage is true once an in-month date falls outside the holiday snapshot coverage, matching My Calendar's own convention", () => {
  // JAPANESE_HOLIDAY_DATA_COVERAGE_END is late 2027 (see
  // calendarDayRole.test.ts); December 2027 therefore has at least one
  // in-current-month date past coverage.
  const model = buildMonthCalendarViewModel('2027-12', []);
  assert.equal(model.hasUnconfirmedHolidayCoverage, true);
  const inMonthDays = model.weeks.flatMap((w) => w.days).filter((d) => d.inCurrentMonth);
  assert.ok(inMonthDays.some((d) => !d.holidayDataConfirmed));
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
        // A second run day, so this test also covers a multi-day event's
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
});

void test("selectDayOccurrences: reaches an event's occurrences even when the month view would have omitted its band from overflow", () => {
  const kabuki = event({ id: 'kabuki' });
  const catalog: EventWithOccurrences[] = [
    {
      event: kabuki,
      occurrences: [
        occurrence({ id: 'o1', event_id: 'kabuki', starts_at: '2026-08-10T02:00:00Z' }),
      ],
    },
  ];
  // Full day detail does not depend on band/overflow status at all.
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

// --- selectEventLevelFallback (Issue #109: per-selected-date Event-level
// fallback, superseding #100's selectRangeOnlyEvents) ---

void test("selectEventLevelFallback: a 0-occurrence single-day event's own date qualifies", () => {
  const single = event({ id: 'single', starts_on: '2026-08-30', ends_on: '2026-08-30' });
  const catalog: EventWithOccurrences[] = [{ event: single, occurrences: [] }];

  const result = selectEventLevelFallback(catalog, '2026-08-30');

  assert.deepEqual(
    result.map((r) => r.event.id),
    ['single'],
  );
});

void test('selectEventLevelFallback: any other date does not qualify a single-day event (Production regression: selected 2026-08-25, event on 2026-08-30)', () => {
  const single = event({ id: 'single', starts_on: '2026-08-30', ends_on: '2026-08-30' });
  const catalog: EventWithOccurrences[] = [{ event: single, occurrences: [] }];

  const result = selectEventLevelFallback(catalog, '2026-08-25');

  assert.deepEqual(result, []);
});

void test('selectEventLevelFallback: a date inside a multi-day range (including boundaries) qualifies a 0-occurrence event', () => {
  const multi = event({ id: 'multi', starts_on: '2026-08-10', ends_on: '2026-08-13' });
  const catalog: EventWithOccurrences[] = [{ event: multi, occurrences: [] }];

  for (const date of ['2026-08-10', '2026-08-11', '2026-08-13']) {
    assert.deepEqual(
      selectEventLevelFallback(catalog, date).map((r) => r.event.id),
      ['multi'],
      `expected 'multi' to be a fallback candidate for ${date}`,
    );
  }
});

void test('selectEventLevelFallback: a date outside a multi-day range does not qualify', () => {
  const multi = event({ id: 'multi', starts_on: '2026-08-10', ends_on: '2026-08-13' });
  const catalog: EventWithOccurrences[] = [{ event: multi, occurrences: [] }];

  assert.deepEqual(selectEventLevelFallback(catalog, '2026-08-09'), []);
  assert.deepEqual(selectEventLevelFallback(catalog, '2026-08-14'), []);
});

void test('selectEventLevelFallback: no matching event on the selected date returns an empty array (caller renders no section)', () => {
  const withOccurrence = event({ id: 'with-occurrence' });
  const catalog: EventWithOccurrences[] = [
    { event: withOccurrence, occurrences: [occurrence({ event_id: 'with-occurrence' })] },
  ];

  assert.deepEqual(selectEventLevelFallback(catalog, '2026-08-10'), []);
});

void test('selectEventLevelFallback: an event with an actual occurrence on the selected date is excluded, never duplicating selectDayOccurrences', () => {
  const withOccurrence = event({
    id: 'with-occurrence',
    starts_on: '2026-08-01',
    ends_on: '2026-08-31',
  });
  const catalog: EventWithOccurrences[] = [
    {
      event: withOccurrence,
      occurrences: [occurrence({ event_id: 'with-occurrence', starts_at: '2026-08-10T02:00:00Z' })],
    },
  ];

  assert.deepEqual(selectEventLevelFallback(catalog, '2026-08-10'), []);
  assert.equal(
    selectDayOccurrences(catalog, '2026-08-10').length,
    1,
    'the same event/date pair must be covered by selectDayOccurrences instead',
  );
});

void test('selectEventLevelFallback: an event with occurrences elsewhere in its range still qualifies for a date it has none on - not a whole-event "0 occurrences" classification (Issue #109 minimum regression case 6)', () => {
  // kabuki has occurrences on 08-10 and 08-13, but nothing on 08-11/08-12 -
  // the old selectRangeOnlyEvents (`group.occurrences.length === 0`) would
  // have excluded this event everywhere, since its occurrences array here is
  // non-empty. selectEventLevelFallback must instead decide per date.
  const kabuki = event({ id: 'kabuki', starts_on: '2026-08-10', ends_on: '2026-08-13' });
  const catalog: EventWithOccurrences[] = [
    {
      event: kabuki,
      occurrences: [
        occurrence({ id: 'o1', event_id: 'kabuki', starts_at: '2026-08-10T02:00:00Z' }),
        occurrence({ id: 'o2', event_id: 'kabuki', starts_at: '2026-08-13T02:00:00Z' }),
      ],
    },
  ];

  assert.deepEqual(
    selectEventLevelFallback(catalog, '2026-08-11').map((r) => r.event.id),
    ['kabuki'],
  );
  assert.deepEqual(
    selectEventLevelFallback(catalog, '2026-08-12').map((r) => r.event.id),
    ['kabuki'],
  );
  // 08-10/08-13 do have an actual occurrence: excluded here, covered by
  // selectDayOccurrences instead.
  assert.deepEqual(selectEventLevelFallback(catalog, '2026-08-10'), []);
  assert.deepEqual(selectEventLevelFallback(catalog, '2026-08-13'), []);
});

void test('selectEventLevelFallback: never fabricates an occurrence - a qualifying event still has zero occurrence evidence for the selected date', () => {
  const multi = event({ id: 'multi', starts_on: '2026-08-10', ends_on: '2026-08-13' });
  const catalog: EventWithOccurrences[] = [{ event: multi, occurrences: [] }];

  assert.deepEqual(selectDayOccurrences(catalog, '2026-08-11'), []);
  assert.equal(selectEventLevelFallback(catalog, '2026-08-11').length, 1);
});
