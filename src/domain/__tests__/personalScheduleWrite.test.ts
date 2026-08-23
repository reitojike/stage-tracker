import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parsePersonalScheduleEntry,
  personalScheduleEntryToFormValues,
  type RawFormValues,
} from '../personalScheduleWrite.ts';

function allDayValues(overrides: RawFormValues = {}): RawFormValues {
  return {
    scheduleType: 'other',
    temporalMode: 'all-day',
    startsOn: '2026-03-01',
    endsOn: '',
    startsAt: '',
    endsAt: '',
    memo: '',
    ...overrides,
  };
}

function timeBoundedValues(overrides: RawFormValues = {}): RawFormValues {
  return {
    scheduleType: 'work',
    temporalMode: 'time-bounded',
    startsOn: '',
    endsOn: '',
    startsAt: '2026-03-01T09:00',
    endsAt: '2026-03-01T18:00',
    memo: '',
    ...overrides,
  };
}

void test('parsePersonalScheduleEntry parses a single-day all-day entry, defaulting endsOn to startsOn', () => {
  const result = parsePersonalScheduleEntry(allDayValues());
  assert.ok(result.ok);
  assert.deepEqual(result.value.temporal, {
    kind: 'all-day',
    startsOn: '2026-03-01',
    endsOn: '2026-03-01',
  });
  assert.equal(result.value.scheduleType, 'other');
  assert.equal(result.value.memo, null);
});

void test('parsePersonalScheduleEntry parses a multi-day all-day entry', () => {
  const result = parsePersonalScheduleEntry(allDayValues({ endsOn: '2026-03-05' }));
  assert.ok(result.ok);
  assert.deepEqual(result.value.temporal, {
    kind: 'all-day',
    startsOn: '2026-03-01',
    endsOn: '2026-03-05',
  });
});

void test('parsePersonalScheduleEntry rejects an all-day entry ending before it starts', () => {
  const result = parsePersonalScheduleEntry(allDayValues({ endsOn: '2026-02-01' }));
  assert.ok(!result.ok);
  assert.equal(result.fieldErrors.endsOn, '終了日は開始日より前にできません。');
});

void test('parsePersonalScheduleEntry rejects a missing startsOn for an all-day entry', () => {
  const result = parsePersonalScheduleEntry(allDayValues({ startsOn: '' }));
  assert.ok(!result.ok);
  assert.equal(result.fieldErrors.startsOn, '開始日を入力してください。');
});

void test('parsePersonalScheduleEntry rejects a malformed startsOn', () => {
  const result = parsePersonalScheduleEntry(allDayValues({ startsOn: '2026-02-30' }));
  assert.ok(!result.ok);
});

void test('parsePersonalScheduleEntry parses a time-bounded entry with a known end', () => {
  const result = parsePersonalScheduleEntry(timeBoundedValues());
  assert.ok(result.ok);
  assert.deepEqual(result.value.temporal, {
    kind: 'time-bounded',
    startsAt: '2026-03-01T00:00:00.000Z',
    endsAt: '2026-03-01T09:00:00.000Z',
  });
});

void test('parsePersonalScheduleEntry accepts an unset end time for a time-bounded entry', () => {
  const result = parsePersonalScheduleEntry(timeBoundedValues({ endsAt: '' }));
  assert.ok(result.ok);
  assert.deepEqual(result.value.temporal, {
    kind: 'time-bounded',
    startsAt: '2026-03-01T00:00:00.000Z',
    endsAt: null,
  });
});

void test('parsePersonalScheduleEntry rejects a missing startsAt for a time-bounded entry', () => {
  const result = parsePersonalScheduleEntry(timeBoundedValues({ startsAt: '' }));
  assert.ok(!result.ok);
  assert.equal(result.fieldErrors.startsAt, '開始日時を入力してください。');
});

void test('parsePersonalScheduleEntry rejects a time-bounded entry ending before it starts', () => {
  const result = parsePersonalScheduleEntry(
    timeBoundedValues({ startsAt: '2026-03-01T18:00', endsAt: '2026-03-01T09:00' }),
  );
  assert.ok(!result.ok);
  assert.equal(result.fieldErrors.endsAt, '終了日時は開始日時より前にできません。');
});

void test('parsePersonalScheduleEntry rejects an unrecognized scheduleType', () => {
  const result = parsePersonalScheduleEntry(allDayValues({ scheduleType: 'holiday' }));
  assert.ok(!result.ok);
  assert.equal(result.fieldErrors.scheduleType, '種別を選択してください。');
});

void test('parsePersonalScheduleEntry trims memo and maps blank to null', () => {
  const withMemo = parsePersonalScheduleEntry(allDayValues({ memo: '  trip notes  ' }));
  assert.ok(withMemo.ok);
  assert.equal(withMemo.value.memo, 'trip notes');

  const blankMemo = parsePersonalScheduleEntry(allDayValues({ memo: '   ' }));
  assert.ok(blankMemo.ok);
  assert.equal(blankMemo.value.memo, null);
});

void test('personalScheduleEntryToFormValues round-trips an all-day entry', () => {
  const parsed = parsePersonalScheduleEntry(allDayValues({ endsOn: '2026-03-05', memo: 'trip' }));
  assert.ok(parsed.ok);
  const values = personalScheduleEntryToFormValues(parsed.value);
  assert.equal(values.temporalMode, 'all-day');
  assert.equal(values.startsOn, '2026-03-01');
  assert.equal(values.endsOn, '2026-03-05');
  assert.equal(values.startsAt, '');
  assert.equal(values.endsAt, '');
  assert.equal(values.memo, 'trip');
});

void test('personalScheduleEntryToFormValues round-trips a time-bounded entry with an unset end', () => {
  const parsed = parsePersonalScheduleEntry(timeBoundedValues({ endsAt: '' }));
  assert.ok(parsed.ok);
  const values = personalScheduleEntryToFormValues(parsed.value);
  assert.equal(values.temporalMode, 'time-bounded');
  assert.equal(values.startsAt, '2026-03-01T09:00');
  assert.equal(values.endsAt, '');
});
