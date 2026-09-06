import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  catalogDayHref,
  catalogEventHref,
  catalogEventHrefWithoutContext,
  catalogMonthHref,
  explicitCatalogParams,
  nextYearMonth,
  occurrenceAnchorId,
  occurrenceEventDetailHref,
  previousYearMonth,
  resolveCatalogParams,
  resolveFocusedOccurrenceId,
  searchParamsToRecord,
} from '../catalogNavigation.ts';

const TODAY = '2026-08-21';

void test('resolveCatalogParams: no params default to the current Tokyo month, no day selected', () => {
  assert.deepEqual(resolveCatalogParams({}, TODAY), { yearMonth: '2026-08', selectedDate: null });
});

void test('resolveCatalogParams: a valid month param is used as-is', () => {
  assert.deepEqual(resolveCatalogParams({ month: '2026-12' }, TODAY), {
    yearMonth: '2026-12',
    selectedDate: null,
  });
});

void test('resolveCatalogParams: a valid date param selects that day', () => {
  assert.deepEqual(resolveCatalogParams({ month: '2026-08', date: '2026-08-10' }, TODAY), {
    yearMonth: '2026-08',
    selectedDate: '2026-08-10',
  });
});

void test('resolveCatalogParams: date always wins the displayed month over a disagreeing month param', () => {
  assert.deepEqual(resolveCatalogParams({ month: '2026-08', date: '2026-09-05' }, TODAY), {
    yearMonth: '2026-09',
    selectedDate: '2026-09-05',
  });
});

void test('resolveCatalogParams: malformed month/date params are ignored, not surfaced as an error', () => {
  assert.deepEqual(resolveCatalogParams({ month: 'not-a-month', date: 'not-a-date' }, TODAY), {
    yearMonth: '2026-08',
    selectedDate: null,
  });
});

void test('resolveCatalogParams: a calendar-invalid but shape-valid month (e.g. month 13) is ignored, not accepted', () => {
  assert.deepEqual(resolveCatalogParams({ month: '2026-13' }, TODAY), {
    yearMonth: '2026-08',
    selectedDate: null,
  });
});

void test('resolveCatalogParams: a calendar-invalid but shape-valid date (e.g. Feb 30) is ignored, not accepted', () => {
  assert.deepEqual(resolveCatalogParams({ month: '2026-02', date: '2026-02-30' }, TODAY), {
    yearMonth: '2026-02',
    selectedDate: null,
  });
});

void test('resolveCatalogParams: an array-valued query param uses its first entry', () => {
  assert.deepEqual(resolveCatalogParams({ month: ['2026-12', '2027-01'] }, TODAY), {
    yearMonth: '2026-12',
    selectedDate: null,
  });
});

void test('searchParamsToRecord: a single-valued key becomes a plain string, matching a bare query param', () => {
  assert.deepEqual(searchParamsToRecord(new URLSearchParams('month=2026-12&date=2026-12-05')), {
    month: '2026-12',
    date: '2026-12-05',
  });
});

void test('searchParamsToRecord: a repeated key becomes an array, matching Next.js searchParams for a repeated param', () => {
  assert.deepEqual(searchParamsToRecord(new URLSearchParams('month=2026-12&month=2027-01')), {
    month: ['2026-12', '2027-01'],
  });
});

void test('searchParamsToRecord: an empty URLSearchParams becomes an empty record', () => {
  assert.deepEqual(searchParamsToRecord(new URLSearchParams()), {});
});

void test('searchParamsToRecord output feeds resolveCatalogParams unchanged, the same as a plain Next.js searchParams prop', () => {
  const record = searchParamsToRecord(new URLSearchParams('date=2026-08-10'));
  assert.deepEqual(resolveCatalogParams(record, TODAY), {
    yearMonth: '2026-08',
    selectedDate: '2026-08-10',
  });
});

void test('explicitCatalogParams: no params resolves to null, not a guessed "today" (Issue #355, PR #363 review)', () => {
  // A caller (e.g. a Client Component loading.tsx) that must not resolve
  // "today" itself gets null here and defers to the real destination's own
  // server-side default instead - see this route's own loading.tsx.
  assert.equal(explicitCatalogParams({}), null);
});

void test('explicitCatalogParams: malformed month/date also resolves to null, same as missing', () => {
  assert.equal(explicitCatalogParams({ month: 'not-a-month', date: 'not-a-date' }), null);
});

void test('explicitCatalogParams: a valid month param resolves without needing a "today" seed', () => {
  assert.deepEqual(explicitCatalogParams({ month: '2026-12' }), {
    yearMonth: '2026-12',
    selectedDate: null,
  });
});

void test('explicitCatalogParams: a valid date param resolves the day and its month', () => {
  assert.deepEqual(explicitCatalogParams({ date: '2026-08-10' }), {
    yearMonth: '2026-08',
    selectedDate: '2026-08-10',
  });
});

void test('explicitCatalogParams: date always wins the displayed month over a disagreeing month param', () => {
  assert.deepEqual(explicitCatalogParams({ month: '2026-08', date: '2026-09-05' }), {
    yearMonth: '2026-09',
    selectedDate: '2026-09-05',
  });
});

void test('resolveCatalogParams and explicitCatalogParams agree on every explicit-context case, differing only on the "no context" default', () => {
  const cases = [
    {},
    { month: '2026-12' },
    { date: '2026-08-10' },
    { month: '2026-08', date: '2026-09-05' },
    { month: 'not-a-month', date: 'not-a-date' },
    { month: '2026-13' },
  ];
  for (const params of cases) {
    const explicit = explicitCatalogParams(params);
    const resolved = resolveCatalogParams(params, TODAY);
    if (explicit === null) {
      assert.deepEqual(resolved, { yearMonth: TODAY.slice(0, 7), selectedDate: null });
    } else {
      assert.deepEqual(resolved, explicit);
    }
  }
});

void test('catalogEventHrefWithoutContext: the event detail page with no query string at all', () => {
  assert.equal(catalogEventHrefWithoutContext('event-1'), '/catalog/events/event-1');
});

void test('nextYearMonth / previousYearMonth: wrap across a year boundary', () => {
  assert.equal(nextYearMonth('2026-12'), '2027-01');
  assert.equal(previousYearMonth('2027-01'), '2026-12');
});

void test('nextYearMonth / previousYearMonth: round-trip within a year', () => {
  assert.equal(nextYearMonth('2026-08'), '2026-09');
  assert.equal(previousYearMonth('2026-08'), '2026-07');
});

void test('catalogMonthHref / catalogDayHref: build the expected query strings', () => {
  assert.equal(catalogMonthHref('2026-08'), '/catalog?month=2026-08');
  assert.equal(catalogDayHref('2026-08', '2026-08-10'), '/catalog?month=2026-08&date=2026-08-10');
});

void test('catalogEventHref: carries month, and date only when a day is selected', () => {
  assert.equal(
    catalogEventHref('event-1', { yearMonth: '2026-08', selectedDate: null }),
    '/catalog/events/event-1?month=2026-08',
  );
  assert.equal(
    catalogEventHref('event-1', { yearMonth: '2026-08', selectedDate: '2026-08-10' }),
    '/catalog/events/event-1?month=2026-08&date=2026-08-10',
  );
});

void test('catalogEventHref: an occurrenceId is carried as an occurrence param plus a matching hash fragment', () => {
  assert.equal(
    catalogEventHref('event-1', { yearMonth: '2026-08', selectedDate: '2026-08-10' }, 'occ-1'),
    '/catalog/events/event-1?month=2026-08&date=2026-08-10&occurrence=occ-1#occurrence-occ-1',
  );
});

void test('catalogEventHref: an omitted or null occurrenceId adds no occurrence param or hash fragment', () => {
  assert.equal(
    catalogEventHref('event-1', { yearMonth: '2026-08', selectedDate: null }),
    '/catalog/events/event-1?month=2026-08',
  );
  assert.equal(
    catalogEventHref('event-1', { yearMonth: '2026-08', selectedDate: null }, null),
    '/catalog/events/event-1?month=2026-08',
  );
});

void test("resolveFocusedOccurrenceId: a param matching one of the event's occurrences is used", () => {
  assert.equal(resolveFocusedOccurrenceId('occ-2', ['occ-1', 'occ-2', 'occ-3']), 'occ-2');
});

void test('resolveFocusedOccurrenceId: a missing param resolves to null (generic detail)', () => {
  assert.equal(resolveFocusedOccurrenceId(undefined, ['occ-1', 'occ-2']), null);
});

void test("resolveFocusedOccurrenceId: a foreign/stale id not among the event's occurrences resolves to null, never the wrong occurrence", () => {
  assert.equal(resolveFocusedOccurrenceId('occ-from-another-event', ['occ-1', 'occ-2']), null);
});

void test('resolveFocusedOccurrenceId: no occurrences on the event resolves to null', () => {
  assert.equal(resolveFocusedOccurrenceId('occ-1', []), null);
});

void test('resolveFocusedOccurrenceId: an array-valued param uses its first entry, same as resolveCatalogParams', () => {
  assert.equal(resolveFocusedOccurrenceId(['occ-1', 'occ-2'], ['occ-1', 'occ-2']), 'occ-1');
});

void test('occurrenceAnchorId: prefixes the occurrence id for use as a DOM/CSS id', () => {
  assert.equal(occurrenceAnchorId('3fa85f64-abcd'), 'occurrence-3fa85f64-abcd');
});

void test('occurrenceEventDetailHref: derives yearMonth/selectedDate from the occurrence startsAt and carries the occurrence anchor (Issue #194: shared by Home upcoming rows and deadline cards)', () => {
  assert.equal(
    occurrenceEventDetailHref('event-1', 'occ-1', '2026-09-03T09:00:00.000Z'),
    '/catalog/events/event-1?month=2026-09&date=2026-09-03&occurrence=occ-1#occurrence-occ-1',
  );
});
