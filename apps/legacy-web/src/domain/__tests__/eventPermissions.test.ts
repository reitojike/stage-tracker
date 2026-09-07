import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canCancelEvent,
  canCancelEventOccurrence,
  canCreateEvent,
  canCreateEventOccurrence,
  canDeleteEvent,
  canDeleteEventOccurrence,
  canReadEventCatalog,
  canUpdateEvent,
  canUpdateEventOccurrence,
} from '../eventPermissions.ts';

const CREATOR = { isDesignatedCatalogCreator: true };
const NOT_CREATOR = { isDesignatedCatalogCreator: false };

void test('canReadEventCatalog allows authenticated users', () => {
  assert.equal(canReadEventCatalog('user-a'), true);
});

void test('canReadEventCatalog denies anonymous callers', () => {
  assert.equal(canReadEventCatalog(null), false);
});

// Shared catalog read stays open to every authenticated user - designated
// creator membership restricts writing, never reading.
void test('canReadEventCatalog does not depend on designated creator membership', () => {
  assert.equal(canReadEventCatalog('user-without-creator-membership'), true);
});

void test('canCreateEvent allows a designated creator to create their own event', () => {
  assert.equal(canCreateEvent('user-a', 'user-a', CREATOR), true);
});

void test('canCreateEvent denies an authenticated user who is not a designated creator', () => {
  assert.equal(canCreateEvent('user-a', 'user-a', NOT_CREATOR), false);
});

// Membership is not a licence to create events for other people: the
// owner-spoofing rule still applies to a designated creator.
void test('canCreateEvent denies owner spoofing even by a designated creator', () => {
  assert.equal(canCreateEvent('user-a', 'user-b', CREATOR), false);
});

void test('canCreateEvent denies owner spoofing by a non-creator', () => {
  assert.equal(canCreateEvent('user-a', 'user-b', NOT_CREATOR), false);
});

void test('canCreateEvent denies anonymous callers', () => {
  assert.equal(canCreateEvent(null, 'user-a', CREATOR), false);
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

void test('canCreateEventOccurrence allows the parent event owner', () => {
  assert.equal(canCreateEventOccurrence('user-a', { ownerId: 'user-a' }), true);
});

void test('canCreateEventOccurrence denies a non-owner', () => {
  assert.equal(canCreateEventOccurrence('user-b', { ownerId: 'user-a' }), false);
});

void test('canCreateEventOccurrence denies anonymous callers', () => {
  assert.equal(canCreateEventOccurrence(null, { ownerId: 'user-a' }), false);
});

void test('canUpdateEventOccurrence allows the parent event owner', () => {
  assert.equal(
    canUpdateEventOccurrence(
      'user-a',
      { ownerId: 'user-a' },
      { currentEventId: 'event-1', nextEventId: 'event-1' },
    ),
    true,
  );
});

void test('canUpdateEventOccurrence denies a non-owner', () => {
  assert.equal(
    canUpdateEventOccurrence(
      'user-b',
      { ownerId: 'user-a' },
      { currentEventId: 'event-1', nextEventId: 'event-1' },
    ),
    false,
  );
});

void test('canUpdateEventOccurrence denies reassigning an occurrence to another event', () => {
  assert.equal(
    canUpdateEventOccurrence(
      'user-a',
      { ownerId: 'user-a' },
      { currentEventId: 'event-1', nextEventId: 'event-2' },
    ),
    false,
  );
});

void test('canUpdateEventOccurrence denies anonymous callers', () => {
  assert.equal(
    canUpdateEventOccurrence(
      null,
      { ownerId: 'user-a' },
      { currentEventId: 'event-1', nextEventId: 'event-1' },
    ),
    false,
  );
});

void test('canDeleteEventOccurrence allows the parent event owner', () => {
  assert.equal(canDeleteEventOccurrence('user-a', { ownerId: 'user-a' }), true);
});

void test('canDeleteEventOccurrence denies a non-owner', () => {
  assert.equal(canDeleteEventOccurrence('user-b', { ownerId: 'user-a' }), false);
});

void test('canDeleteEventOccurrence denies anonymous callers', () => {
  assert.equal(canDeleteEventOccurrence(null, { ownerId: 'user-a' }), false);
});

void test('canDeleteEvent allows the owner', () => {
  assert.equal(canDeleteEvent('user-a', { ownerId: 'user-a' }), true);
});

void test('canDeleteEvent denies a non-owner', () => {
  assert.equal(canDeleteEvent('user-b', { ownerId: 'user-a' }), false);
});

void test('canDeleteEvent denies anonymous callers', () => {
  assert.equal(canDeleteEvent(null, { ownerId: 'user-a' }), false);
});

// --- Cancellation (Issue #125/#123): one predicate covers both cancel and
// uncancel - #123 draws no authority distinction between the two directions.

void test('canCancelEvent allows the owner', () => {
  assert.equal(canCancelEvent('user-a', { ownerId: 'user-a' }), true);
});

void test('canCancelEvent denies a non-owner', () => {
  assert.equal(canCancelEvent('user-b', { ownerId: 'user-a' }), false);
});

void test('canCancelEvent denies anonymous callers', () => {
  assert.equal(canCancelEvent(null, { ownerId: 'user-a' }), false);
});

void test('canCancelEventOccurrence allows the parent event owner', () => {
  assert.equal(canCancelEventOccurrence('user-a', { ownerId: 'user-a' }), true);
});

void test('canCancelEventOccurrence denies a non-owner', () => {
  assert.equal(canCancelEventOccurrence('user-b', { ownerId: 'user-a' }), false);
});

void test('canCancelEventOccurrence denies anonymous callers', () => {
  assert.equal(canCancelEventOccurrence(null, { ownerId: 'user-a' }), false);
});
