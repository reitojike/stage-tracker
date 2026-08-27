import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startAppServer, type AppServer } from './support/appServer.ts';
import { createAnonymousClient, deleteUser, provisionUser } from './support/authActors.ts';
import { waitForMagicLinkToken } from './support/mailpit.ts';
import {
  actionRedirectTarget,
  applySetCookies,
  submitServerAction,
} from './support/serverAction.ts';
import { signInThroughApp as signInThroughAppUntracked } from './support/signInThroughApp.ts';

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

/**
 * This file's own tests create/tear down each session's user via
 * `createdUserIds`, so wrap the shared signInThroughApp (which leaves
 * cleanup to its caller) to track it the same way every call site here
 * already expects - registered via onUserProvisioned as soon as the user
 * exists, not only after the whole sign-in flow succeeds, so a later
 * failure (OTP send, mailpit timeout) still leaves the user tracked for
 * cleanup.
 */
async function signInThroughApp(next?: string) {
  return signInThroughAppUntracked(app, {
    next,
    onUserProvisioned: (userId) => {
      createdUserIds.push(userId);
    },
  });
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

void test('an application path ending in an asset extension does not bypass the boundary', async () => {
  // A file-extension exclusion in the matcher would let these skip the
  // proxy entirely (404 instead of a redirect), so assert each is still
  // sent to sign-in while unauthenticated.
  const paths = [
    '/events/some-future-page.png',
    '/events/some-future-page.svg',
    '/report.jpeg',
    '/a/b/c.webp',
  ];

  for (const path of paths) {
    const response = await fetch(`${app.baseUrl}${path}`, { redirect: 'manual' });
    assert.equal(response.status, 307, `${path} should be guarded`);
    assert.equal(new URL(locationOf(response), app.baseUrl).pathname, '/sign-in', path);
  }
});

void test('descendants of a public path are not themselves public', async () => {
  // The allowlist is exact-match. A prefix rule would make any route
  // added under /sign-in/... or /auth/confirm/... public without ever
  // being added to the allowlist.
  for (const path of ['/sign-in/internal', '/auth/confirm/debug']) {
    const response = await fetch(`${app.baseUrl}${path}`, { redirect: 'manual' });
    assert.equal(response.status, 307, `${path} should be guarded`);
    assert.equal(new URL(locationOf(response), app.baseUrl).pathname, '/sign-in', path);
  }
});

void test('Next internal asset paths remain excluded from the boundary', async () => {
  // The explicit exclusions must survive: if these started being proxied,
  // an unauthenticated request would be redirected to /sign-in instead of
  // being served/404ed by Next itself.
  for (const path of ['/_next/static/chunks/does-not-exist.js', '/favicon.ico']) {
    const response = await fetch(`${app.baseUrl}${path}`, { redirect: 'manual' });
    assert.notEqual(response.status, 307, `${path} should not be redirected by the proxy`);
  }
});

void test('the sign-in route is reachable without a session and renders its form', async () => {
  const response = await fetch(`${app.baseUrl}/sign-in`, { redirect: 'manual' });

  assert.equal(response.status, 200);

  // A 200 alone would still pass if the form failed to render, so assert
  // the field a user actually needs is present.
  const html = await response.text();
  assert.match(html, /name="email"/);
  assert.match(html, /メールアドレス/);
});

void test('an auth failure is shown as a distinct error state, not an empty one', async () => {
  const response = await fetch(`${app.baseUrl}/sign-in?error=link_expired`, {
    redirect: 'manual',
  });

  assert.equal(response.status, 200);
  const html = await response.text();
  // docs/ux-ui.md requires auth failure to be distinguishable from an
  // ordinary empty/signed-out state.
  assert.match(html, /サインインリンクが無効です/);
  assert.match(html, /role="alert"/);
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

void test('a confirm link with control characters in next still signs the user in', async () => {
  // CR/LF reaching the Location header makes the runtime fail the whole
  // response (500), which would consume the user's one-time token and
  // leave them with no session.
  const { cookie, response } = await signInThroughApp('/\r\nSet-Cookie: evil=1');

  assert.equal(response.status, 307);
  const location = new URL(locationOf(response), app.baseUrl);
  assert.equal(location.pathname, '/');
  assert.equal(
    response.headers.getSetCookie().some((entry) => entry.includes('evil=1')),
    false,
    'no injected cookie may be set',
  );
  assert.notEqual(cookie, '', 'the sign-in must still establish a session');
});

void test('the confirm route only consumes the magic-link OTP type', async () => {
  // Sign-in must not double as a consumer of recovery / invite /
  // email_change tokens; those flows need their own route and UI.
  const { user, email } = await provisionUser('otp-type');
  createdUserIds.push(user.id);

  const { error } = await createAnonymousClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  assert.equal(error, null);
  const { tokenHash } = await waitForMagicLinkToken(email);

  const confirmUrl = new URL(`${app.baseUrl}/auth/confirm`);
  confirmUrl.searchParams.set('token_hash', tokenHash);
  confirmUrl.searchParams.set('type', 'recovery');

  const response = await fetch(confirmUrl, { redirect: 'manual' });

  assert.equal(response.status, 307);
  const location = new URL(locationOf(response), app.baseUrl);
  assert.equal(location.pathname, '/sign-in');
  assert.equal(location.searchParams.get('error'), 'link_expired');
  assert.equal(
    response.headers.getSetCookie().length,
    0,
    'an unsupported OTP type must not establish a session',
  );
});

// --- Server Actions, driven the way a browser drives them ---

void test('the sign-in action gives an identical response for known and unknown addresses', async () => {
  // The enumeration guard lives in the Server Action's handling of the
  // result, so it has to be exercised through the action itself. Testing
  // requestMagicLink alone would stay green if the action started
  // branching on account existence again.
  const { user, email } = await provisionUser('enum-known');
  createdUserIds.push(user.id);

  const known = await submitServerAction(app.baseUrl, '/sign-in', { email });
  const unknown = await submitServerAction(app.baseUrl, '/sign-in', {
    email: `enum-unknown-${String(Date.now())}@example.test`,
  });

  assert.equal(known.status, unknown.status, 'status must not distinguish the two');

  const knownTarget = actionRedirectTarget(known);
  const unknownTarget = actionRedirectTarget(unknown);
  assert.ok(knownTarget !== null, 'expected the sign-in action to redirect');
  assert.equal(knownTarget, unknownTarget, 'redirect target must not distinguish the two');
  // Acknowledges the request only; it must not claim a link was sent.
  assert.match(knownTarget, /requested=1/);
  assert.doesNotMatch(knownTarget, /sent=1/);

  // Status and Location alone would miss account state leaking through
  // another header or the body, so compare the rest of the observable
  // response too. (Timing is a side channel a deterministic test cannot
  // close; it is out of scope here rather than silently claimed.)
  const ignoredHeaders = new Set(['date', 'x-nextjs-date', 'content-length', 'etag']);
  const comparableHeaders = (response: Response): string =>
    [...response.headers]
      .filter(([name]) => !ignoredHeaders.has(name.toLowerCase()))
      .map(([name, value]) => `${name.toLowerCase()}: ${value}`)
      .sort()
      .join('\n');

  assert.equal(
    comparableHeaders(known),
    comparableHeaders(unknown),
    'response headers must not distinguish the two',
  );
  assert.equal(
    await known.text(),
    await unknown.text(),
    'response body must not distinguish the two',
  );
});

void test('the sign-out action clears the session for subsequent requests', async () => {
  // Drives the app's own sign-out action rather than the SDK, so a
  // regression that redirects without clearing cookies is caught. The
  // sign-out form itself now renders on /mypage, not / (Issue #159 moved
  // it off Home), so that's where this reads the server action field from.
  const { cookie } = await signInThroughApp();

  const before = await fetch(`${app.baseUrl}/mypage`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(before.status, 200, 'sanity: the session should work beforehand');

  const signOut = await submitServerAction(app.baseUrl, '/mypage', {}, cookie);
  // Merge Set-Cookie into the existing jar the way a browser does. Using
  // only the response's cookies would drop the session cookie outright,
  // so a sign-out that never cleared it would still appear to work.
  const afterSignOut = applySetCookies(cookie, signOut);

  const after = await fetch(`${app.baseUrl}/`, {
    headers: { cookie: afterSignOut },
    redirect: 'manual',
  });
  assert.equal(after.status, 307, 'a signed-out session must not reach a protected route');
  assert.equal(new URL(locationOf(after), app.baseUrl).pathname, '/sign-in');
});

void test('an invalidated session is rejected at the HTTP boundary, not just by the SDK', async () => {
  // Guards against the proxy ever trusting a locally-decoded JWT's exp
  // instead of re-validating on each request: the cookie below is still
  // unexpired, but the account behind it no longer exists. Asserting this
  // only through the Supabase SDK would leave the proxy's own behaviour
  // unproven.
  const { cookie, userId } = await signInThroughApp();

  const before = await fetch(`${app.baseUrl}/`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(before.status, 200, 'sanity: the session should work beforehand');

  await deleteUser(userId);
  // after() must not try to delete it a second time.
  const index = createdUserIds.indexOf(userId);
  if (index >= 0) {
    createdUserIds.splice(index, 1);
  }

  const after = await fetch(`${app.baseUrl}/`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(after.status, 307, 'an invalidated session must not reach a protected route');
  assert.equal(new URL(locationOf(after), app.baseUrl).pathname, '/sign-in');
});
