import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  catalogDayHref,
  catalogEventHref,
  catalogMonthHref,
  nextYearMonth,
  previousYearMonth,
  resolveCatalogParams,
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

void test('resolveCatalogParams: an array-valued query param uses its first entry', () => {
  assert.deepEqual(resolveCatalogParams({ month: ['2026-12', '2027-01'] }, TODAY), {
    yearMonth: '2026-12',
    selectedDate: null,
  });
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
