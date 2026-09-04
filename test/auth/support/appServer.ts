import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import {
  readLocalSupabaseStatus,
  type LocalSupabaseStatus,
} from '../../rls/support/localSupabase.ts';

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('could not determine a free port'));
        return;
      }
      const { port } = address;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

export interface AppServer {
  baseUrl: string;
  stop: () => Promise<void>;
}

// Bounded well below the ~24min hang observed in #31 (a Windows taskkill
// that silently failed to reach every descendant left stopProcess() awaiting
// an 'exit' event that would never come), and well above how long a normal
// kill actually takes.
const STOP_TIMEOUT_MS = 30_000;

interface ExitAware {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  once: (event: 'exit', listener: () => void) => void;
}

/**
 * Resolves once `target` reports an 'exit' event (or already has), or
 * rejects if that does not happen within `timeoutMs`. Exported so the
 * bounded-wait itself - the fix for a stop() that could otherwise hang
 * indefinitely if a kill attempt silently failed - can be proven directly
 * against a fake emitter, without needing a real, potentially genuinely
 * unkillable, process tree.
 */
export function waitForExit(target: ExitAware, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (target.exitCode !== null || target.signalCode !== null) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `process did not exit within ${String(timeoutMs)}ms of a kill being attempted - a descendant may still be alive and holding the port and .next/dev/lock`,
        ),
      );
    }, timeoutMs);
    target.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

type KillableChild = ExitAware & Pick<ChildProcess, 'pid' | 'kill'>;

/**
 * Exported (and taking the same minimal `KillableChild` shape as
 * `waitForExit`, rather than a full `ChildProcess`) so the platform-specific
 * kill branching can be proven directly against a fake, including the
 * already-exited case below that a real spawned process can't deterministically
 * reproduce on demand.
 */
export function stopProcess(child: KillableChild): Promise<void> {
  const alreadyExited = child.exitCode !== null || child.signalCode !== null;
  const exited = waitForExit(child, STOP_TIMEOUT_MS);

  if (process.platform === 'win32') {
    // taskkill /T walks the whole process tree - but it does so by looking
    // up descendants of *this* still-alive pid, so there is nothing to
    // attempt once the immediate child has already exited (unlike the POSIX
    // group kill below, which stays valid after the leader exits).
    //
    // `next start` serves in-process and the child is Next's own CLI rather
    // than a shim (see spawnNextStart), so /T has no descendant to reach
    // today; it is kept because the guarantee this owes its caller is that
    // the port is free before the next file's server starts, which should
    // not silently depend on Next never forking a helper.
    if (!alreadyExited) {
      if (typeof child.pid === 'number') {
        // This is fire-and-forget - its own exit isn't awaited, only the
        // target child's (via `exited` above) - but it still needs an
        // 'error' listener: an unhandled 'error' event on a ChildProcess
        // (e.g. taskkill missing from PATH) is an uncaught exception that
        // would crash the whole test process, bypassing waitForExit's
        // bounded timeout entirely. Logging and swallowing it here lets
        // that timeout remain the single surfaced failure mode instead.
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          shell: false,
        }).on('error', (spawnError) => {
          console.error('failed to spawn taskkill for cleanup:', spawnError);
        });
      } else {
        child.kill('SIGTERM');
      }
    }
  } else if (typeof child.pid === 'number') {
    // POSIX: spawnNextStart spawns with detached: true, making this child
    // the leader of its own process group (group id == its pid), so killing
    // the whole group (negative pid) reaches any descendant as well as the
    // child itself. Under `next dev` that mattered concretely - Turbopack
    // forked a next-server worker that survived a SIGTERM sent only to the
    // shim and kept holding the port and `.next/dev/lock`. `next start`
    // forks nothing, so the group holds one process today; the group kill is
    // kept for the same reason as the Windows /T above.
    //
    // This is attempted even when `child` itself has already exited: the
    // group id stays valid as a kill target for as long as any member of it
    // is still alive - including an already-orphaned server whose immediate
    // parent (this child) exited first.
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // ESRCH (group already fully gone) or similar - nothing left to
      // kill; not a failure of cleanup itself.
    }
  } else if (!alreadyExited) {
    child.kill('SIGTERM');
  }

  return exited;
}

/** Path to Next's own CLI entrypoint, resolved from this worktree's
 * node_modules. Spawned with `process.execPath` rather than through the
 * `next`/`npx` shim so the spawned child *is* the server process: no shell
 * on Windows, and no wrapper process whose own pid says nothing about
 * whether the server is still listening. */
const NEXT_BIN = path.join('node_modules', 'next', 'dist', 'bin', 'next');

interface SpawnedNextStart {
  child: ChildProcess;
  /** Resolves once the child exits, whenever that happens - readiness
   * polling in startAppServer races this against becoming ready. */
  exited: Promise<{ code: number | null; stderr: string }>;
}

function spawnNextStart(port: number, status: LocalSupabaseStatus): SpawnedNextStart {
  const child = spawn(
    process.execPath,
    [NEXT_BIN, 'start', '--port', String(port), '--hostname', '127.0.0.1'],
    {
      // Next.js reads NEXT_PUBLIC_* on the *server* side from the running
      // process's environment (unlike the client bundle, where they are
      // substituted at build time - see
      // scripts/build-app-for-auth-tests.mjs), so passing them here is what
      // points the server at this machine's local Supabase stack.
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: status.anonKey,
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
      // On POSIX, makes this child the leader of its own process group, so
      // stopProcess's negative-pid kill has a group of its own to target
      // rather than this test runner's. `next start` serves in-process
      // (observed: one node process, no worker fork), so today that group
      // holds only the child itself - it is kept because what stopProcess
      // has to guarantee is that the port is released before the next
      // file's server starts, and that guarantee should not quietly depend
      // on Next never forking a helper.
      detached: process.platform !== 'win32',
    },
  );

  // Captured only for a clearer error message if the process exits early -
  // an opaque "exited with code 1" was previously the only signal
  // available to diagnose a startup failure.
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  const exited = new Promise<{ code: number | null; stderr: string }>((resolve) => {
    child.once('exit', (code) => {
      resolve({ code, stderr });
    });
  });

  return { child, exited };
}

/**
 * Cheap, synchronous check for the one dependency-installation failure mode
 * actually observed (#30): a worktree without its own `npm ci` has no
 * node_modules, so Next answers every route with a 500 instead of
 * failing to start - which used to be misread as "ready" (see
 * isHealthyReadyResponse below) and only surfaced much later as a hung
 * sign-in flow. Failing here is near-instant instead of waiting through the
 * full readiness poll below only to time out with a less specific error.
 */
export function assertDependenciesInstalled(cwd: string): void {
  const marker = path.join(cwd, 'node_modules', 'next', 'package.json');
  if (!existsSync(marker)) {
    throw new Error(
      `${marker} not found - this worktree needs its own "npm ci" before running test:auth ` +
        '(node_modules is not shared automatically across worktrees)',
    );
  }
}

/**
 * The production-build counterpart to assertDependenciesInstalled: since
 * Issue #286 these tests run the app with `next start`, which serves a
 * previously built `.next` rather than compiling on demand the way
 * `next dev` did. Without a build, `next start` exits with its own
 * "Could not find a production build" message - readable on its own, but it
 * surfaces once per test file and only after the spawn, so this states the
 * repo-specific remedy up front instead.
 *
 * BUILD_ID is the marker rather than `.next` itself: `next dev` and a
 * failed/partial build both leave a `.next` directory behind, and only a
 * completed `next build` writes BUILD_ID.
 *
 * Presence is all this checks - not which env the build baked in. Every
 * supported entry point (`npm run verify`, `npm run verify:database`, and
 * their CI counterpart) runs build:auth-app immediately before test:auth, so
 * the artifact is always the one that build produced. Running a bare
 * `npm run build` afterwards and then test:auth directly would leave the
 * *client* bundle pointing at no Supabase URL (see
 * scripts/build-app-for-auth-tests.mjs for why the two builds differ); that
 * surfaces as a loud "Missing required environment variable" from the
 * browser client, not as a silently passing suite, so it is left to the
 * error rather than re-derived here.
 */
export function assertProductionBuildPresent(cwd: string): void {
  const marker = path.join(cwd, '.next', 'BUILD_ID');
  if (!existsSync(marker)) {
    throw new Error(
      `${marker} not found - test:auth runs the app from a production build, so ` +
        '"npm run build:auth-app" must produce one first (npm run verify and ' +
        'npm run verify:database already do this for you)',
    );
  }
}

/**
 * A response at all (even non-2xx) proves the port is accepting
 * connections, but a 5xx means the app itself is broken rather than still
 * starting up - e.g. #30, where a worktree missing node_modules made every
 * route 500 forever. Treating that as "ready" surfaced only much later as a
 * hung sign-in flow instead of a clear startup failure here.
 */
export function isHealthyReadyResponse(status: number): boolean {
  return status >= 200 && status < 500;
}

/**
 * Boots the real Next.js app so route protection can be verified over
 * HTTP. Since Issue #286 this is `next start` against a production build,
 * not `next dev`: `next dev` compiled each route on its first request, so
 * every one of the test files that boots a server paid both a dev-server
 * startup and a fresh per-route compile.
 *
 * That also removed the reason this had to be serialized: `next dev` held a
 * per-directory on-disk lock (`.next/dev/lock`) and refused to run a second
 * instance against the same project directory even on a different port.
 * `next start` has no such lock - it only needs its own port, which
 * findFreePort supplies. Issue #301 then established these files' isolation
 * from each other independently of that lock and raised package.json's
 * `test:auth` to `--test-concurrency=2`, so several of these servers now
 * really do run at the same time, each on its own findFreePort port and all
 * against the one shared local Supabase stack.
 */
export async function startAppServer(): Promise<AppServer> {
  assertDependenciesInstalled(process.cwd());
  assertProductionBuildPresent(process.cwd());
  const status = readLocalSupabaseStatus();
  const port = await findFreePort();
  const { child, exited } = spawnNextStart(port, status);
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const deadline = Date.now() + 120_000;
  let lastUnhealthyStatus: number | undefined;

  for (;;) {
    if (child.exitCode !== null) {
      const { code, stderr } = await exited;
      throw new Error(`next start exited early with code ${String(code)}:\n${stderr}`);
    }
    try {
      const response = await fetch(`${baseUrl}/sign-in`, { redirect: 'manual' });
      if (isHealthyReadyResponse(response.status)) {
        return { baseUrl, stop: () => stopProcess(child) };
      }
      lastUnhealthyStatus = response.status;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      const statusDetail =
        lastUnhealthyStatus === undefined
          ? ''
          : ` (last response status: ${String(lastUnhealthyStatus)})`;
      const readinessMessage = `next start did not become ready at ${baseUrl} within 120s${statusDetail}`;
      // stopProcess can itself now reject (its own bounded timeout, rather
      // than hanging forever) - without this catch, that rejection would
      // replace the more actionable readinessMessage above with a bare
      // "process did not exit..." error, losing exactly the diagnostic
      // (last response status) most useful for the failure this is
      // hardening against (#30's persistent 500).
      try {
        await stopProcess(child);
      } catch (stopError) {
        const stopDetail = stopError instanceof Error ? stopError.message : String(stopError);
        throw new Error(`${readinessMessage}; additionally, cleanup failed: ${stopDetail}`, {
          cause: stopError,
        });
      }
      throw new Error(readinessMessage);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
