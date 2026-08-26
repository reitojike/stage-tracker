import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  assertDependenciesInstalled,
  isHealthyReadyResponse,
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
  assert.equal(isHealthyReadyResponse(307), true, 'a redirect is a healthy response');
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
