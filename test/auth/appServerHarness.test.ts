import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  assertDependenciesInstalled,
  isHealthyReadyResponse,
  stopProcess,
  waitForExit,
} from './support/appServer.ts';

// Deterministic, no-Supabase-required regression coverage for the test
// harness itself (test/auth/support/appServer.ts) - specifically for the
// two consumer-local weaknesses recorded in Issue #44 (readiness treating a
// broken app as ready, and stop() being able to hang indefinitely). These
// are exercised as pure logic here, without spawning a real `next dev`
// process tree, so they stay fast and do not depend on platform-specific
// process-tree behavior to prove the *fix*.

void test('isHealthyReadyResponse treats 5xx as not ready', () => {
  assert.equal(isHealthyReadyResponse(200), true, '200 is a healthy response');
  assert.equal(isHealthyReadyResponse(404), true, 'a routed 4xx still proves the app is serving');
  assert.equal(
    isHealthyReadyResponse(500),
    false,
    'a 500 means the app is broken, not ready (Issue #44 / #30: missing node_modules made every route 500 forever)',
  );
  assert.equal(
    isHealthyReadyResponse(503),
    false,
    '5xx generally means the app is broken, not ready',
  );
  // Not a case this ever actually sees today (`/sign-in` never redirects for
  // an anonymous request), but documented because it is easy to get wrong:
  // startAppServer() fetches with `redirect: 'manual'`, and per the Fetch
  // spec that surfaces a would-be-redirect response as an *opaque* one with
  // status 0, not the literal 3xx code - status 0 is currently (correctly)
  // treated as not ready, the same as "not listening yet".
  assert.equal(
    isHealthyReadyResponse(0),
    false,
    'an opaque redirect response is not treated as ready',
  );
});

void test('waitForExit resolves immediately when the target has already exited', async () => {
  const alreadyExited = { exitCode: 0, signalCode: null, once: () => undefined };
  await waitForExit(alreadyExited, 50);
});

void test('waitForExit resolves once the target emits exit', async () => {
  const emitter = new EventEmitter();
  const target = {
    exitCode: null,
    signalCode: null,
    once: (event: 'exit', listener: () => void) => {
      emitter.once(event, listener);
    },
  };

  const settled = waitForExit(target, 5_000);
  emitter.emit('exit');
  await settled;
});

void test('waitForExit rejects with a diagnostic instead of hanging when exit never fires', async () => {
  const target = { exitCode: null, signalCode: null, once: () => undefined };

  // This is the direct regression proof for the #31 symptom: a kill attempt
  // that silently fails to reach every descendant must not leave stop()
  // awaiting an 'exit' event that never comes (previously observed as a
  // 24+ minute hang on Windows).
  await assert.rejects(waitForExit(target, 20), /did not exit within 20ms/);
});

/**
 * Runs `fn` with `process.platform` temporarily overridden, restoring it
 * afterwards regardless of outcome. `stopProcess`'s platform branching all
 * happens synchronously in its body (before any awaited work), so the
 * override only needs to be in place for the synchronous call itself - it
 * is safe to restore before the returned promise settles.
 */
function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return fn();
  } finally {
    if (original) {
      Object.defineProperty(process, 'platform', original);
    }
  }
}

void test('stopProcess still sends the POSIX process-group kill when the immediate child has already exited', async (t) => {
  // This is the direct regression proof for the bug a reviewer caught in
  // this same change: spawnNextDev's shim can exit while the next-server
  // grandchild it forked (same process group) is still alive holding the
  // port and .next/dev/lock. A stopProcess() that only kills when the
  // immediate child looks alive would silently leave that grandchild
  // running - worse than the original 24min hang, because it isn't even
  // visible as a failure. Forcing 'linux' here (rather than skipping on
  // non-POSIX hosts) keeps this meaningful on both Windows dev machines and
  // Linux CI.
  const killMock = t.mock.method(process, 'kill', () => true);
  const alreadyExitedChild = {
    pid: 4242,
    exitCode: 0,
    signalCode: null,
    once: () => undefined,
    kill: () => true,
  };

  await withPlatform('linux', () => stopProcess(alreadyExitedChild));

  assert.equal(killMock.mock.calls.length, 1, 'the process-group kill must still be attempted');
  const [call] = killMock.mock.calls;
  assert.ok(call, 'the process-group kill must still be attempted');
  assert.deepEqual(call.arguments, [-4242, 'SIGTERM']);
});

void test('assertDependenciesInstalled throws a clear diagnostic when node_modules is missing', () => {
  const emptyWorktree = mkdtempSync(path.join(tmpdir(), 'app-server-harness-no-deps-'));
  assert.throws(
    () => {
      assertDependenciesInstalled(emptyWorktree);
    },
    /npm ci/,
    'a worktree without its own npm ci should fail fast with an actionable message',
  );
});

void test('assertDependenciesInstalled does not throw once dependencies are present', () => {
  const worktree = mkdtempSync(path.join(tmpdir(), 'app-server-harness-with-deps-'));
  const nextDir = path.join(worktree, 'node_modules', 'next');
  mkdirSync(nextDir, { recursive: true });
  writeFileSync(path.join(nextDir, 'package.json'), '{}');

  assertDependenciesInstalled(worktree);
});
