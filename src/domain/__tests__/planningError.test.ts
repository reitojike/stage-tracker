import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyPostgrestError, classifyRpcError } from '../planningError.ts';

// Pure domain-level tests for the shared error/result vocabulary (Issue
// #33). classifyPostgrestError is exercised directly here with plain
// fixture error shapes; the real wiring (a genuine Postgrest/RPC error from
// local Supabase) is verified in test/rls/typedBoundary*.test.ts.

void test('classifyPostgrestError maps 42501 to permission-denied', () => {
  const result = classifyPostgrestError({ message: 'permission denied', code: '42501' });
  assert.equal(result.kind, 'permission-denied');
  assert.equal(result.code, '42501');
});

void test('classifyPostgrestError maps constraint violations to validation', () => {
  for (const code of ['23502', '23503', '23505', '23514', '22007', '22008', '22P02']) {
    const result = classifyPostgrestError({ message: 'bad input', code });
    assert.equal(result.kind, 'validation', `expected ${code} to classify as validation`);
  }
});

void test('classifyPostgrestError falls back to failure for unrecognized codes', () => {
  const result = classifyPostgrestError({ message: 'something else broke', code: '55000' });
  assert.equal(result.kind, 'failure');
});

void test('classifyRpcError matches the first rule whose test passes', () => {
  const result = classifyRpcError({ message: 'transfer not found', code: 'P0001' }, [
    { test: (m) => m.includes('not found'), kind: 'not-found' },
    { test: () => true, kind: 'failure' },
  ]);
  assert.equal(result.kind, 'not-found');
});

void test('classifyRpcError falls back to classifyPostgrestError when no rule matches', () => {
  const result = classifyRpcError({ message: 'permission denied', code: '42501' }, [
    { test: (m) => m.includes('not found'), kind: 'not-found' },
  ]);
  assert.equal(result.kind, 'permission-denied');
});
