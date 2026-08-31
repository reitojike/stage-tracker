import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  cleanupFailedLaunch,
  combineStartupAndCleanupError,
  readDevToolsPort,
  terminateChild,
  type TerminableChild,
} from './support/browserPage.ts';
import { runCleanupTasks } from './support/cleanupTasks.ts';

// Deterministic, no-real-Chrome-required regression coverage for the
// Chrome/CDP startup-failure lifecycle hardening (Issue #259): a readiness
// timeout or early exit previously left the spawned Chrome child
// un-terminated (launchBrowser() had not returned a Browser handle to
// close it), and catalogAccess.test.ts's after() unconditionally assumed
// browser/page had been initialized - together turning one flaky Chrome
// startup into an orphaned process plus a secondary `undefined.close()`
// TypeError that kept `node --test` alive until the Database job's 20-
// minute timeout.
//
// readDevToolsPort is proven here against real (but trivial, Chrome-free)
// `node -e` child processes rather than a hand-written fake - it is
// deterministic and fast (short timeouts), and exercises the actual
// node:child_process event contract (`exit`, `error`, stderr data) rather
// than an approximation of it. cleanupFailedLaunch/runCleanupTasks are
// proven against fakes, mirroring test/auth/appServerHarness.test.ts's own
// approach for the analogous Next-dev-server hardening.

function nodeChild(script: string) {
  return spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'ignore', 'pipe'] });
}

// --- readDevToolsPort: normal success ---

void test('readDevToolsPort resolves with the reported port once Chrome would report one', async () => {
  const child = nodeChild(
    "process.stderr.write('DevTools listening on ws://127.0.0.1:54321/devtools/browser/abc\\n'); setInterval(() => {}, 1000);",
  );
  try {
    const port = await readDevToolsPort(child, 5_000);
    assert.equal(port, 54321);
  } finally {
    child.kill('SIGKILL');
  }
});

// --- readDevToolsPort: the port line survives bounded-stderr truncation ---

void test('readDevToolsPort still resolves when the DevTools line arrives surrounded by enough other stderr output to have been truncated away by a naive "truncate, then match" implementation', async () => {
  // Padding is sized (and written in one process.stderr.write call, so it
  // is very likely delivered as a single 'data' chunk) so that a
  // truncate-before-match implementation's `stderr.slice(-4000)` would
  // evict the DevTools line entirely before ever attempting to match it:
  // leadingPadding pushes the line past the start of the retained window,
  // and trailingPadding (> 4000 chars on its own) pushes the line's end
  // past the retained window too.
  const leadingPadding = 'A'.repeat(3_000);
  const devToolsLine = 'DevTools listening on ws://127.0.0.1:54322/devtools/browser/abc\n';
  const trailingPadding = 'B'.repeat(4_500);
  const child = nodeChild(
    `process.stderr.write(${JSON.stringify(leadingPadding + devToolsLine + trailingPadding)}); setInterval(() => {}, 1000);`,
  );
  try {
    const port = await readDevToolsPort(child, 5_000);
    assert.equal(port, 54322);
  } finally {
    child.kill('SIGKILL');
  }
});

// --- readDevToolsPort: readiness timeout ---

void test('readDevToolsPort rejects with a bounded timeout diagnostic when no port is ever reported', async () => {
  const child = nodeChild('setInterval(() => {}, 1000);');
  try {
    await assert.rejects(
      readDevToolsPort(child, 100),
      /Chrome did not report a DevTools port within 100ms/,
    );
  } finally {
    child.kill('SIGKILL');
  }
});

// --- readDevToolsPort: early exit ---

void test('readDevToolsPort rejects with an early-exit diagnostic (and any captured stderr) when Chrome exits before reporting a port', async () => {
  const child = nodeChild(
    "process.stderr.write('fatal: no display found\\n'); process.exitCode = 1;",
  );
  await assert.rejects(
    readDevToolsPort(child, 5_000),
    /Chrome exited before reporting a DevTools port \(code 1, signal null\) - Chrome stderr: fatal: no display found/,
  );
});

// --- readDevToolsPort: spawn-level error ---

void test('readDevToolsPort rejects with a spawn-error diagnostic when the process never starts', async () => {
  const missingBinary = path.join(
    mkdtempSync(path.join(tmpdir(), 'no-chrome-here-')),
    'not-a-binary',
  );
  assert.equal(existsSync(missingBinary), false, 'sanity: this path must not exist');
  const child = spawn(missingBinary, [], { stdio: ['ignore', 'ignore', 'pipe'] });
  await assert.rejects(readDevToolsPort(child, 5_000), /Chrome process failed to start/);
});

// --- terminateChild / cleanupFailedLaunch: SIGTERM->SIGKILL escalation ---

/** A fake process that only actually exits in response to a signal in
 * `respondsTo` (default: both) - lets tests drive every branch of
 * terminateChild's SIGTERM->SIGKILL escalation (a process that obeys
 * SIGTERM, one that ignores SIGTERM but obeys SIGKILL like a real OS would,
 * and one that survives both - the case an unbounded wait would previously
 * leave orphaned indefinitely). */
function createFakeChild(
  respondsTo: ReadonlySet<NodeJS.Signals> = new Set(['SIGTERM', 'SIGKILL']),
): TerminableChild & { killedWith: NodeJS.Signals[] } {
  let exitListener: (() => void) | undefined;
  const fake: TerminableChild & { killedWith: NodeJS.Signals[] } = {
    exitCode: null,
    signalCode: null,
    killedWith: [],
    once: (_event, listener) => {
      exitListener = listener;
    },
    kill: (signal = 'SIGTERM') => {
      fake.killedWith.push(signal);
      if (respondsTo.has(signal)) {
        fake.exitCode = 0;
        fake.signalCode = signal;
        exitListener?.();
      }
      return true;
    },
  };
  return fake;
}

void test('terminateChild resolves after SIGTERM alone when the child responds to it, without ever escalating to SIGKILL', async () => {
  const child = createFakeChild();

  await terminateChild(child, 5_000);

  assert.deepEqual(child.killedWith, ['SIGTERM'], 'SIGKILL must not be sent once SIGTERM worked');
});

void test('terminateChild does nothing when the child has already exited', async () => {
  const child = createFakeChild();
  child.exitCode = 0;

  await terminateChild(child, 5_000);

  assert.deepEqual(child.killedWith, [], 'an already-exited child must not be killed at all');
});

void test('terminateChild escalates to SIGKILL when the child ignores SIGTERM, and still resolves', async () => {
  const child = createFakeChild(new Set(['SIGKILL']));

  await terminateChild(child, 50, 5_000);

  assert.deepEqual(
    child.killedWith,
    ['SIGTERM', 'SIGKILL'],
    'SIGTERM must be attempted first, then SIGKILL once SIGTERM did not terminate the process',
  );
});

void test('terminateChild rejects with a bounded, Chrome-specific timeout diagnostic - never hangs, and never leaks Next-dev-server-specific wording - when the child survives SIGKILL too', async () => {
  const child = createFakeChild(new Set());

  await assert.rejects(
    terminateChild(child, 50, 50),
    /Chrome process did not exit within 50ms of SIGKILL/,
  );

  assert.deepEqual(
    child.killedWith,
    ['SIGTERM', 'SIGKILL'],
    'both signals must still have been attempted even though neither terminated the process',
  );
});

// --- cleanupFailedLaunch: wires terminateChild's escalation into cleanup ---

void test('cleanupFailedLaunch sends SIGTERM and removes the temp profile dir once the child exits', async () => {
  const child = createFakeChild();
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'stage-tracker-cdp-test-'));
  writeFileSync(path.join(userDataDir, 'marker'), 'x');

  await cleanupFailedLaunch(child, userDataDir, 5_000);

  assert.deepEqual(child.killedWith, ['SIGTERM']);
  assert.equal(existsSync(userDataDir), false, 'the temporary user-data dir must be removed');
});

void test('cleanupFailedLaunch does not send a second kill when the child has already exited', async () => {
  const child = createFakeChild();
  child.exitCode = 0;
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'stage-tracker-cdp-test-'));

  await cleanupFailedLaunch(child, userDataDir, 5_000);

  assert.deepEqual(child.killedWith, [], 'an already-exited child must not be killed again');
  assert.equal(existsSync(userDataDir), false);
});

void test('cleanupFailedLaunch escalates to SIGKILL when SIGTERM does not terminate the child, and still removes the temp profile dir', async () => {
  const child = createFakeChild(new Set(['SIGKILL']));
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'stage-tracker-cdp-test-'));

  await cleanupFailedLaunch(child, userDataDir, 50, 5_000);

  assert.deepEqual(child.killedWith, ['SIGTERM', 'SIGKILL']);
  assert.equal(existsSync(userDataDir), false, 'the temporary user-data dir must be removed');
});

void test('cleanupFailedLaunch rejects with a bounded timeout - never hangs - when the child survives both SIGTERM and SIGKILL, but still removes the temp profile dir', async () => {
  const child = createFakeChild(new Set());
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'stage-tracker-cdp-test-'));

  await assert.rejects(
    cleanupFailedLaunch(child, userDataDir, 50, 50),
    /Chrome process did not exit within 50ms of SIGKILL/,
  );

  assert.deepEqual(child.killedWith, ['SIGTERM', 'SIGKILL']);
  assert.equal(
    existsSync(userDataDir),
    false,
    'temp profile dir removal must still be attempted even when the process survives both signals',
  );
});

// --- Primary startup error preserved when cleanup also fails ---

void test('a startup failure followed by a cleanup failure keeps the startup error primary and adds cleanup context', async () => {
  const child = createFakeChild(new Set());
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'stage-tracker-cdp-test-'));
  const startupError = new Error('Chrome did not report a DevTools port within 20000ms');

  let combined: unknown;
  try {
    await cleanupFailedLaunch(child, userDataDir, 50, 50);
  } catch (cleanupError) {
    // Calls the actual production combining logic (attemptLaunch's own
    // catch block calls the same function) rather than reimplementing it,
    // so a regression there is caught here too.
    combined = combineStartupAndCleanupError(startupError, cleanupError);
  }

  assert.ok(combined instanceof Error);
  assert.match(combined.message, /^Chrome did not report a DevTools port within 20000ms/);
  assert.match(
    combined.message,
    /additionally, cleanup failed:.*Chrome process did not exit within 50ms of SIGKILL/,
  );
  assert.equal(combined.cause, startupError, 'the original startup error must remain reachable');
});

// --- runCleanupTasks: partial initialization / aggregation ---

void test('runCleanupTasks resolves when every task succeeds', async () => {
  const ran: string[] = [];
  await runCleanupTasks([
    () => {
      ran.push('a');
      return Promise.resolve();
    },
    () => {
      ran.push('b');
      return Promise.resolve();
    },
  ]);
  assert.deepEqual(ran, ['a', 'b']);
});

void test('runCleanupTasks only contains cleanups for resources actually initialized - simulating app-only, app+browser, and app+browser+page partial init', async () => {
  for (const initializedCount of [1, 2, 3]) {
    const ran: string[] = [];
    const allResourceCleanups = [
      () => {
        ran.push('app');
        return Promise.resolve();
      },
      () => {
        ran.push('browser');
        return Promise.resolve();
      },
      () => {
        ran.push('page');
        return Promise.resolve();
      },
    ];
    // Mirrors catalogAccess.test.ts's before(): each cleanup is pushed only
    // once its resource actually finished initializing, so a before() that
    // fails partway through never reaches the later pushes.
    const initialized = allResourceCleanups.slice(0, initializedCount);

    await runCleanupTasks(initialized);

    assert.equal(
      ran.length,
      initializedCount,
      `only the ${String(initializedCount)} initialized resource(s) should have been cleaned up`,
    );
  }
});

void test('runCleanupTasks attempts every task even when an earlier one fails, and aggregates every failure', async () => {
  const attempted: string[] = [];
  await assert.rejects(
    runCleanupTasks([
      () => {
        attempted.push('page');
        return Promise.reject(new Error('page close failed'));
      },
      () => {
        attempted.push('browser');
        return Promise.resolve();
      },
      () => {
        attempted.push('app');
        return Promise.reject(new Error('app stop failed'));
      },
    ]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /page close failed/);
      assert.match(error.message, /app stop failed/);
      return true;
    },
  );

  assert.deepEqual(
    attempted,
    ['page', 'browser', 'app'],
    'every cleanup task must still be attempted, even after an earlier one throws - no undefined.close() short-circuit and no skipped resource',
  );
});

void test('runCleanupTasks never throws a secondary undefined.close()-shaped TypeError for a resource that was never pushed', async () => {
  // The direct regression proof: an uninitialized resource has no entry in
  // the task list at all (unlike the original `await browser.close()` on a
  // `browser` that was never assigned), so there is nothing here that can
  // produce `Cannot read properties of undefined (reading 'close')`.
  await runCleanupTasks([
    () => {
      // only "app" initialized
      return Promise.resolve();
    },
  ]);
});
