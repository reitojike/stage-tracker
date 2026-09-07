import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/infrastructure/supabase/database.types.ts';
import { readLocalSupabaseStatus } from '../rls/support/localSupabase.ts';
import { createAnonymousClient, deleteUser, provisionUser } from './support/authActors.ts';

// Real local Supabase tests for the passkey credential-management boundary
// (Issue #106). What this file does NOT (and, in this repo's current test
// infrastructure, cannot) cover: the actual WebAuthn ceremony that
// registerPasskey()/signInWithPasskey() run under the hood
// (navigator.credentials.create()/get()) only exists in a real browser -
// see test/auth/support/signInThroughApp.ts and this repo's package.json,
// which has no Playwright/Puppeteer-style browser automation dependency.
// That ceremony is manual-smoke-only (see Issue #106's Phase 1 checkpoint
// comment and this PR's completion report).
//
// What *is* real here: auth.passkey.list()/delete() against the actual
// local Supabase Auth server, with the experimental.passkey flag this
// repo's app clients set (src/infrastructure/supabase/serverClient.ts) -
// proving the flag/endpoint/session boundary actually works, independent
// of the ceremony itself.

const status = readLocalSupabaseStatus();

function createPasskeyEnabledAnonymousClient() {
  return createClient<Database>(status.apiUrl, status.anonKey, {
    auth: { experimental: { passkey: true } },
  });
}

const createdUserIds: string[] = [];

after(async () => {
  const results = await Promise.allSettled(createdUserIds.map((id) => deleteUser(id)));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    const messages = failures.map((failure) =>
      failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
    );
    throw new Error(`test user cleanup failed:\n${messages.join('\n')}`);
  }
});

void test('an unauthenticated caller cannot list passkeys', async () => {
  const anon = createPasskeyEnabledAnonymousClient();
  const { data, error } = await anon.auth.passkey.list();

  assert.ok(error, 'expected passkey.list() to reject without a session');
  assert.equal(data, null);
});

void test('an unauthenticated caller cannot delete a passkey', async () => {
  const anon = createPasskeyEnabledAnonymousClient();
  const { error } = await anon.auth.passkey.delete({
    passkeyId: '00000000-0000-0000-0000-000000000000',
  });

  assert.ok(error, 'expected passkey.delete() to reject without a session');
});

void test('an authenticated user with no registered passkeys sees an empty list, not an error', async () => {
  const { user, email } = await provisionUser('passkey-list');
  createdUserIds.push(user.id);

  // This test only needs an authenticated session, not a completed
  // sign-in flow through the app - admin.generateLink gives one directly
  // without a mailbox round trip, unlike the app-level tests that go
  // through Mailpit (test/auth/support/mailpit.ts) to prove the UI's own
  // confirm route.
  const admin = createClient<Database>(status.apiUrl, status.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  assert.equal(linkError, null);

  const passkeyClient = createPasskeyEnabledAnonymousClient();
  const { error: verifyError } = await passkeyClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'email',
  });
  assert.equal(verifyError, null);

  const { data, error } = await passkeyClient.auth.passkey.list();
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

void test('the passkey API rejects when experimental.passkey is not enabled on the client', async () => {
  // Guards the opt-in this app's own clients rely on
  // (src/infrastructure/supabase/browserClient.ts,
  // src/infrastructure/supabase/serverClient.ts): forgetting the flag must
  // fail loudly, not silently no-op. list() is `async`, so the guard
  // surfaces as a rejected Promise, not a synchronous throw.
  const withoutFlag = createAnonymousClient();
  await assert.rejects(async () => {
    await withoutFlag.auth.passkey.list();
  });
});
