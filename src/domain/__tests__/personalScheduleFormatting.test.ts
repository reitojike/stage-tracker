import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scheduleTemporalLabel } from '../personalScheduleFormatting.ts';

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

void test('scheduleTemporalLabel shows the end date when the end crosses into the next Tokyo calendar day', () => {
  // Tokyo 23:00 on 3/1 -> 14:00Z on 3/1; Tokyo 01:00 on 3/2 -> 16:00Z on 3/1.
  // Rendering the end time alone ("23:00〜01:00") would read as same-day
  // and backwards - this must show the end's own date instead.
  const label = scheduleTemporalLabel({
    kind: 'time-bounded',
    startsAt: '2026-03-01T14:00:00.000Z',
    endsAt: '2026-03-01T16:00:00.000Z',
  });
  assert.equal(label, '2026年3月1日 23:00〜2026年3月2日 01:00');
});

void test('scheduleTemporalLabel shows the end date across a multi-day span, not just "next day"', () => {
  // A personal schedule entry (unlike a single performance) can span more
  // than one extra day - this must not assume "at most one day ahead".
  const label = scheduleTemporalLabel({
    kind: 'time-bounded',
    startsAt: '2026-03-01T01:00:00.000Z', // 2026-03-01 10:00 JST
    endsAt: '2026-03-05T01:00:00.000Z', // 2026-03-05 10:00 JST
  });
  assert.equal(label, '2026年3月1日 10:00〜2026年3月5日 10:00');
});
