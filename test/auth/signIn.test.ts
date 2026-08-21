import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { requestMagicLink } from '../../src/infrastructure/supabase/magicLink.ts';
import {
  createAnonymousClient,
  deleteUser,
  provisionUser,
  userExists,
} from './support/authActors.ts';
import { waitForMagicLinkToken } from './support/mailpit.ts';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2)}@example.test`;
}

// Real local Supabase/Mailpit tests for the auth foundation (Issue #11).
// These exercise the actual product-facing flow: an admin-provisioned
// account (no password - public signup is disabled, see
// supabase/config.toml) signs in by requesting a magic link, retrieving
// it from the local Mailpit capture inbox the same way a real mailbox
// would receive it, and completing verifyOtp via the token_hash/type
// pair carried by supabase/templates/magic_link.html.

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

void test('public self-service signup is rejected', async () => {
  const anon = createAnonymousClient();
  const email = uniqueEmail('selfsignup');

  const { error } = await anon.auth.signUp({ email, password: 'Str0ng-Test-Passw0rd!' });

  assert.ok(error, 'expected signUp to be rejected while public signup is disabled');
  assert.equal(
    await userExists(email),
    false,
    'a rejected signUp must not leave an account behind',
  );
});

void test('the application sign-in path rejects an unknown email without creating an account', async () => {
  const email = uniqueEmail('unknown');

  // Goes through requestMagicLink - the same function the sign-in Server
  // Action calls - rather than calling signInWithOtp directly. Supplying
  // `shouldCreateUser: false` here in the test would prove only that the
  // Supabase SDK honours the option, and would stay green even if the
  // application stopped passing it.
  const { ok } = await requestMagicLink(createAnonymousClient(), email);

  assert.equal(ok, false, 'expected the sign-in path to reject an email with no account');
  // The rejection alone is not enough: assert the side effect too, so a
  // silently-created account would fail this test rather than pass it.
  assert.equal(
    await userExists(email),
    false,
    'the sign-in path must not silently create an account',
  );
});

void test('an invalid magic-link token is a distinguishable failure, not an empty session', async () => {
  const anon = createAnonymousClient();

  const { data, error } = await anon.auth.verifyOtp({
    token_hash: 'definitely-not-a-valid-token-hash',
    type: 'email',
  });

  // Must surface as an error the app can route to ?error=link_expired -
  // not as a success carrying a null session, which the UI would render
  // as an ordinary signed-out state.
  assert.ok(error, 'expected verifyOtp to reject an invalid token hash');
  assert.equal(data.session, null);
});

void test('admin-provisioned user completes a magic-link sign-in and can sign out', async () => {
  const { user, email } = await provisionUser('auth-flow');
  createdUserIds.push(user.id);

  const anon = createAnonymousClient();

  const { error: otpError } = await anon.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  assert.equal(otpError, null);

  const { tokenHash, type } = await waitForMagicLinkToken(email);

  const { error: verifyError } = await anon.auth.verifyOtp({ token_hash: tokenHash, type });
  assert.equal(verifyError, null);

  const { data: signedInData, error: getUserError } = await anon.auth.getUser();
  assert.equal(getUserError, null);
  assert.equal(signedInData.user.email, email);

  const { error: signOutError } = await anon.auth.signOut();
  assert.equal(signOutError, null);

  const { data: signedOutData } = await anon.auth.getUser();
  assert.equal(signedOutData.user, null);
});
