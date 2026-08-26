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

void test('passkeyDisplayLabel prefers the friendly name when present', () => {
  const label = passkeyDisplayLabel({
    id: 'p1',
    friendlyName: 'iPhone',
    createdAt: '2026-08-26T02:00:00.000Z',
    lastUsedAt: null,
  });
  assert.equal(label, 'iPhone');
});

void test('passkeyDisplayLabel falls back to a createdAt-based label so unnamed credentials stay distinguishable', () => {
  // Two unnamed passkeys registered at different times must not render as
  // the same text (Codex P2 finding, PR #129) - otherwise there is no way
  // to tell which "delete" button revokes which device.
  const first = passkeyDisplayLabel({
    id: '11111111-1111-4111-8111-1111111111aa',
    friendlyName: null,
    createdAt: '2026-08-10T02:00:00.000Z',
    lastUsedAt: null,
  });
  const second = passkeyDisplayLabel({
    id: '22222222-2222-4222-8222-2222222222bb',
    friendlyName: null,
    createdAt: '2026-08-11T02:00:00.000Z',
    lastUsedAt: null,
  });
  assert.notEqual(first, second);
  assert.equal(first, '登録済みPasskey（2026年8月10日 11:00 登録・ID: 11aa）');
});

void test('passkeyDisplayLabel stays distinguishable for two unnamed passkeys registered in the same minute', () => {
  // tokyoTimeLabel truncates seconds, so createdAt alone collides within
  // one minute (Codex P2 follow-up finding, PR #129) - the id suffix must
  // carry the distinction in that case.
  const first = passkeyDisplayLabel({
    id: '11111111-1111-4111-8111-1111111111aa',
    friendlyName: null,
    createdAt: '2026-08-10T02:00:00.100Z',
    lastUsedAt: null,
  });
  const second = passkeyDisplayLabel({
    id: '22222222-2222-4222-8222-2222222222bb',
    friendlyName: null,
    createdAt: '2026-08-10T02:00:00.900Z',
    lastUsedAt: null,
  });
  assert.notEqual(first, second);
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
