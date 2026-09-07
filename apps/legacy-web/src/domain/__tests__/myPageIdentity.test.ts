import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveMyPageInitial } from '../myPageIdentity.ts';

void test('resolveMyPageInitial uppercases the first character of the email', () => {
  assert.equal(resolveMyPageInitial('sakura@example.com'), 'S');
});

void test('resolveMyPageInitial returns undefined for null (no identity resolved)', () => {
  assert.equal(resolveMyPageInitial(null), undefined);
});

void test('resolveMyPageInitial returns undefined for an empty string', () => {
  assert.equal(resolveMyPageInitial(''), undefined);
});
