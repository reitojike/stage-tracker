import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  acceptedWriteFormState,
  INITIAL_SCHEDULE_WRITE_FORM_STATE,
  INITIAL_SHARE_REMOVE_FORM_STATE,
  rejectedShareRemoveFormState,
  rejectedWriteFormState,
  resolveRemoveShareFeedback,
  resolveWriteFeedback,
  resolveWriteNotice,
} from '../personalScheduleWriteFeedback.ts';

void test('resolveWriteFeedback distinguishes every PlanningErrorKind for create', () => {
  const permission = resolveWriteFeedback('create-schedule-entry', 'permission-denied');
  const unauthenticated = resolveWriteFeedback('create-schedule-entry', 'unauthenticated');
  const validation = resolveWriteFeedback('create-schedule-entry', 'validation');
  const failure = resolveWriteFeedback('create-schedule-entry', 'failure');
  const notFound = resolveWriteFeedback('create-schedule-entry', 'not-found');

  const titles = new Set(
    [permission, unauthenticated, validation, failure, notFound].map((f) => f.title),
  );
  // All five kinds must be presented distinctly - never collapsed into one
  // message (docs/ux-ui.md "Common states").
  assert.equal(titles.size, 5);
});

void test('resolveWriteFeedback distinguishes operations for permission-denied', () => {
  const create = resolveWriteFeedback('create-schedule-entry', 'permission-denied');
  const update = resolveWriteFeedback('update-schedule-entry', 'permission-denied');
  assert.notEqual(create.title, update.title);
});

void test('resolveRemoveShareFeedback covers every PlanningErrorKind without throwing', () => {
  const kinds = [
    'permission-denied',
    'unauthenticated',
    'not-found',
    'validation',
    'failure',
  ] as const;
  for (const kind of kinds) {
    const feedback = resolveRemoveShareFeedback(kind);
    assert.equal(feedback.variant, 'error');
    assert.ok(feedback.title.length > 0);
  }
});

void test('resolveWriteNotice returns a distinct notice per operation', () => {
  assert.notEqual(
    resolveWriteNotice('create-schedule-entry'),
    resolveWriteNotice('update-schedule-entry'),
  );
});

void test('rejectedWriteFormState advances attempt and preserves submitted values', () => {
  const next = rejectedWriteFormState(
    INITIAL_SCHEDULE_WRITE_FORM_STATE,
    { scheduleType: 'work' },
    { scheduleType: '種別を選択してください。' },
    null,
  );
  assert.equal(next.attempt, 1);
  assert.deepEqual(next.values, { scheduleType: 'work' });
  assert.equal(next.notice, null);
});

void test('acceptedWriteFormState advances attempt and clears fieldErrors/feedback', () => {
  const rejected = rejectedWriteFormState(
    INITIAL_SCHEDULE_WRITE_FORM_STATE,
    {},
    { scheduleType: 'x' },
    null,
  );
  const accepted = acceptedWriteFormState(
    rejected,
    { scheduleType: 'work' },
    '予定を保存しました。',
  );
  assert.equal(accepted.attempt, 2);
  assert.deepEqual(accepted.fieldErrors, {});
  assert.equal(accepted.feedback, null);
  assert.equal(accepted.notice, '予定を保存しました。');
});

void test('rejectedShareRemoveFormState advances attempt and carries feedback', () => {
  const feedback = resolveRemoveShareFeedback('not-found');
  const next = rejectedShareRemoveFormState(INITIAL_SHARE_REMOVE_FORM_STATE, feedback);
  assert.equal(next.attempt, 1);
  assert.equal(next.feedback, feedback);
});
