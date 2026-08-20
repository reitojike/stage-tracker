import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatGreeting } from '../greeting.ts';

void test('formatGreeting greets a trimmed name', () => {
  assert.equal(formatGreeting('  stage-tracker  '), 'Hello, stage-tracker!');
});

void test('formatGreeting falls back for an empty name', () => {
  assert.equal(formatGreeting('   '), 'Hello!');
});
