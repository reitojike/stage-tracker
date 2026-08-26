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
    // child is the npx/next shim; killing only it would orphan the server
    // process still holding the port. taskkill /T walks the whole process
    // tree - but it does so by looking up descendants of *this* still-alive
    // pid, so there is nothing to attempt once the immediate child has
    // already exited (unlike the POSIX group kill below, which stays valid
    // after the leader exits).
    if (!alreadyExited) {
      if (typeof child.pid === 'number') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          shell: false,
        });
      } else {
        child.kill('SIGTERM');
      }
    }
  } else if (typeof child.pid === 'number') {
    // POSIX: spawnNextDev spawns with detached: true, making this child the
    // leader of its own process group (group id == its pid). `next dev`
    // (via Turbopack) forks a next-server worker as a grandchild, which
    // survives a SIGTERM sent only to the shim and keeps holding the port
    // and the project's on-disk dev lock - the very next test file's
    // startAppServer() then collides with that leftover server instead of
    // starting a fresh one. Killing the whole group (negative pid) reaches
    // it too.
    //
    // This is attempted even when `child` itself has already exited: the
    // group id stays valid as a kill target for as long as any member of it
    // is still alive - including an already-orphaned next-server whose
    // immediate parent (this child) exited first.
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

// When `next dev` detects an AI coding agent it rewrites AGENTS.md /
// CLAUDE.md to inject its own managed rules block
// (next/dist/server/lib/generate-agent-files.js). Those files are
// Foundation-generated adapters here, so an agent-run test suite would
// otherwise mutate them and fail `npm run foundation:check`. Clearing the
// detection variables for the child keeps this test hermetic no matter who
// runs it, rather than relying on CI happening not to set them.
// Source of the list: next/dist/compiled/@vercel/detect-agent.
const AGENT_DETECTION_ENV_KEYS = new Set([
  'AI_AGENT',
  'ANTIGRAVITY_AGENT',
  'AUGMENT_AGENT',
  'CLAUDECODE',
  'CLAUDE_CODE',
  'CLAUDE_CODE_IS_COWORK',
  'CODEX_CI',
  'CODEX_SANDBOX',
  'CODEX_THREAD_ID',
  'COPILOT_ALLOW_ALL',
  'COPILOT_GITHUB_TOKEN',
  'COPILOT_MODEL',
  'CURSOR_AGENT',
  'CURSOR_EXTENSION_HOST_ROLE',
  'CURSOR_TRACE_ID',
  'GEMINI_CLI',
  'OPENCODE_CLIENT',
  'REPL_ID',
]);

function nonAgentEnv(): NodeJS.ProcessEnv {
  const filtered = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !AGENT_DETECTION_ENV_KEYS.has(key)),
  );
  // NODE_ENV is declared as required on ProcessEnv, so carry it through
  // explicitly rather than relying on the index signature.
  return { ...filtered, NODE_ENV: process.env.NODE_ENV };
}

interface SpawnedNextDev {
  child: ChildProcess;
  /** Resolves once the child exits, whenever that happens - readiness
   * polling in startAppServer races this against becoming ready. */
  exited: Promise<{ code: number | null; stderr: string }>;
}

function spawnNextDev(port: number, status: LocalSupabaseStatus): SpawnedNextDev {
  const child = spawn('npx', ['next', 'dev', '--port', String(port), '--hostname', '127.0.0.1'], {
    env: {
      ...nonAgentEnv(),
      NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: status.anonKey,
      NEXT_TELEMETRY_DISABLED: '1',
    },
    // Windows can only launch node_modules/.bin shims through a shell;
    // the args here are static literals plus a locally chosen port.
    shell: process.platform === 'win32',
    stdio: ['ignore', 'ignore', 'pipe'],
    // On POSIX, makes this child the leader of its own process group, so
    // stopProcess can later kill the whole tree (including the
    // next-server worker Turbopack forks as a grandchild) via a negative
    // pid instead of only the immediate npx/next shim.
    detached: process.platform !== 'win32',
  });

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
 * node_modules, so Next/Turbopack answers every route with a 500 instead of
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
 * HTTP. `next dev` is used rather than `next start` so this test does not
 * depend on a build artifact having been produced first.
 *
 * `next dev` refuses to run a second instance against the same project
 * directory even on a different port ("Another next dev server is already
 * running") - it is a per-directory on-disk lock, not a per-port one.
 * Every test file that calls this must therefore not run concurrently with
 * another that also does; see package.json's `test:auth` script, which
 * runs with `--test-concurrency=1` for exactly this reason. stopProcess
 * above is what makes that safe across files: it kills the *entire*
 * process tree it started (see its own comment), so no leftover
 * next-server can still be holding that lock by the time the next file's
 * startAppServer runs.
 */
export async function startAppServer(): Promise<AppServer> {
  assertDependenciesInstalled(process.cwd());
  const status = readLocalSupabaseStatus();
  const port = await findFreePort();
  const { child, exited } = spawnNextDev(port, status);
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const deadline = Date.now() + 120_000;
  let lastUnhealthyStatus: number | undefined;

  for (;;) {
    if (child.exitCode !== null) {
      const { code, stderr } = await exited;
      throw new Error(`next dev exited early with code ${String(code)}:\n${stderr}`);
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
      await stopProcess(child);
      const statusDetail =
        lastUnhealthyStatus === undefined
          ? ''
          : ` (last response status: ${String(lastUnhealthyStatus)})`;
      throw new Error(`next dev did not become ready at ${baseUrl} within 120s${statusDetail}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
