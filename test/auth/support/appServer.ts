import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { readLocalSupabaseStatus } from '../../rls/support/localSupabase.ts';

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

/**
 * Boots the real Next.js app so route protection can be verified over
 * HTTP. `next dev` is used rather than `next start` so this test does not
 * depend on a build artifact having been produced first.
 */
export async function startAppServer(): Promise<AppServer> {
  const status = readLocalSupabaseStatus();
  const port = await findFreePort();

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
    stdio: 'ignore',
  });

  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const deadline = Date.now() + 120_000;

  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`next dev exited early with code ${String(child.exitCode)}`);
    }
    try {
      const response = await fetch(`${baseUrl}/sign-in`, { redirect: 'manual' });
      if (response.status > 0) {
        break;
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

  return {
    baseUrl,
    stop: () => stopProcess(child),
  };
}
