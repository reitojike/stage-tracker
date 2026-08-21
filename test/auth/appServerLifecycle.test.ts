import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startAppServer } from './support/appServer.ts';

// Regression coverage for the test harness itself (test/auth/support/appServer.ts),
// not a product/Issue #20 behavior: a prior version only sent SIGTERM to the
// immediate `npx next dev` process on POSIX. `next dev` (via Turbopack) forks
// a separate next-server worker as a grandchild, which survived that signal
// and kept holding the project's on-disk dev lock (`.next/dev/lock`) - so
// the *next* test file's own startAppServer() would collide with the
// leftover server ("Another next dev server is already running") instead of
// starting a fresh one. This is exactly the sequence every real test:auth
// run depends on (one file's app server stops, the next file's starts), so
// it is proven directly here rather than only indirectly via other files
// happening to run in the right order.

void test('a second app server starts successfully in the same project directory after the first one is stopped', async () => {
  const first = await startAppServer();
  const firstResponse = await fetch(`${first.baseUrl}/sign-in`, { redirect: 'manual' });
  assert.equal(firstResponse.status, 200, 'sanity: the first server should actually be serving');

  await first.stop();

  // If a leftover process from `first` still held the project's dev lock,
  // this would either throw ("Another next dev server is already
  // running") or hang until the 120s readiness deadline - either way,
  // this test itself would fail/time out rather than silently pass.
  const second = await startAppServer();
  try {
    const secondResponse = await fetch(`${second.baseUrl}/sign-in`, { redirect: 'manual' });
    assert.equal(secondResponse.status, 200, 'the second server should also actually be serving');
    assert.notEqual(second.baseUrl, first.baseUrl, 'sanity: each server gets its own port');
  } finally {
    await second.stop();
  }
});

void test('stopping an already-stopped app server does not throw', async () => {
  const server = await startAppServer();
  await server.stop();
  // The process (and, on POSIX, its process group) is already gone here -
  // a second stop() must still resolve cleanly rather than reject, since
  // real callers' after() hooks may run alongside other cleanup that also
  // ends up stopping the same server.
  await assert.doesNotReject(server.stop());
});
