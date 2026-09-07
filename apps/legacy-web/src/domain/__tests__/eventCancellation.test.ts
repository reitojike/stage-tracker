import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isEffectivelyCanceled,
  isEventCanceled,
  isOccurrenceCanceled,
} from '../eventCancellation.ts';

const ACTIVE = { canceledAt: null };
const CANCELED = { canceledAt: '2026-08-26T00:00:00Z' };

void test('isEventCanceled: false when canceledAt is null', () => {
  assert.equal(isEventCanceled(ACTIVE), false);
});

void test('isEventCanceled: true when canceledAt is set', () => {
  assert.equal(isEventCanceled(CANCELED), true);
});

void test('isOccurrenceCanceled: false when canceledAt is null', () => {
  assert.equal(isOccurrenceCanceled(ACTIVE), false);
});

void test('isOccurrenceCanceled: true when canceledAt is set', () => {
  assert.equal(isOccurrenceCanceled(CANCELED), true);
});

// --- isEffectivelyCanceled: OR composition (product-rules.md "Cancellation") ---

void test('isEffectivelyCanceled: false when neither Event nor Occurrence is canceled', () => {
  assert.equal(isEffectivelyCanceled(ACTIVE, ACTIVE), false);
});

void test('isEffectivelyCanceled: true when only the Event is canceled', () => {
  assert.equal(isEffectivelyCanceled(CANCELED, ACTIVE), true);
});

void test('isEffectivelyCanceled: true when only the Occurrence is canceled', () => {
  assert.equal(isEffectivelyCanceled(ACTIVE, CANCELED), true);
});

void test('isEffectivelyCanceled: true when both are canceled', () => {
  assert.equal(isEffectivelyCanceled(CANCELED, CANCELED), true);
});
