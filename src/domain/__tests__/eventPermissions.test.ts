import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canCreateEvent, canReadEventCatalog, canUpdateEvent } from '../eventPermissions.ts';

void test('canReadEventCatalog allows authenticated users', () => {
  assert.equal(canReadEventCatalog('user-a'), true);
});

void test('canReadEventCatalog denies anonymous callers', () => {
  assert.equal(canReadEventCatalog(null), false);
});

void test('canCreateEvent allows an actor to create their own event', () => {
  assert.equal(canCreateEvent('user-a', 'user-a'), true);
});

void test('canCreateEvent denies owner spoofing', () => {
  assert.equal(canCreateEvent('user-a', 'user-b'), false);
});

void test('canCreateEvent denies anonymous callers', () => {
  assert.equal(canCreateEvent(null, 'user-a'), false);
});

void test('canUpdateEvent allows the owner to update without changing ownership', () => {
  assert.equal(canUpdateEvent('user-a', { ownerId: 'user-a' }, 'user-a'), true);
});

void test('canUpdateEvent denies a non-owner', () => {
  assert.equal(canUpdateEvent('user-b', { ownerId: 'user-a' }, 'user-a'), false);
});

void test('canUpdateEvent denies the owner transferring ownership', () => {
  assert.equal(canUpdateEvent('user-a', { ownerId: 'user-a' }, 'user-b'), false);
});

void test('canUpdateEvent denies anonymous callers', () => {
  assert.equal(canUpdateEvent(null, { ownerId: 'user-a' }, 'user-a'), false);
});
