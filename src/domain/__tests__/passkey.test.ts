import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  INITIAL_PASSKEY_DELETE_FORM_STATE,
  classifyCeremonyError,
  mapPasskeyListItem,
  passkeyDisplayLabels,
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

void test('passkeyDisplayLabels prefers the friendly name when it is unique in the list', () => {
  const labels = passkeyDisplayLabels([
    {
      id: '11111111-1111-4111-8111-1111111111aa',
      friendlyName: 'iPhone',
      createdAt: '2026-08-26T02:00:00.000Z',
      lastUsedAt: null,
    },
  ]);
  assert.equal(labels.get('11111111-1111-4111-8111-1111111111aa'), 'iPhone');
});

void test('passkeyDisplayLabels falls back to a createdAt-based label for an unnamed credential', () => {
  const labels = passkeyDisplayLabels([
    {
      id: '11111111-1111-4111-8111-1111111111aa',
      friendlyName: null,
      createdAt: '2026-08-10T02:00:00.000Z',
      lastUsedAt: null,
    },
  ]);
  assert.equal(
    labels.get('11111111-1111-4111-8111-1111111111aa'),
    '登録済みPasskey（2026年8月10日 11:00 登録）',
  );
});

void test('passkeyDisplayLabels disambiguates two unnamed credentials registered at different times', () => {
  // Two unnamed passkeys must not render as the same text (Codex P2
  // finding, PR #129) - otherwise there is no way to tell which "delete"
  // button revokes which device.
  const labels = passkeyDisplayLabels([
    {
      id: '11111111-1111-4111-8111-1111111111aa',
      friendlyName: null,
      createdAt: '2026-08-10T02:00:00.000Z',
      lastUsedAt: null,
    },
    {
      id: '22222222-2222-4222-8222-2222222222bb',
      friendlyName: null,
      createdAt: '2026-08-11T02:00:00.000Z',
      lastUsedAt: null,
    },
  ]);
  assert.notEqual(
    labels.get('11111111-1111-4111-8111-1111111111aa'),
    labels.get('22222222-2222-4222-8222-2222222222bb'),
  );
});

void test('passkeyDisplayLabels disambiguates two unnamed credentials registered in the same minute', () => {
  // tokyoTimeLabel truncates seconds, so createdAt alone collides within
  // one minute (Codex P2 follow-up finding, PR #129).
  const labels = passkeyDisplayLabels([
    {
      id: '11111111-1111-4111-8111-1111111111aa',
      friendlyName: null,
      createdAt: '2026-08-10T02:00:00.100Z',
      lastUsedAt: null,
    },
    {
      id: '22222222-2222-4222-8222-2222222222bb',
      friendlyName: null,
      createdAt: '2026-08-10T02:00:00.900Z',
      lastUsedAt: null,
    },
  ]);
  const first = labels.get('11111111-1111-4111-8111-1111111111aa');
  const second = labels.get('22222222-2222-4222-8222-2222222222bb');
  assert.notEqual(first, second);
  assert.equal(
    first,
    '登録済みPasskey（2026年8月10日 11:00 登録）（ID: 11111111-1111-4111-8111-1111111111aa）',
  );
});

void test('passkeyDisplayLabels disambiguates two credentials that share a non-null friendly name', () => {
  // friendly_name is caller-supplied free text with no uniqueness
  // constraint (Codex finding, PR #129) - two credentials can legitimately
  // both be named "iPhone".
  const labels = passkeyDisplayLabels([
    {
      id: '11111111-1111-4111-8111-1111111111aa',
      friendlyName: 'iPhone',
      createdAt: '2026-08-10T02:00:00.000Z',
      lastUsedAt: null,
    },
    {
      id: '22222222-2222-4222-8222-2222222222bb',
      friendlyName: 'iPhone',
      createdAt: '2026-08-11T02:00:00.000Z',
      lastUsedAt: null,
    },
  ]);
  const first = labels.get('11111111-1111-4111-8111-1111111111aa');
  const second = labels.get('22222222-2222-4222-8222-2222222222bb');
  assert.notEqual(first, second);
  assert.equal(first, 'iPhone（ID: 11111111-1111-4111-8111-1111111111aa）');
});

void test('passkeyDisplayLabels leaves a unique friendly name free of id noise even when other unnamed credentials collide', () => {
  const labels = passkeyDisplayLabels([
    {
      id: '11111111-1111-4111-8111-1111111111aa',
      friendlyName: 'iPhone',
      createdAt: '2026-08-10T02:00:00.000Z',
      lastUsedAt: null,
    },
    {
      id: '22222222-2222-4222-8222-2222222222bb',
      friendlyName: null,
      createdAt: '2026-08-11T02:00:00.000Z',
      lastUsedAt: null,
    },
    {
      id: '33333333-3333-4333-8333-3333333333cc',
      friendlyName: null,
      createdAt: '2026-08-11T02:00:00.000Z',
      lastUsedAt: null,
    },
  ]);
  assert.equal(labels.get('11111111-1111-4111-8111-1111111111aa'), 'iPhone');
  assert.notEqual(
    labels.get('22222222-2222-4222-8222-2222222222bb'),
    labels.get('33333333-3333-4333-8333-3333333333cc'),
  );
});

void test("passkeyDisplayLabels stays injective when a friendly name is crafted to mimic another credential's disambiguated label", () => {
  // PO finding on PR #129: checking base labels against each other once
  // is not enough. A: friendlyName "iPhone" id AAA; B: friendlyName
  // "iPhone" id BBB - both would be suffixed to
  // "iPhone（ID: <own id>）". C's own friendlyName is crafted to literally
  // equal A's post-suffix string ("iPhone（ID: <A's id>）"), which a
  // single base-vs-base collision check would miss entirely, since C's
  // *base* (its raw friendlyName) never collides with A's or B's *base*
  // ("iPhone") - only with A's label after A gets disambiguated.
  const idA = '11111111-1111-4111-8111-1111111111aa';
  const idB = '22222222-2222-4222-8222-2222222222bb';
  const idC = '33333333-3333-4333-8333-3333333333cc';
  const labels = passkeyDisplayLabels([
    { id: idA, friendlyName: 'iPhone', createdAt: '2026-08-10T02:00:00.000Z', lastUsedAt: null },
    { id: idB, friendlyName: 'iPhone', createdAt: '2026-08-11T02:00:00.000Z', lastUsedAt: null },
    {
      id: idC,
      friendlyName: `iPhone（ID: ${idA}）`,
      createdAt: '2026-08-12T02:00:00.000Z',
      lastUsedAt: null,
    },
  ]);
  const rendered = [labels.get(idA), labels.get(idB), labels.get(idC)];
  assert.equal(
    new Set(rendered).size,
    3,
    `expected 3 distinct labels, got ${JSON.stringify(rendered)}`,
  );
  // A and B still resolve exactly as the simple two-way collision would.
  assert.equal(labels.get(idA), `iPhone（ID: ${idA}）`);
  assert.equal(labels.get(idB), `iPhone（ID: ${idB}）`);
  // C, whose base already equalled A's disambiguated form, is escalated
  // in turn once that collision is detected.
  assert.equal(labels.get(idC), `iPhone（ID: ${idA}）（ID: ${idC}）`);
});

void test('passkeyDisplayLabels never returns duplicate final labels for a mixed batch of unique, colliding, and adversarial entries', () => {
  const passkeys = [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      friendlyName: 'Work laptop',
      createdAt: '2026-08-01T00:00:00.000Z',
      lastUsedAt: null,
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      friendlyName: null,
      createdAt: '2026-08-02T03:00:00.000Z',
      lastUsedAt: null,
    },
    {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      friendlyName: null,
      createdAt: '2026-08-02T03:00:00.000Z',
      lastUsedAt: null,
    },
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      friendlyName: 'iPhone',
      createdAt: '2026-08-03T00:00:00.000Z',
      lastUsedAt: null,
    },
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      friendlyName: 'iPhone',
      createdAt: '2026-08-04T00:00:00.000Z',
      lastUsedAt: null,
    },
  ];
  const labels = passkeyDisplayLabels(passkeys);
  const rendered = passkeys.map((passkey) => labels.get(passkey.id));
  assert.equal(
    new Set(rendered).size,
    passkeys.length,
    `expected ${String(passkeys.length)} distinct labels, got ${JSON.stringify(rendered)}`,
  );
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
