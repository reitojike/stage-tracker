import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePersonalScheduleReadState } from '../personalScheduleReadState.ts';
import type { PlanningResult } from '../planningError.ts';

const isEmptyArray = (data: unknown[]) => data.length === 0;

void test('resolvePersonalScheduleReadState classifies a failed read as error, never empty', () => {
  const result: PlanningResult<unknown[]> = {
    ok: false,
    error: { kind: 'failure', message: 'boom', code: 'XX000' },
  };
  assert.equal(resolvePersonalScheduleReadState(result, isEmptyArray), 'error');
});

void test('resolvePersonalScheduleReadState classifies a successful empty read as empty', () => {
  const result: PlanningResult<unknown[]> = { ok: true, data: [] };
  assert.equal(resolvePersonalScheduleReadState(result, isEmptyArray), 'empty');
});

void test('resolvePersonalScheduleReadState classifies a successful non-empty read as populated', () => {
  const result: PlanningResult<unknown[]> = { ok: true, data: [{}] };
  assert.equal(resolvePersonalScheduleReadState(result, isEmptyArray), 'populated');
});
