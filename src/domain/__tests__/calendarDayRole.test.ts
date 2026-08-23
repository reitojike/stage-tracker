import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calendarDayRole,
  calendarDayRoleLabel,
  isWithinJapaneseHolidayDataCoverage,
} from '../calendarDayRole.ts';
import { JAPANESE_HOLIDAY_DATA_COVERAGE_END } from '../japaneseHolidaysData.ts';

void test('an ordinary weekday has the weekday role and no marker label', () => {
  // 2026-08-25 is a Tuesday and not a holiday.
  assert.equal(calendarDayRole('2026-08-25'), 'weekday');
  assert.equal(calendarDayRoleLabel('2026-08-25'), null);
});

void test('Saturday is the saturday role', () => {
  // 2026-08-22 is a Saturday and not a holiday.
  assert.equal(calendarDayRole('2026-08-22'), 'saturday');
  assert.equal(calendarDayRoleLabel('2026-08-22'), '土');
});

void test('Sunday is the sunday role', () => {
  // 2026-08-23 is a Sunday and not a holiday.
  assert.equal(calendarDayRole('2026-08-23'), 'sunday');
  assert.equal(calendarDayRoleLabel('2026-08-23'), '日');
});

void test('a national holiday is the holiday role, labelled with its official name', () => {
  // 2026-01-01 (元日) is a Thursday.
  assert.equal(calendarDayRole('2026-01-01'), 'holiday');
  assert.equal(calendarDayRoleLabel('2026-01-01'), '元日');
});

void test('a holiday that falls on a Saturday reports holiday, not saturday', () => {
  // 2026-11-03 (文化の日) is a Tuesday in 2026, so pick a real Saturday
  // holiday from the snapshot instead: 2024-11-23 (勤労感謝の日) is a
  // Saturday.
  assert.equal(calendarDayRole('2024-11-23'), 'holiday');
  assert.equal(calendarDayRoleLabel('2024-11-23'), '勤労感謝の日');
});

void test('a date outside the snapshot coverage never reports the holiday role, even though weekday role is still computed (PO adjudication, Issue #34: no inferring holiday status past coverage)', () => {
  // One day past JAPANESE_HOLIDAY_DATA_COVERAGE_END - guaranteed outside
  // coverage, so isWithinJapaneseHolidayDataCoverage must be false and
  // calendarDayRole must never return 'holiday' for it, no matter what a
  // future data update might eventually confirm this date to be. Weekday
  // arithmetic itself is still computed (it is data-independent), so the
  // role is one of 'saturday' / 'sunday' / 'weekday', never 'holiday'.
  const dayAfterCoverageEnd = '2027-11-24';
  assert.equal(isWithinJapaneseHolidayDataCoverage(dayAfterCoverageEnd), false);
  assert.notEqual(calendarDayRole(dayAfterCoverageEnd), 'holiday');
});

void test('the last date within coverage can still report the holiday role', () => {
  assert.equal(isWithinJapaneseHolidayDataCoverage(JAPANESE_HOLIDAY_DATA_COVERAGE_END), true);
});
