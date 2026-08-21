import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
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

function stopProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => {
      resolve();
    });

    if (process.platform === 'win32' && typeof child.pid === 'number') {
      // child is the npx/next shim; killing only it would orphan the
      // server process still holding the port.
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        shell: false,
      });
    } else {
      child.kill('SIGTERM');
    }
  });
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

interface SpawnAttemptResult {
  child: ChildProcess;
  /** Resolves once the child has either become ready (never, here - this
   * promise only ever resolves with an early-exit reason) or exited. */
  earlyExit: Promise<{ code: number | null; stderr: string }>;
}

function spawnNextDev(port: number, status: LocalSupabaseStatus): SpawnAttemptResult {
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
  });

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  const earlyExit = new Promise<{ code: number | null; stderr: string }>((resolve) => {
    child.once('exit', (code) => {
      resolve({ code, stderr });
    });
  });

  return { child, earlyExit };
}

const LOCK_CONTENTION_MARKER = 'Another next dev server is already running';
const MAX_LOCK_CONTENTION_RETRIES = 5;
const LOCK_CONTENTION_RETRY_DELAY_MS = 1000;

/**
 * Boots the real Next.js app so route protection can be verified over
 * HTTP. `next dev` is used rather than `next start` so this test does not
 * depend on a build artifact having been produced first.
 *
 * `next dev` refuses to run a second instance against the same project
 * directory even on a different port ("Another next dev server is already
 * running") - it is a per-directory lock, not a per-port one. Every test
 * file that calls this must therefore not run concurrently with another
 * that also does; see package.json's `test:auth` script, which runs with
 * `--test-concurrency=1` for exactly this reason. Even with that,
 * sequential files can still race: this function's own child process for
 * the *previous* file exits (stopProcess's 'exit' event fires) slightly
 * before Next has actually released its on-disk dev lock, so the very next
 * file's `next dev` can still observe a stale lock for a brief window. That
 * is retried below (bounded); any other early exit is not, and now reports
 * the process's own stderr instead of just an exit code, so a genuine crash
 * is diagnosable from the error alone.
 */
export async function startAppServer(): Promise<AppServer> {
  const status = readLocalSupabaseStatus();

  for (let attempt = 1; ; attempt += 1) {
    const port = await findFreePort();
    const { child, earlyExit } = spawnNextDev(port, status);
    const baseUrl = `http://127.0.0.1:${String(port)}`;
    const deadline = Date.now() + 120_000;

    let exitInfo: { code: number | null; stderr: string } | undefined;
    for (;;) {
      if (child.exitCode !== null) {
        exitInfo = await earlyExit;
        break;
      }
      try {
        const response = await fetch(`${baseUrl}/sign-in`, { redirect: 'manual' });
        if (response.status > 0) {
          return { baseUrl, stop: () => stopProcess(child) };
        }
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) {
        await stopProcess(child);
        throw new Error(`next dev did not become ready at ${baseUrl} within 120s`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const isLockContention = exitInfo.stderr.includes(LOCK_CONTENTION_MARKER);
    if (isLockContention && attempt < MAX_LOCK_CONTENTION_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, LOCK_CONTENTION_RETRY_DELAY_MS));
      continue;
    }

    throw new Error(
      `next dev exited early with code ${String(exitInfo.code)} (attempt ${String(attempt)}` +
        `${isLockContention ? ', giving up after repeated lock contention' : ''}):\n${exitInfo.stderr}`,
    );
  }
}
