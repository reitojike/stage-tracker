import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createAnonymousClient, deleteUser, provisionUser } from './support/authActors.ts';
import { waitForMagicLinkToken } from './support/mailpit.ts';

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

void test('sign-in rejects an unknown email without creating an account', async () => {
  const anon = createAnonymousClient();
  const email = `unknown-${String(Date.now())}-${Math.random().toString(36).slice(2)}@example.test`;

  const { error } = await anon.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });

  assert.ok(error, 'expected signInWithOtp to reject an email with no account');
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
