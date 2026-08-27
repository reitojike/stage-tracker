import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveTriState, nextTriState } from '../triState.ts';

void test('nextTriState: checked -> unchecked', () => {
  assert.equal(nextTriState('checked'), 'unchecked');
});

void test('nextTriState: unchecked -> checked', () => {
  assert.equal(nextTriState('unchecked'), 'checked');
});

void test('nextTriState: indeterminate -> checked (Issue #139: 中間状態のタップは checked へ)', () => {
  assert.equal(nextTriState('indeterminate'), 'checked');
});

void test('deriveTriState: all children checked -> checked', () => {
  assert.equal(deriveTriState(['checked', 'checked']), 'checked');
});

void test('deriveTriState: all children unchecked -> unchecked', () => {
  assert.equal(deriveTriState(['unchecked', 'unchecked']), 'unchecked');
});

void test('deriveTriState: no children -> unchecked', () => {
  assert.equal(deriveTriState([]), 'unchecked');
});

void test('deriveTriState: mixed checked/unchecked -> indeterminate', () => {
  assert.equal(deriveTriState(['checked', 'unchecked']), 'indeterminate');
});

void test('deriveTriState: a single indeterminate child forces the parent indeterminate', () => {
  assert.equal(deriveTriState(['checked', 'indeterminate']), 'indeterminate');
  assert.equal(deriveTriState(['indeterminate']), 'indeterminate');
});
