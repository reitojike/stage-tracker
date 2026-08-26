import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  INITIAL_PASSKEY_DELETE_FORM_STATE,
  classifyCeremonyError,
  mapPasskeyListItem,
  passkeyDisplayLabel,
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

void test('passkeyDisplayLabel renders "<friendlyName> — <registered date/time>" when named', () => {
  // PO decision (2026-08-26, recorded on Issue #106): fixed format, no
  // collision detection, no id in the label.
  const label = passkeyDisplayLabel({
    id: '11111111-1111-4111-8111-1111111111aa',
    friendlyName: 'iPhone',
    createdAt: '2026-08-10T02:00:00.000Z',
    lastUsedAt: null,
  });
  assert.equal(label, 'iPhone — 2026年8月10日 11:00');
});

void test('passkeyDisplayLabel renders "登録済みPasskey — <registered date/time>" when unnamed', () => {
  const label = passkeyDisplayLabel({
    id: '11111111-1111-4111-8111-1111111111aa',
    friendlyName: null,
    createdAt: '2026-08-10T02:00:00.000Z',
    lastUsedAt: null,
  });
  assert.equal(label, '登録済みPasskey — 2026年8月10日 11:00');
});

void test('passkeyDisplayLabel does not vary by any other passkey in the list (no collision detection)', () => {
  // Two credentials with the same friendly name intentionally render
  // identically per the PO decision - passkeyDisplayLabel takes a single
  // passkey, not a list, so there is nothing for it to compare against.
  const a = passkeyDisplayLabel({
    id: '11111111-1111-4111-8111-1111111111aa',
    friendlyName: 'iPhone',
    createdAt: '2026-08-10T02:00:00.000Z',
    lastUsedAt: null,
  });
  const b = passkeyDisplayLabel({
    id: '22222222-2222-4222-8222-2222222222bb',
    friendlyName: 'iPhone',
    createdAt: '2026-08-10T02:00:00.000Z',
    lastUsedAt: null,
  });
  assert.equal(a, b);
  assert.equal(a, 'iPhone — 2026年8月10日 11:00');
});

void test('passkeyDisplayLabel never includes the passkey id', () => {
  // id stays an internal identity for the delete boundary
  // (DeletePasskeyForm's hidden passkeyId value) and must not leak into
  // the user-facing label.
  const label = passkeyDisplayLabel({
    id: '11111111-1111-4111-8111-1111111111aa',
    friendlyName: null,
    createdAt: '2026-08-10T02:00:00.000Z',
    lastUsedAt: null,
  });
  assert.ok(!label.includes('11111111-1111-4111-8111-1111111111aa'));
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
