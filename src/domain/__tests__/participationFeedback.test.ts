import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlanningErrorKind } from '../planningError.ts';
import {
  acceptedOperationState,
  INITIAL_OPERATION_STATE,
  rejectedOperationState,
  resolveOperationFeedback,
  resolveOperationNotice,
  resolveParticipationSetNotice,
  type ParticipationOperation,
} from '../participationFeedback.ts';

const OPERATIONS: readonly ParticipationOperation[] = [
  'set-participation',
  'withdraw-participation',
  'invite-to-occurrence',
  'decline-invitation',
];

const KINDS: readonly PlanningErrorKind[] = [
  'unauthenticated',
  'not-found',
  'permission-denied',
  'validation',
  'failure',
];

void test('resolveOperationFeedback returns an error-variant feedback for every operation/kind pair', () => {
  for (const operation of OPERATIONS) {
    for (const kind of KINDS) {
      const feedback = resolveOperationFeedback(operation, kind);
      assert.equal(feedback.variant, 'error');
      assert.ok(feedback.title.length > 0);
      assert.ok(feedback.description.length > 0);
    }
  }
});

void test('resolveOperationFeedback gives every operation its own permission-denied wording', () => {
  const feedbacks = OPERATIONS.map(
    (operation) => resolveOperationFeedback(operation, 'permission-denied').description,
  );
  assert.equal(
    new Set(feedbacks).size,
    feedbacks.length,
    'expected distinct wording per operation',
  );
});

void test('resolveOperationFeedback names the attending-only restriction for invite-to-occurrence permission-denied', () => {
  const feedback = resolveOperationFeedback('invite-to-occurrence', 'permission-denied');
  assert.ok(feedback.description.includes('参加する'));
});

void test('resolveOperationNotice returns operation-specific text', () => {
  assert.equal(resolveOperationNotice('withdraw-participation'), '参加予定を解除しました。');
  assert.equal(resolveOperationNotice('invite-to-occurrence'), '招待を送信しました。');
  assert.equal(resolveOperationNotice('decline-invitation'), '招待を辞退しました。');
});

void test('resolveParticipationSetNotice distinguishes considering from attending', () => {
  assert.notEqual(
    resolveParticipationSetNotice('considering'),
    resolveParticipationSetNotice('attending'),
  );
});

void test('rejectedOperationState advances attempt, clears notice, and preserves values by default', () => {
  const previous = acceptedOperationState(INITIAL_OPERATION_STATE, 'ok');
  const feedback = resolveOperationFeedback('invite-to-occurrence', 'validation');
  const next = rejectedOperationState(previous, feedback, 'bad email', { email: 'x' });
  assert.equal(next.attempt, previous.attempt + 1);
  assert.equal(next.feedback, feedback);
  assert.equal(next.fieldError, 'bad email');
  assert.deepEqual(next.values, { email: 'x' });
  assert.equal(next.notice, null);

  const again = rejectedOperationState(next, null, 'still bad');
  assert.deepEqual(again.values, { email: 'x' }, 'values default to carrying forward unchanged');
});

void test('acceptedOperationState advances attempt, clears feedback/fieldError/values, and sets notice', () => {
  const rejected = rejectedOperationState(INITIAL_OPERATION_STATE, null, 'bad', { email: 'x' });
  const accepted = acceptedOperationState(rejected, '送信しました。');
  assert.equal(accepted.attempt, rejected.attempt + 1);
  assert.equal(accepted.feedback, null);
  assert.equal(accepted.fieldError, null);
  assert.deepEqual(accepted.values, {});
  assert.equal(accepted.notice, '送信しました。');
});
