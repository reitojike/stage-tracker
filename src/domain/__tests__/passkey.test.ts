import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  INITIAL_PASSKEY_DELETE_FORM_STATE,
  classifyCeremonyError,
  classifyManagementError,
  mapPasskeyListItem,
  rejectedPasskeyDeleteFormState,
  resolveCeremonyFeedback,
  resolveManagementFeedback,
} from '../passkey.ts';

void test('mapPasskeyListItem defaults an absent friendly name to null, not an empty string', () => {
  const item = mapPasskeyListItem({ id: 'p1', created_at: '2026-08-26T00:00:00Z' });
  assert.equal(item.friendlyName, null);
  assert.equal(item.lastUsedAt, null);
});

void test('mapPasskeyListItem preserves a present friendly name and last_used_at', () => {
  const item = mapPasskeyListItem({
    id: 'p1',
    friendly_name: 'iPhone',
    created_at: '2026-08-26T00:00:00Z',
    last_used_at: '2026-08-27T00:00:00Z',
  });
  assert.equal(item.friendlyName, 'iPhone');
  assert.equal(item.lastUsedAt, '2026-08-27T00:00:00Z');
});

void test('classifyManagementError treats a 401 as not-authenticated, not a generic failure', () => {
  const classified = classifyManagementError({ message: 'no session', status: 401 });
  assert.equal(classified.kind, 'not-authenticated');
});

void test('classifyManagementError treats session_not_found/session_expired codes as not-authenticated', () => {
  assert.equal(
    classifyManagementError({ message: 'x', code: 'session_not_found' }).kind,
    'not-authenticated',
  );
  assert.equal(
    classifyManagementError({ message: 'x', code: 'session_expired' }).kind,
    'not-authenticated',
  );
});

void test('classifyManagementError falls back to failure for an unrecognised error', () => {
  const classified = classifyManagementError({ message: 'boom', code: 'unexpected_failure' });
  assert.equal(classified.kind, 'failure');
});

void test('resolveManagementFeedback keeps list and delete failure messages distinct', () => {
  const listFailure = resolveManagementFeedback('list', 'failure');
  const deleteFailure = resolveManagementFeedback('delete', 'failure');
  assert.notEqual(listFailure.title, deleteFailure.title);
});

void test('resolveManagementFeedback returns the same not-authenticated message regardless of operation', () => {
  // Not-authenticated has one meaning ("your session is gone") independent
  // of which operation surfaced it, unlike `failure` which names what
  // specifically could not be done.
  const list = resolveManagementFeedback('list', 'not-authenticated');
  const del = resolveManagementFeedback('delete', 'not-authenticated');
  assert.equal(list.title, del.title);
});

void test('rejectedPasskeyDeleteFormState advances the remount key', () => {
  const feedback = resolveManagementFeedback('delete', 'failure');
  const next = rejectedPasskeyDeleteFormState(INITIAL_PASSKEY_DELETE_FORM_STATE, feedback);
  assert.equal(next.attempt, INITIAL_PASSKEY_DELETE_FORM_STATE.attempt + 1);
  assert.equal(next.feedback, feedback);
});

void test('classifyCeremonyError distinguishes a user-cancelled ceremony from a real failure', () => {
  assert.equal(
    classifyCeremonyError({ message: 'aborted', code: 'ERROR_CEREMONY_ABORTED' }),
    'cancelled',
  );
  assert.equal(classifyCeremonyError({ message: 'boom', code: 'unexpected_failure' }), 'failure');
});

void test('classifyCeremonyError recognises server-reported duplicate/too-many-passkeys codes', () => {
  assert.equal(
    classifyCeremonyError({ message: 'exists', code: 'webauthn_credential_exists' }),
    'duplicate',
  );
  assert.equal(classifyCeremonyError({ message: 'limit', code: 'too_many_passkeys' }), 'too-many');
});

void test('classifyCeremonyError recognises unsupported-authenticator WebAuthn codes', () => {
  assert.equal(
    classifyCeremonyError({
      message: 'unsupported',
      code: 'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT',
    }),
    'unsupported',
  );
});

void test('classifyCeremonyError falls back to failure when there is no error code at all', () => {
  assert.equal(classifyCeremonyError({ message: 'network error' }), 'failure');
});

void test('resolveCeremonyFeedback gives register and sign-in distinct guidance for the same kind', () => {
  // A failed registration should not tell the user to fall back to Magic
  // Link (they are already signed in); a failed sign-in should.
  const registerFailure = resolveCeremonyFeedback('register', 'failure');
  const signInFailure = resolveCeremonyFeedback('sign-in', 'failure');
  assert.notEqual(registerFailure.description, signInFailure.description);
});

void test('resolveCeremonyFeedback is total over every PasskeyCeremonyErrorKind for both operations', () => {
  const kinds = ['cancelled', 'unsupported', 'duplicate', 'too-many', 'failure'] as const;
  for (const kind of kinds) {
    assert.ok(resolveCeremonyFeedback('register', kind).title.length > 0);
    assert.ok(resolveCeremonyFeedback('sign-in', kind).title.length > 0);
  }
});
