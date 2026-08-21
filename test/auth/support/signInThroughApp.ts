import assert from 'node:assert/strict';
import type { AppServer } from './appServer.ts';
import { createAnonymousClient, provisionUser } from './authActors.ts';
import { waitForMagicLinkToken } from './mailpit.ts';

export interface SignedInSession {
  cookie: string;
  response: Response;
  userId: string;
}

/**
 * Completes a real magic-link sign-in through the app's own /auth/confirm
 * route (not a Supabase SDK shortcut), returning the session cookie a
 * subsequent authenticated request can send. Shared by any test that needs
 * a real signed-in session against the app under test - route-protection
 * assertions (test/auth/routeProtection.test.ts) and feature-level
 * acceptance tests (e.g. test/auth/catalogAccess.test.ts) alike.
 *
 * The caller owns cleanup of the returned `userId` (e.g. via its own
 * `after()`/`deleteUser`), since how many sessions a test creates and when
 * they should be torn down is test-specific.
 */
export async function signInThroughApp(app: AppServer, next?: string): Promise<SignedInSession> {
  const { user, email } = await provisionUser('app-session');

  const { error } = await createAnonymousClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  assert.equal(error, null);

  const { tokenHash, type } = await waitForMagicLinkToken(email);
  const confirmUrl = new URL(`${app.baseUrl}/auth/confirm`);
  confirmUrl.searchParams.set('token_hash', tokenHash);
  confirmUrl.searchParams.set('type', type);
  if (next !== undefined) {
    confirmUrl.searchParams.set('next', next);
  }

  const response = await fetch(confirmUrl, { redirect: 'manual' });
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .filter((entry): entry is string => entry !== undefined)
    .join('; ');

  return { cookie, response, userId: user.id };
}
