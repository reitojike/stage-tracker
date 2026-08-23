import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  JAPANESE_HOLIDAY_DATA_COVERAGE_END,
  JAPANESE_HOLIDAY_DATA_COVERAGE_START,
  isJapaneseHoliday,
  isWithinJapaneseHolidayDataCoverage,
  japaneseHolidayName,
} from '../japaneseHolidays.ts';

void test('japaneseHolidayName returns the official name for a known holiday', () => {
  assert.equal(japaneseHolidayName('2026-01-01'), '元日');
});

void test('isJapaneseHoliday is true for a known holiday and false for an ordinary day', () => {
  assert.equal(isJapaneseHoliday('2026-01-01'), true);
  assert.equal(isJapaneseHoliday('2026-01-02'), false);
});

void test('japaneseHolidayName returns null for a non-holiday date', () => {
  assert.equal(japaneseHolidayName('2026-01-02'), null);
});

void test('a date far past the snapshot coverage is not fabricated as a holiday', () => {
  const farFuture = '2999-01-01';
  assert.equal(isWithinJapaneseHolidayDataCoverage(farFuture), false);
  assert.equal(isJapaneseHoliday(farFuture), false);
});

void test('the snapshot coverage range is non-empty and internally consistent', () => {
  assert.equal(isWithinJapaneseHolidayDataCoverage(JAPANESE_HOLIDAY_DATA_COVERAGE_START), true);
  assert.equal(isWithinJapaneseHolidayDataCoverage(JAPANESE_HOLIDAY_DATA_COVERAGE_END), true);
});
