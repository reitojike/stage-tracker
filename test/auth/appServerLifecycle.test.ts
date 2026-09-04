import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startAppServer } from './support/appServer.ts';

// Regression coverage for the test harness itself (test/auth/support/appServer.ts),
// not a product/Issue #20 behavior: a prior version only sent SIGTERM to the
// immediate `npx next dev` process on POSIX. `next dev` (via Turbopack) forked
// a separate next-server worker as a grandchild, which survived that signal
// and kept holding the project's on-disk dev lock (`.next/dev/lock`) - so
// the *next* test file's own startAppServer() would collide with the
// leftover server ("Another next dev server is already running") instead of
// starting a fresh one.
//
// Issue #286 moved the harness to `next start`, which forks no worker and
// takes no such lock, so a leftover process would now show up as a held port
// rather than a held lock. The sequence being proven is unchanged and is the
// one every real test:auth run depends on (one file's app server stops, the
// next file's starts), so it stays proven directly here rather than only
// indirectly via other files happening to run in the right order.

void test('a second app server starts successfully in the same project directory after the first one is stopped', async () => {
  const first = await startAppServer();
  const firstResponse = await fetch(`${first.baseUrl}/sign-in`, { redirect: 'manual' });
  assert.equal(firstResponse.status, 200, 'sanity: the first server should actually be serving');

  await first.stop();

  // If a leftover process from `first` were still running, this would hang
  // until the 120s readiness deadline (or, before Issue #286's move to
  // `next start`, throw "Another next dev server is already running") -
  // either way, this test itself would fail/time out rather than silently
  // pass.
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
