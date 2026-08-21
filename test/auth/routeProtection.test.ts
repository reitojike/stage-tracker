import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startAppServer, type AppServer } from './support/appServer.ts';
import { createAnonymousClient, deleteUser, provisionUser } from './support/authActors.ts';
import { waitForMagicLinkToken } from './support/mailpit.ts';

// Route-protection tests that exercise the real Next.js app over HTTP.
// The authenticated-only boundary lives in src/proxy.ts, so it cannot be
// proven by Supabase-level assertions alone - only an actual request can
// show whether a protected route is reachable without a session.

let app: AppServer;
const createdUserIds: string[] = [];

before(async () => {
  app = await startAppServer();
});

after(async () => {
  await app.stop();
  const results = await Promise.allSettled(createdUserIds.map((id) => deleteUser(id)));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    const messages = failures.map((failure) =>
      failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
    );
    throw new Error(`test user cleanup failed:\n${messages.join('\n')}`);
  }
});

function locationOf(response: Response): string {
  const location = response.headers.get('location');
  assert.ok(location !== null, 'expected a Location header on a redirect');
  return location;
}

/** Completes a real magic-link sign-in through the app's own /auth/confirm route. */
async function signInThroughApp(next?: string): Promise<{ cookie: string; response: Response }> {
  const { user, email } = await provisionUser('route-guard');
  createdUserIds.push(user.id);

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

  return { cookie, response };
}

// --- Unauthenticated boundary ---

void test('an unauthenticated request to a protected route is redirected to sign-in', async () => {
  const response = await fetch(`${app.baseUrl}/`, { redirect: 'manual' });

  assert.equal(response.status, 307);
  assert.equal(new URL(locationOf(response), app.baseUrl).pathname, '/sign-in');
});

void test('a route with no page still does not bypass the auth boundary', async () => {
  // Default-deny: an unknown path must be guarded too, so adding a route
  // later cannot silently escape the boundary by omission.
  const response = await fetch(`${app.baseUrl}/events/some-future-page`, { redirect: 'manual' });

  assert.equal(response.status, 307);
  assert.equal(new URL(locationOf(response), app.baseUrl).pathname, '/sign-in');
});

void test('the sign-in route is reachable without a session', async () => {
  const response = await fetch(`${app.baseUrl}/sign-in`, { redirect: 'manual' });

  assert.equal(response.status, 200);
});

// --- Authenticated boundary ---

void test('a confirmed magic link establishes a session that reaches the protected route', async () => {
  const { cookie, response } = await signInThroughApp();

  assert.equal(response.status, 307);
  assert.equal(new URL(locationOf(response), app.baseUrl).pathname, '/');
  assert.notEqual(cookie, '', 'expected /auth/confirm to set session cookies');

  const protectedResponse = await fetch(`${app.baseUrl}/`, {
    headers: { cookie },
    redirect: 'manual',
  });
  assert.equal(protectedResponse.status, 200);
});

// --- Failure handling ---

void test('an invalid magic link is sent to a distinguishable error state, not an empty page', async () => {
  const confirmUrl = new URL(`${app.baseUrl}/auth/confirm`);
  confirmUrl.searchParams.set('token_hash', 'not-a-real-token-hash');
  confirmUrl.searchParams.set('type', 'email');

  const response = await fetch(confirmUrl, { redirect: 'manual' });

  assert.equal(response.status, 307);
  const location = new URL(locationOf(response), app.baseUrl);
  assert.equal(location.pathname, '/sign-in');
  assert.equal(location.searchParams.get('error'), 'link_expired');
});

// --- Open redirect ---

void test('a confirm link cannot redirect to an external origin', async () => {
  const { response } = await signInThroughApp('https://evil.example/phish');

  assert.equal(response.status, 307);
  const location = new URL(locationOf(response), app.baseUrl);
  assert.equal(location.origin, new URL(app.baseUrl).origin);
  assert.equal(location.pathname, '/');
});
