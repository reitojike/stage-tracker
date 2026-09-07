import assert from 'node:assert/strict';
import type { AppServer } from './appServer.ts';
import { createAnonymousClient, provisionUser } from './authActors.ts';
import { waitForMagicLinkToken } from './mailpit.ts';

export interface SignedInSession {
  cookie: string;
  response: Response;
  userId: string;
  /** The provisioned account's registered email address. Exposed for the
   * write journeys (Issue #278), where one actor targets another through
   * #55's exact-registered-email boundary (invitation, schedule share) and
   * therefore needs the counterpart's actual address - never a raw user
   * id, which that boundary deliberately does not accept. */
  email: string;
}

export interface SignInThroughAppOptions {
  /** Forwarded to /auth/confirm as the post-sign-in redirect target. */
  next?: string;
  /**
   * Prefix for the generated account email (default `app-session`), so a
   * user left behind by a failed run names the test that created it.
   */
  emailPrefix?: string;
  /**
   * Called the instant the Supabase auth user is provisioned - before the
   * OTP send / mailpit poll / confirm fetch that follow, any of which can
   * fail (rate limit, mailpit timeout, network error). Register the
   * user's cleanup here rather than from the returned `userId`, so a
   * caller's after() still deletes it even when this function throws
   * partway through.
   */
  onUserProvisioned?: (userId: string) => void;
}

/**
 * Completes a real magic-link sign-in through the app's own /auth/confirm
 * route (not a Supabase SDK shortcut), returning the session cookie a
 * subsequent authenticated request can send. Shared by any test that needs
 * a real signed-in session against the app under test - route-protection
 * assertions (test/auth/routeProtection.test.ts) and feature-level
 * acceptance tests (e.g. test/auth/catalogAccess.test.ts) alike.
 */
export async function signInThroughApp(
  app: AppServer,
  options: SignInThroughAppOptions = {},
): Promise<SignedInSession> {
  const { user, email } = await provisionUser(options.emailPrefix ?? 'app-session');
  options.onUserProvisioned?.(user.id);

  const { error } = await createAnonymousClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  assert.equal(error, null);

  const { tokenHash, type } = await waitForMagicLinkToken(email);
  const confirmUrl = new URL(`${app.baseUrl}/auth/confirm`);
  confirmUrl.searchParams.set('token_hash', tokenHash);
  confirmUrl.searchParams.set('type', type);
  if (options.next !== undefined) {
    confirmUrl.searchParams.set('next', options.next);
  }

  const response = await fetch(confirmUrl, { redirect: 'manual' });
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .filter((entry): entry is string => entry !== undefined)
    .join('; ');

  return { cookie, response, userId: user.id, email };
}
