import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveCatalogReadState } from '../catalogReadState.ts';
import type { EventCatalogReadResult } from '../eventCatalog.ts';

const isEmptyArray = (data: readonly unknown[]) => data.length === 0;

void test('resolveCatalogReadState: a read failure is "error", never "empty"', () => {
  const failed: EventCatalogReadResult<unknown[]> = {
    ok: false,
    error: { message: 'permission denied', code: '42501' },
  };
  assert.equal(resolveCatalogReadState(failed, isEmptyArray), 'error');
});

void test('resolveCatalogReadState: a successful read with no rows is "empty"', () => {
  const ok: EventCatalogReadResult<unknown[]> = { ok: true, data: [] };
  assert.equal(resolveCatalogReadState(ok, isEmptyArray), 'empty');
});

void test('resolveCatalogReadState: a successful read with rows is "populated"', () => {
  const ok: EventCatalogReadResult<unknown[]> = { ok: true, data: [{}] };
  assert.equal(resolveCatalogReadState(ok, isEmptyArray), 'populated');
});

void test('resolveCatalogReadState: "error" and "empty" are never conflated for the same failed result', () => {
  const failed: EventCatalogReadResult<unknown[]> = {
    ok: false,
    error: { message: 'x', code: 'y' },
  };
  // Even an isEmpty predicate that would call an ok:true empty array
  // "empty" must not run at all on a failure - the branch is decided by
  // `ok` first.
  assert.equal(
    resolveCatalogReadState(failed, () => true),
    'error',
  );
});
