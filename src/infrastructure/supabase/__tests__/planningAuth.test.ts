import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
} from '@supabase/supabase-js';
import { classifyGetUserError, requireAuthenticatedUserId } from '../planningAuth.ts';

// Pure classification tests for requireAuthenticatedUserId's error handling
// (Issue #33, Codex P2 finding on PR #52). client.auth.getUser()'s error
// covers both "no/invalid session" (genuinely unauthenticated) and
// transient Auth-service failures (5xx, network, rate limit) that say
// nothing about whether the caller is signed in - these must not be
// collapsed into the same PlanningErrorKind. Real AuthError subclasses from
// @supabase/supabase-js are constructed directly (no network call, no
// stub), so isAuthSessionMissingError/isAuthApiError classify them exactly
// as they would classify a genuine SDK error.

void test('classifyGetUserError: AuthSessionMissingError (no session) -> unauthenticated', () => {
  const result = classifyGetUserError(new AuthSessionMissingError());
  assert.equal(result.kind, 'unauthenticated');
});

void test('classifyGetUserError: AuthApiError 401 (invalid/expired token) -> unauthenticated', () => {
  const result = classifyGetUserError(new AuthApiError('invalid JWT', 401, 'bad_jwt'));
  assert.equal(result.kind, 'unauthenticated');
});

void test('classifyGetUserError: AuthApiError 403 (insufficient auth) -> unauthenticated', () => {
  const result = classifyGetUserError(new AuthApiError('forbidden', 403, undefined));
  assert.equal(result.kind, 'unauthenticated');
});

void test('classifyGetUserError: AuthApiError 500 (Auth server failure) -> failure, not unauthenticated', () => {
  const result = classifyGetUserError(new AuthApiError('internal error', 500, undefined));
  assert.equal(result.kind, 'failure');
});

void test('classifyGetUserError: AuthRetryableFetchError (network/rate-limit) -> failure', () => {
  const result = classifyGetUserError(new AuthRetryableFetchError('network error', 0));
  assert.equal(result.kind, 'failure');
});

void test('classifyGetUserError: AuthUnknownError -> failure', () => {
  const result = classifyGetUserError(new AuthUnknownError('unexpected', new Error('boom')));
  assert.equal(result.kind, 'failure');
});

void test('requireAuthenticatedUserId resolves the id on success', async () => {
  const client = {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }),
    },
  };
  const result = await requireAuthenticatedUserId(client);
  assert.deepEqual(result, { ok: true, data: 'user-1' });
});

void test('requireAuthenticatedUserId reports unauthenticated for a missing session', async () => {
  const client = {
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: null }, error: new AuthSessionMissingError() }),
    },
  };
  const result = await requireAuthenticatedUserId(client);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'unauthenticated');
});

void test('requireAuthenticatedUserId reports failure (not unauthenticated) for a 500 from the Auth server', async () => {
  const client = {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: null },
          error: new AuthApiError('internal error', 500, undefined),
        }),
    },
  };
  const result = await requireAuthenticatedUserId(client);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'failure');
});
