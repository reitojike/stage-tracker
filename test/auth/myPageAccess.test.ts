import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { grantCatalogCreator } from '../rls/support/testActors.ts';
import { startAppServer, type AppServer } from './support/appServer.ts';
import { deleteUser } from './support/authActors.ts';
import { signInThroughApp } from './support/signInThroughApp.ts';

// Real end-to-end acceptance evidence for My Page's "予定とイベント" section
// (Issue #193): a real Next.js app server and a real signed-in session (see
// signInThroughApp), exercising the actual designated-creator boundary
// (public.catalog_creators / isDesignatedCatalogCreator) rather than a
// mock. My Page renders synchronously (no client-gated hydration marker the
// way CatalogView has - see test/auth/catalogAccess.test.ts's own comment
// on why that file needs a real browser for some of its assertions), so
// plain fetch is sufficient here.

let app: AppServer;
const createdViewerIds: string[] = [];

before(async () => {
  app = await startAppServer();
});

after(async () => {
  await app.stop();
  const results = await Promise.allSettled(createdViewerIds.map((id) => deleteUser(id)));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    const messages = failures.map((failure) =>
      failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
    );
    throw new Error(`cleanup failed:\n${messages.join('\n')}`);
  }
});

interface SignedInSession {
  cookie: string;
  userId: string;
}

/** A real signed-in session via the app's own magic-link flow, tracked for
 * cleanup as soon as the user is provisioned (see signInThroughApp's own
 * doc comment on why cleanup must not wait for the full flow to resolve). */
async function signedInSession(): Promise<SignedInSession> {
  const session = await signInThroughApp(app, {
    onUserProvisioned: (userId) => {
      createdViewerIds.push(userId);
    },
  });
  assert.notEqual(session.cookie, '', 'expected a real session cookie');
  return { cookie: session.cookie, userId: session.userId };
}

async function myPageHtml(cookie: string): Promise<string> {
  const response = await fetch(`${app.baseUrl}/mypage`, {
    headers: { cookie },
    redirect: 'manual',
  });
  assert.equal(response.status, 200);
  return response.text();
}

// --- Issue #193: 予定とイベント section ---

void test('an ordinary authenticated user sees both always-visible rows, linking to /schedule and /catalog/invitations', async () => {
  const { cookie } = await signedInSession();
  const html = await myPageHtml(cookie);

  assert.match(html, /個人予定を管理/);
  assert.match(html, /招待一覧/);
  assert.match(html, /href="\/schedule"/);
  assert.match(html, /href="\/catalog\/invitations"/);
});

void test('an authenticated user who is not a designated catalog creator does not see "イベントを追加"', async () => {
  const { cookie } = await signedInSession();
  const html = await myPageHtml(cookie);

  assert.doesNotMatch(html, /イベントを追加/);
});

void test('a designated catalog creator additionally sees "イベントを追加", linking to the event-create route', async () => {
  const { cookie, userId } = await signedInSession();
  await grantCatalogCreator(userId);

  const html = await myPageHtml(cookie);

  assert.match(html, /イベントを追加/);
  assert.match(html, /href="\/catalog\/events\/new\?month=/);
});

void test('the Account section (email + sign-out) and Passkey section still render, unaffected by the new section', async () => {
  const { cookie } = await signedInSession();
  const html = await myPageHtml(cookie);

  assert.match(html, /サインイン中:/);
  assert.match(html, /サインアウト/);
  assert.match(html, /Passkey/);
});
