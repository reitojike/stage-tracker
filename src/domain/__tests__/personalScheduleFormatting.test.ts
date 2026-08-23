import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scheduleTemporalLabel, scheduleTypeLabel } from '../personalScheduleFormatting.ts';

void test('scheduleTypeLabel labels every MVP schedule type', () => {
  assert.equal(scheduleTypeLabel('paid_leave'), '有給休暇');
  assert.equal(scheduleTypeLabel('work'), '仕事');
  assert.equal(scheduleTypeLabel('travel'), '遠征');
  assert.equal(scheduleTypeLabel('other'), 'その他');
});

void test('scheduleTemporalLabel formats a single-day all-day entry without a range dash', () => {
  const label = scheduleTemporalLabel({
    kind: 'all-day',
    startsOn: '2026-03-01',
    endsOn: '2026-03-01',
  });
  assert.equal(label, '2026年3月1日');
});

void test('scheduleTemporalLabel formats a multi-day all-day entry as a range', () => {
  const label = scheduleTemporalLabel({
    kind: 'all-day',
    startsOn: '2026-03-01',
    endsOn: '2026-03-05',
  });
  assert.equal(label, '2026年3月1日〜2026年3月5日');
});

void test('scheduleTemporalLabel formats a time-bounded entry with a known end', () => {
  const label = scheduleTemporalLabel({
    kind: 'time-bounded',
    startsAt: '2026-03-01T00:00:00.000Z',
    endsAt: '2026-03-01T09:00:00.000Z',
  });
  assert.equal(label, '2026年3月1日 09:00〜18:00');
});

void test('scheduleTemporalLabel formats a time-bounded entry with an unset end', () => {
  const label = scheduleTemporalLabel({
    kind: 'time-bounded',
    startsAt: '2026-03-01T00:00:00.000Z',
    endsAt: null,
  });
  assert.equal(label, '2026年3月1日 09:00〜（終了時刻未定）');
});
