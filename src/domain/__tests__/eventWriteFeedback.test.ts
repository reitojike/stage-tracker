import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  INITIAL_WRITE_FORM_STATE,
  acceptedWriteFormState,
  rejectedWriteFormState,
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

void test('resolveWriteNotice distinguishes adding from updating an occurrence', () => {
  assert.notEqual(resolveWriteNotice('add-occurrence'), resolveWriteNotice('update-occurrence'));
});

void test('the initial state announces neither success nor failure', () => {
  assert.equal(INITIAL_WRITE_FORM_STATE.notice, null);
  assert.equal(INITIAL_WRITE_FORM_STATE.feedback, null);
  assert.deepEqual(INITIAL_WRITE_FORM_STATE.fieldErrors, {});
});
