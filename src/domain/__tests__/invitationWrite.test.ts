import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseInviteeEmail } from '../invitationWrite.ts';

void test('parseInviteeEmail accepts a well-formed email and lowercases/trims it', () => {
  const result = parseInviteeEmail('  User@Example.com  ');
  assert.deepEqual(result, { ok: true, email: 'user@example.com' });
});

void test('parseInviteeEmail rejects an empty string', () => {
  const result = parseInviteeEmail('   ');
  assert.equal(result.ok, false);
});

void test('parseInviteeEmail rejects a value with no @', () => {
  const result = parseInviteeEmail('not-an-email');
  assert.equal(result.ok, false);
});

void test('parseInviteeEmail rejects a value with no domain dot', () => {
  const result = parseInviteeEmail('user@example');
  assert.equal(result.ok, false);
});

void test('parseInviteeEmail rejects a value containing whitespace', () => {
  const result = parseInviteeEmail('user name@example.com');
  assert.equal(result.ok, false);
});
