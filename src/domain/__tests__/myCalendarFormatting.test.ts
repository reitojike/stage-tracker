import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  myCalendarMonthDayLabel,
  myCalendarScheduleTemporalLabel,
  participationStatusLabel,
} from '../myCalendarFormatting.ts';

void test('participationStatusLabel', () => {
  assert.equal(participationStatusLabel('attending'), '参加する');
  assert.equal(participationStatusLabel('considering'), '気になる');
});

// --- Issue #196: myCalendarMonthDayLabel / myCalendarScheduleTemporalLabel ---

void test('myCalendarMonthDayLabel renders bare month/day, no year, no weekday', () => {
  assert.equal(myCalendarMonthDayLabel('2026-09-11'), '9月11日');
});

void test('myCalendarScheduleTemporalLabel leaves a single-day all-day entry unchanged', () => {
  const label = myCalendarScheduleTemporalLabel({
    kind: 'all-day',
    startsOn: '2026-09-11',
    endsOn: '2026-09-11',
  });
  assert.equal(label, '2026年9月11日');
});

void test('myCalendarScheduleTemporalLabel compacts a same-year, same-month all-day range', () => {
  const label = myCalendarScheduleTemporalLabel({
    kind: 'all-day',
    startsOn: '2026-09-11',
    endsOn: '2026-09-13',
  });
  assert.equal(label, '9月11日〜13日');
});

void test('myCalendarScheduleTemporalLabel compacts a same-year, cross-month all-day range (keeps both months)', () => {
  const label = myCalendarScheduleTemporalLabel({
    kind: 'all-day',
    startsOn: '2026-09-28',
    endsOn: '2026-10-03',
  });
  assert.equal(label, '9月28日〜10月3日');
});

void test('myCalendarScheduleTemporalLabel keeps the full year on both sides when an all-day range crosses a year boundary', () => {
  const label = myCalendarScheduleTemporalLabel({
    kind: 'all-day',
    startsOn: '2025-12-30',
    endsOn: '2026-01-02',
  });
  assert.equal(label, '2025年12月30日〜2026年1月2日');
});

void test('myCalendarScheduleTemporalLabel leaves a same-day time-bounded entry unchanged', () => {
  const label = myCalendarScheduleTemporalLabel({
    kind: 'time-bounded',
    startsAt: '2026-03-01T00:00:00.000Z',
    endsAt: '2026-03-01T09:00:00.000Z',
  });
  assert.equal(label, '2026年3月1日 09:00〜18:00');
});

void test('myCalendarScheduleTemporalLabel leaves an unset-end time-bounded entry unchanged', () => {
  const label = myCalendarScheduleTemporalLabel({
    kind: 'time-bounded',
    startsAt: '2026-03-01T00:00:00.000Z',
    endsAt: null,
  });
  assert.equal(label, '2026年3月1日 09:00〜（終了時刻未定）');
});

void test('myCalendarScheduleTemporalLabel compacts a same-year time-bounded range that spans days, keeping both times', () => {
  // Tokyo 23:00 on 3/1 -> 14:00Z on 3/1; Tokyo 01:00 on 3/2 -> 16:00Z on 3/1.
  const label = myCalendarScheduleTemporalLabel({
    kind: 'time-bounded',
    startsAt: '2026-03-01T14:00:00.000Z',
    endsAt: '2026-03-01T16:00:00.000Z',
  });
  assert.equal(label, '3月1日 23:00〜3月2日 01:00');
});

void test('myCalendarScheduleTemporalLabel keeps the full year on both sides when a time-bounded range crosses a year boundary', () => {
  // Tokyo 23:00 on 12/31 -> 14:00Z on 12/31; Tokyo 01:00 on 1/1 -> 16:00Z on 12/31.
  const label = myCalendarScheduleTemporalLabel({
    kind: 'time-bounded',
    startsAt: '2025-12-31T14:00:00.000Z',
    endsAt: '2025-12-31T16:00:00.000Z',
  });
  assert.equal(label, '2025年12月31日 23:00〜2026年1月1日 01:00');
});
