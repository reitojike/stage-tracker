import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  acceptedShareAddFormState,
  acceptedWriteFormState,
  INITIAL_SCHEDULE_WRITE_FORM_STATE,
  INITIAL_SHARE_ADD_FORM_STATE,
  INITIAL_SHARE_REMOVE_FORM_STATE,
  rejectedShareAddFormState,
  rejectedShareRemoveFormState,
  rejectedWriteFormState,
  resolveOwnerRemoveShareFeedback,
  resolveRemoveShareFeedback,
  resolveShareByEmailOutcome,
  resolveWriteFeedback,
  resolveWriteNotice,
} from '../personalScheduleWriteFeedback.ts';
import type { PlanningError } from '../planningError.ts';

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

void test('resolveOwnerRemoveShareFeedback covers every PlanningErrorKind without throwing', () => {
  const kinds = [
    'permission-denied',
    'unauthenticated',
    'not-found',
    'validation',
    'failure',
  ] as const;
  for (const kind of kinds) {
    const feedback = resolveOwnerRemoveShareFeedback(kind);
    assert.equal(feedback.variant, 'error');
    assert.ok(feedback.title.length > 0);
  }
});

void test('resolveOwnerRemoveShareFeedback differs from resolveRemoveShareFeedback (owner- vs self-facing wording)', () => {
  assert.notEqual(
    resolveOwnerRemoveShareFeedback('permission-denied').title,
    resolveRemoveShareFeedback('permission-denied').title,
  );
});

function validationError(message: string): PlanningError {
  return { kind: 'validation', message, code: 'P0001' };
}

void test('resolveShareByEmailOutcome surfaces "not a registered account" as a distinct field error', () => {
  const outcome = resolveShareByEmailOutcome(
    validationError('recipient email is not a registered account'),
  );
  assert.equal(outcome.feedback, null);
  assert.match(outcome.fieldError ?? '', /見つかりません/);
});

void test('resolveShareByEmailOutcome surfaces "cannot share with yourself" as a distinct field error', () => {
  const outcome = resolveShareByEmailOutcome(validationError('cannot share with yourself'));
  assert.equal(outcome.feedback, null);
  assert.equal(outcome.fieldError, '自分自身とは共有できません。');
});

void test('resolveShareByEmailOutcome surfaces an invalid email format as a distinct field error', () => {
  const outcome = resolveShareByEmailOutcome(
    validationError('recipient email is not a valid email address'),
  );
  assert.equal(outcome.feedback, null);
  assert.match(outcome.fieldError ?? '', /形式が正しくありません/);
});

void test('resolveShareByEmailOutcome distinguishes every non-validation kind as a systemic feedback, not a field error', () => {
  for (const kind of ['permission-denied', 'unauthenticated', 'not-found', 'failure'] as const) {
    const outcome = resolveShareByEmailOutcome({ kind, message: 'x', code: 'x' });
    assert.equal(outcome.fieldError, null);
    assert.notEqual(outcome.feedback, null);
  }
});

void test('resolveShareByEmailOutcome gives every distinct validation reason its own message', () => {
  const messages = [
    'recipient email is not a registered account',
    'cannot share with yourself',
    'recipient email is not a valid email address',
    'schedule entry and recipient email are required',
  ];
  const fieldErrors = new Set(
    messages.map((message) => resolveShareByEmailOutcome(validationError(message)).fieldError),
  );
  assert.equal(fieldErrors.size, messages.length);
});

void test('rejectedShareAddFormState advances attempt and preserves the submitted email', () => {
  const next = rejectedShareAddFormState(
    INITIAL_SHARE_ADD_FORM_STATE,
    'not-an-email',
    'メールアドレスの形式が正しくありません。',
    null,
  );
  assert.equal(next.attempt, 1);
  assert.equal(next.email, 'not-an-email');
  assert.equal(next.notice, null);
});

void test('acceptedShareAddFormState advances attempt, clears the email, and sets a notice', () => {
  const rejected = rejectedShareAddFormState(
    INITIAL_SHARE_ADD_FORM_STATE,
    'x@example.com',
    'x',
    null,
  );
  const accepted = acceptedShareAddFormState(rejected);
  assert.equal(accepted.attempt, 2);
  assert.equal(accepted.email, '');
  assert.equal(accepted.fieldError, null);
  assert.ok(accepted.notice !== null);
});
