import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  INITIAL_EVENT_DELETE_FORM_STATE,
  INITIAL_WRITE_FORM_STATE,
  acceptedWriteFormState,
  rejectedEventDeleteFormState,
  rejectedWriteFormState,
  resolveDeleteFeedback,
  resolveDuplicateOccurrenceFieldErrors,
  resolveWriteFeedback,
  resolveWriteNotice,
} from '../eventWriteFeedback.ts';

void test('resolveWriteFeedback keeps permission denial distinct from validation and failure', () => {
  const denied = resolveWriteFeedback('create-event', 'permission-denied');
  const invalid = resolveWriteFeedback('create-event', 'validation');
  const failed = resolveWriteFeedback('create-event', 'failure');

  assert.notEqual(denied.title, invalid.title);
  assert.notEqual(denied.title, failed.title);
  assert.notEqual(invalid.title, failed.title);
});

void test('a create denial names the creator restriction, not a generic refusal', () => {
  const denied = resolveWriteFeedback('create-event', 'permission-denied');
  const ownerDenied = resolveWriteFeedback('update-event', 'permission-denied');

  // The two denials are not interchangeable: one means "you are not a
  // designated catalog creator", the other "this is not your event".
  assert.notEqual(denied.description, ownerDenied.description);
});

void test('acceptedWriteFormState advances the remount key', () => {
  // Load-bearing, not cosmetic: `attempt` is the forms' remount key, so a
  // successful submission has to advance it or an uncontrolled input keeps
  // the value that was just persisted - which is how the same 公演回 gets
  // added twice.
  const next = acceptedWriteFormState(INITIAL_WRITE_FORM_STATE, {}, 'saved');
  assert.equal(next.attempt, INITIAL_WRITE_FORM_STATE.attempt + 1);
});

void test('acceptedWriteFormState clears the previous rejection', () => {
  const rejected = rejectedWriteFormState(
    INITIAL_WRITE_FORM_STATE,
    { title: '' },
    { title: 'required' },
    resolveWriteFeedback('update-event', 'validation'),
  );
  const accepted = acceptedWriteFormState(rejected, { title: 'ok' }, 'saved');

  assert.deepEqual(accepted.fieldErrors, {});
  assert.equal(accepted.feedback, null);
  assert.equal(accepted.notice, 'saved');
});

void test('acceptedWriteFormState carries the values it is given', () => {
  // An edit form keeps showing what it saved; an add form starts empty
  // again. Both go through this one helper, so the caller decides.
  const kept = acceptedWriteFormState(INITIAL_WRITE_FORM_STATE, { title: 'saved title' }, 'ok');
  const cleared = acceptedWriteFormState(INITIAL_WRITE_FORM_STATE, {}, 'ok');

  assert.deepEqual(kept.values, { title: 'saved title' });
  assert.deepEqual(cleared.values, {});
});

void test('rejectedWriteFormState drops a stale success notice', () => {
  // Otherwise a save followed by a failed save would show "保存しました"
  // above the error that says it was not saved.
  const accepted = acceptedWriteFormState(INITIAL_WRITE_FORM_STATE, {}, 'saved');
  const rejected = rejectedWriteFormState(
    accepted,
    {},
    {},
    resolveWriteFeedback('update-event', 'failure'),
  );

  assert.equal(rejected.notice, null);
});

void test('rejectedWriteFormState preserves what was submitted', () => {
  const rejected = rejectedWriteFormState(
    INITIAL_WRITE_FORM_STATE,
    { title: 'typed but not saved' },
    { startsAt: 'required' },
    null,
  );

  assert.deepEqual(rejected.values, { title: 'typed but not saved' });
  assert.equal(rejected.attempt, 1);
});

// Issue #79: this renders at the startsAt input, not as a banner - the
// caller (eventWrite.ts) intercepts 'duplicate-occurrence' and reaches for
// this instead of resolveWriteFeedback.
void test('resolveDuplicateOccurrenceFieldErrors names the startsAt field', () => {
  const fieldErrors = resolveDuplicateOccurrenceFieldErrors();
  assert.ok(fieldErrors.startsAt);
  assert.equal(Object.keys(fieldErrors).length, 1);
});

void test('resolveWriteNotice distinguishes adding from updating an occurrence', () => {
  assert.notEqual(resolveWriteNotice('add-occurrence'), resolveWriteNotice('update-occurrence'));
});

void test('the initial state announces neither success nor failure', () => {
  assert.equal(INITIAL_WRITE_FORM_STATE.notice, null);
  assert.equal(INITIAL_WRITE_FORM_STATE.feedback, null);
  assert.deepEqual(INITIAL_WRITE_FORM_STATE.fieldErrors, {});
});

// --- Hard deletion feedback (Issue #124) ---

void test('resolveDeleteFeedback keeps permission-denied distinct from delete-blocked and failure', () => {
  const denied = resolveDeleteFeedback('delete-event', 'permission-denied');
  const blocked = resolveDeleteFeedback('delete-event', 'delete-blocked');
  const failed = resolveDeleteFeedback('delete-event', 'failure');

  assert.notEqual(denied.title, blocked.title);
  assert.notEqual(denied.title, failed.title);
  assert.notEqual(blocked.title, failed.title);
});

void test('resolveDeleteFeedback gives delete-event and delete-occurrence their own permission-denied wording', () => {
  const eventDenied = resolveDeleteFeedback('delete-event', 'permission-denied');
  const occurrenceDenied = resolveDeleteFeedback('delete-occurrence', 'permission-denied');
  assert.notEqual(eventDenied.description, occurrenceDenied.description);
});

void test('resolveDeleteFeedback gives delete-event and delete-occurrence their own delete-blocked wording', () => {
  const eventBlocked = resolveDeleteFeedback('delete-event', 'delete-blocked');
  const occurrenceBlocked = resolveDeleteFeedback('delete-occurrence', 'delete-blocked');
  assert.notEqual(eventBlocked.description, occurrenceBlocked.description);
});

void test('resolveDeleteFeedback covers every EventCatalogWriteErrorKind without throwing', () => {
  const kinds = [
    'permission-denied',
    'validation',
    'duplicate-occurrence',
    'delete-blocked',
    'failure',
  ] as const;
  for (const operation of ['delete-event', 'delete-occurrence'] as const) {
    for (const kind of kinds) {
      const feedback = resolveDeleteFeedback(operation, kind);
      assert.equal(feedback.variant, 'error');
      assert.ok(feedback.title.length > 0);
    }
  }
});

void test('the initial delete form state announces no feedback', () => {
  assert.equal(INITIAL_EVENT_DELETE_FORM_STATE.attempt, 0);
  assert.equal(INITIAL_EVENT_DELETE_FORM_STATE.feedback, null);
});

void test('rejectedEventDeleteFormState advances attempt and carries feedback', () => {
  const feedback = resolveDeleteFeedback('delete-occurrence', 'delete-blocked');
  const next = rejectedEventDeleteFormState(INITIAL_EVENT_DELETE_FORM_STATE, feedback);
  assert.equal(next.attempt, INITIAL_EVENT_DELETE_FORM_STATE.attempt + 1);
  assert.equal(next.feedback, feedback);
});
