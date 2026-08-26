import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from '@supabase/supabase-js';
import { classifyManagementError } from '../passkey.ts';

// Pure classification tests for listPasskeys/deletePasskey's error handling
// (Issue #106, Claude review finding on PR #129 - the same class of bug
// src/infrastructure/supabase/planningAuth.ts's classifyGetUserError was
// fixed for on PR #52: a hand-rolled status/code match silently missed the
// real AuthSessionMissingError shape). Real AuthError subclasses from
// @supabase/supabase-js are constructed directly (no network call), so
// isAuthSessionMissingError/isAuthApiError classify them exactly as they
// would classify a genuine SDK error - unlike a hand-built `{ code: '...' }`
// literal, which proves nothing about whether the real error actually
// carries that shape.

void test('classifyManagementError: AuthSessionMissingError (no session) -> not-authenticated', () => {
  // The exact error GoTrue's own client-side passkey.list()/delete() throw
  // when there is no session at all (status 400, no `code`) - see
  // @supabase/auth-js's GoTrueClient._listPasskeys/_deletePasskey.
  const result = classifyManagementError(new AuthSessionMissingError());
  assert.equal(result.kind, 'not-authenticated');
});

void test('classifyManagementError: AuthApiError 401 (expired/invalid session) -> not-authenticated', () => {
  const result = classifyManagementError(new AuthApiError('invalid JWT', 401, 'bad_jwt'));
  assert.equal(result.kind, 'not-authenticated');
});

void test('classifyManagementError: AuthApiError 403 -> not-authenticated', () => {
  const result = classifyManagementError(new AuthApiError('forbidden', 403, undefined));
  assert.equal(result.kind, 'not-authenticated');
});

void test('classifyManagementError: AuthApiError 500 (Auth server failure) -> failure, not not-authenticated', () => {
  const result = classifyManagementError(new AuthApiError('internal error', 500, undefined));
  assert.equal(result.kind, 'failure');
});

void test('classifyManagementError: AuthRetryableFetchError (network/rate-limit) -> failure', () => {
  const result = classifyManagementError(new AuthRetryableFetchError('network error', 0));
  assert.equal(result.kind, 'failure');
});

void test('classifyManagementError: a non-Error value still resolves to failure, not a throw', () => {
  const result = classifyManagementError('not an error object');
  assert.equal(result.kind, 'failure');
});
