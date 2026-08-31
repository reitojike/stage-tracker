import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForExit } from './appServer.ts';

// Minimal real-browser driver over Chrome's DevTools Protocol (CDP), no
// Playwright/Puppeteer dependency (Issue #145: "system Chrome + DevTools
// Protocol等、利用可能な既存手段で十分です").
//
// Why this exists: Issue #145 makes /catalog's calendar/list body a
// client-gated render (src/app/catalog/_components/CatalogView.tsx's
// `readyToRenderBody`/`selectionReady`) - deliberately, per the Issue's
// canonical addendum, to avoid ever showing an unfiltered result that a
// restored browser-local filter selection is about to override. A plain
// `fetch()` never executes client JS, so it can only ever observe that
// component's *pending* state (see CatalogView.tsx's `data-catalog-ready`
// marker) for a non-empty catalog - it can no longer see the resolved
// calendar/list markup the way test/auth/catalogAccess.test.ts's
// pre-#145 assertions expected. This module lets those assertions run
// against a real, hydrated page instead, preserving this file's own stated
// purpose ("real end-to-end acceptance evidence... a real signed-in
// session... actually reaches the authenticated Catalog UI") rather than
// weakening it to a same-origin HTML fetch that can no longer prove that.

const CHROME_PATH_CANDIDATES: readonly string[] = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function resolveChromePath(): string {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv !== undefined && existsSync(fromEnv)) {
    return fromEnv;
  }
  const found = CHROME_PATH_CANDIDATES.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      'no system Chrome/Chromium executable found - set CHROME_PATH to an explicit binary path',
    );
  }
  return found;
}

interface CdpResponseMessage {
  id: number;
  result?: unknown;
  error?: { message: string };
}

interface CdpEventMessage {
  method: string;
  params: unknown;
}

function isCdpResponse(value: unknown): value is CdpResponseMessage {
  return (
    typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'number'
  );
}

function isCdpEvent(value: unknown): value is CdpEventMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'method' in value &&
    typeof value.method === 'string'
  );
}

/** Narrows a CDP `Runtime.evaluate` response (`send()`'s return is `unknown`)
 * down to its `result.value` field without an `as` assertion - this repo's
 * lint profile forbids type assertions ("narrow unknown instead"), the same
 * convention domain/catalogFilterSheet.ts's parseCatalogFilterState follows
 * for its own untrusted JSON.parse result. */
function evaluateResultValue(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || !('result' in raw)) {
    return undefined;
  }
  const result = raw.result;
  if (typeof result !== 'object' || result === null || !('value' in result)) {
    return undefined;
  }
  return result.value;
}

/** Thin JSON-RPC-style CDP connection: `send` resolves/rejects by matching
 * response `id`, `on` dispatches unsolicited protocol events. */
class CdpConnection {
  private readonly ws: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly listeners = new Map<string, Set<(params: unknown) => void>>();
  private readonly ready: Promise<void>;

  constructor(webSocketDebuggerUrl: string) {
    this.ws = new WebSocket(webSocketDebuggerUrl);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener(
        'open',
        () => {
          resolve();
        },
        { once: true },
      );
      this.ws.addEventListener(
        'error',
        () => {
          reject(new Error(`failed to connect to ${webSocketDebuggerUrl}`));
        },
        { once: true },
      );
    });
    this.ws.addEventListener('message', (event) => {
      const parsed: unknown = JSON.parse(String(event.data));
      if (isCdpResponse(parsed)) {
        const pending = this.pending.get(parsed.id);
        if (pending === undefined) {
          return;
        }
        this.pending.delete(parsed.id);
        if (parsed.error !== undefined) {
          pending.reject(new Error(parsed.error.message));
        } else {
          pending.resolve(parsed.result);
        }
        return;
      }
      if (isCdpEvent(parsed)) {
        const listeners = this.listeners.get(parsed.method);
        if (listeners !== undefined) {
          for (const listener of listeners) {
            listener(parsed.params);
          }
        }
      }
    });
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    await this.ready;
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, listener: (params: unknown) => void): void {
    let set = this.listeners.get(method);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(method, set);
    }
    set.add(listener);
  }

  close(): void {
    this.ws.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface BrowserPage {
  /** Navigates to `url`, first seeding `cookieHeader` (the same
   * "name=value; name2=value2" shape signInThroughApp's `session.cookie`
   * already produces) as real browser cookies for that origin - equivalent
   * to a signed-in user's own tab, not a synthetic header on a single
   * fetch. Resolves once the browser's own `Page.loadEventFired` fires;
   * callers that need to wait for *client-side* work past that (e.g.
   * CatalogView's hydration) call waitForSelector separately. */
  navigate(url: string, cookieHeader?: string): Promise<void>;
  /** Polls (every 50ms, up to `timeoutMs`) until `document.querySelector(selector)`
   * is non-null in the live page. */
  waitForSelector(selector: string, timeoutMs?: number): Promise<void>;
  /** The live DOM's current `document.documentElement.outerHTML` - reused by
   * the same badgeCountOf/ariaLabelOf-style regex assertions the pre-#145
   * fetch().text() based tests used, since the *content* those assertions
   * check has not changed - only how it becomes available has. Note this
   * includes `<script>` tag contents: a client component's serialized props
   * (e.g. CatalogView's `events`) are embedded there for hydration even when
   * the component's own render deliberately never displays them (Issue
   * #109's 0-occurrence-event title, e.g.) - a plain `.includes(title)`
   * check against this can therefore find text that was never actually
   * *shown*. Use visibleText() for that kind of check instead. */
  content(): Promise<string>;
  /** `document.body.innerText` - unlike content() above, this reflects only
   * what is actually laid out and visible (innerText, unlike textContent,
   * excludes `<script>`/`<style>` and anything hidden via CSS/the `hidden`
   * attribute), so an `.includes(title)` check against this proves the title
   * was genuinely rendered on screen, not merely present somewhere in the
   * page's hydration payload. */
  visibleText(): Promise<string>;
  close(): Promise<void>;
}

class CdpBrowserPage implements BrowserPage {
  private readonly connection: CdpConnection;

  constructor(connection: CdpConnection) {
    this.connection = connection;
  }

  async navigate(url: string, cookieHeader?: string): Promise<void> {
    if (cookieHeader !== undefined && cookieHeader !== '') {
      const cookies = cookieHeader
        .split(';')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .map((pair) => {
          const eq = pair.indexOf('=');
          return { name: pair.slice(0, eq), value: pair.slice(eq + 1), url };
        });
      await this.connection.send('Network.setCookies', { cookies });
    }

    const loadEventFired = new Promise<void>((resolve) => {
      this.connection.on('Page.loadEventFired', () => {
        resolve();
      });
    });
    await this.connection.send('Page.navigate', { url });
    await loadEventFired;
  }

  async waitForSelector(selector: string, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = await this.evaluateBoolean(
        `document.querySelector(${JSON.stringify(selector)}) !== null`,
      );
      if (found) {
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(`selector not found within ${String(timeoutMs)}ms: ${selector}`);
      }
      await sleep(50);
    }
  }

  private async evaluateBoolean(expression: string): Promise<boolean> {
    const raw = await this.connection.send('Runtime.evaluate', { expression, returnByValue: true });
    return evaluateResultValue(raw) === true;
  }

  async content(): Promise<string> {
    const raw = await this.connection.send('Runtime.evaluate', {
      expression: 'document.documentElement.outerHTML',
      returnByValue: true,
    });
    const value = evaluateResultValue(raw);
    return typeof value === 'string' ? value : '';
  }

  async visibleText(): Promise<string> {
    const raw = await this.connection.send('Runtime.evaluate', {
      expression: 'document.body.innerText',
      returnByValue: true,
    });
    const value = evaluateResultValue(raw);
    return typeof value === 'string' ? value : '';
  }

  async close(): Promise<void> {
    await this.connection.send('Page.close');
    this.connection.close();
  }
}

export interface Browser {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

// Chrome startup readiness allowance (Issue #259). Was a fixed 10s; observed
// CI evidence (run 33322936064 attempt 2) showed a genuine DevTools-port
// timeout on a runner that was concurrently running the full local Supabase
// container stack (db/auth/rest/kong/inbucket/pg-meta) - real CPU/IO
// contention Chrome does not see on a quieter machine. 20s is a modest,
// bounded increase (not the 10s->20min anti-pattern the Issue explicitly
// rules out): a normal successful startup that returns in ~1-2s never waits
// anywhere near this, only a slow/failed one does.
const READY_TIMEOUT_MS = 20_000;

// Bounds every cleanup wait below (a failed startup's own child, and a
// normal close()'s child) so a stuck/unresponsive Chrome process can never
// hang the caller - the same bounded-wait principle
// test/auth/support/appServer.ts's waitForExit exists for, reused directly
// here rather than re-implemented.
const CLEANUP_TIMEOUT_MS = 5_000;

// Escalation bound for the SIGKILL wait, used only once SIGTERM has already
// failed to terminate the process within CLEANUP_TIMEOUT_MS. Deliberately
// short: SIGKILL cannot be caught, blocked, or ignored by the OS, so a
// process that still hasn't exited within this window indicates something
// fundamentally wrong (e.g. an unkillable zombie/D-state process) rather
// than needing more time. Without this escalation, a Chrome process that
// merely ignores SIGTERM would stay alive as an orphan even after
// cleanupFailedLaunch/Browser.close() themselves return - reintroducing,
// via a different path, the exact "live child process keeps node --test
// alive" failure mode Issue #259 exists to close.
const KILL_TIMEOUT_MS = 2_000;

// One retry of *Chrome process startup/readiness only* (never of an Auth
// assertion or the whole Database job - see launchBrowser's own doc
// comment). Evidence so far (see READY_TIMEOUT_MS above) shows a single
// transient DevTools-readiness timeout, not a repeatable startup failure -
// a bounded second attempt, with the first attempt's Chrome process fully
// cleaned up first, costs at most ~1 extra readiness window on the rare
// transient case and nothing on the normal case.
const MAX_LAUNCH_ATTEMPTS = 2;

// Caps how much Chrome stderr a startup-failure error carries (Chrome's own
// startup banner/diagnostics only - never page content, cookies, or
// credentials, which this process never sees on stderr).
const MAX_STDERR_CAPTURE_CHARS = 4_000;

function stderrSuffix(stderr: string): string {
  const trimmed = stderr.trim();
  return trimmed === '' ? '' : ` - Chrome stderr: ${trimmed}`;
}

/** Reads Chrome's own `DevTools listening on ws://host:port/...` startup
 * line from stderr - the standard way to learn the actual port when
 * launched with `--remote-debugging-port=0` (letting the OS pick a free
 * one, avoiding the same port-collision risk test/auth/support/appServer.ts's
 * findFreePort exists to avoid for the Next dev server).
 *
 * Distinguishes (Issue #259) *why* startup failed - readiness timeout, an
 * early exit, or a spawn-level error - and attaches bounded stderr context
 * to whichever it was, since "Chrome did not report a DevTools port" alone
 * does not say whether Chrome was merely slow, crashed, or never ran at
 * all. Does not itself touch the child process - the caller (launchBrowser)
 * owns cleanup, since only it knows whether this was the final attempt. */
export function readDevToolsPort(child: ChildProcess, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let settled = false;

    const finish = (run: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.stderr?.off('data', onStderrData);
      child.off('close', onClose);
      child.off('error', onSpawnError);
      run();
    };

    const onStderrData = (chunk: Buffer): void => {
      stderr += chunk.toString('utf8');
      // Match *before* truncating: matching against an already-truncated
      // buffer could discard the "DevTools listening on ws://..." line
      // itself if enough other stderr output (e.g. GPU/sandbox warnings)
      // preceded it within a single accumulation window, spuriously timing
      // out a startup that Chrome actually completed successfully.
      const match = /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(stderr);
      const port = match?.[1];
      if (port !== undefined) {
        finish(() => {
          resolve(Number(port));
        });
        return;
      }
      if (stderr.length > MAX_STDERR_CAPTURE_CHARS) {
        stderr = stderr.slice(-MAX_STDERR_CAPTURE_CHARS);
      }
    };

    // 'close' (not 'exit'): Node's own docs note stdio streams may still be
    // open/undrained when 'exit' fires, so an 'exit' listener here could
    // race a still-in-flight stderr 'data' chunk - losing exactly the
    // diagnostic text stderrSuffix exists to capture for a Chrome crash
    // banner large enough to still be buffered. 'close' fires only once
    // stdio is fully drained, guaranteeing onStderrData has already seen
    // everything Chrome wrote.
    const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish(() => {
        reject(
          new Error(
            `Chrome exited before reporting a DevTools port (code ${String(code)}, signal ${String(signal)})${stderrSuffix(stderr)}`,
          ),
        );
      });
    };

    const onSpawnError = (spawnError: Error): void => {
      finish(() => {
        reject(
          new Error(`Chrome process failed to start: ${spawnError.message}${stderrSuffix(stderr)}`),
        );
      });
    };

    const timeout = setTimeout(() => {
      finish(() => {
        reject(
          new Error(
            `Chrome did not report a DevTools port within ${String(timeoutMs)}ms${stderrSuffix(stderr)}`,
          ),
        );
      });
    }, timeoutMs);

    child.stderr?.on('data', onStderrData);
    child.once('close', onClose);
    child.once('error', onSpawnError);
  });
}

/** Minimal shape cleanupFailedLaunch needs from a Chrome child - a custom
 * interface (not `Pick<ChildProcess, ...>`) for the same reason
 * test/auth/support/appServer.ts's own `ExitAware`/`KillableChild` are: a
 * real `ChildProcess`'s overloaded `once`/`kill` are structurally
 * compatible with this narrower shape, but a hand-written fake process
 * in a test can implement this shape directly without also having to
 * satisfy every unrelated `ChildProcess` overload. */
export interface TerminableChild {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  once: (event: 'exit', listener: () => void) => void;
  kill: (signal?: NodeJS.Signals) => boolean;
}

/** Terminates `child`, escalating to `SIGKILL` if it does not exit within
 * `termTimeoutMs` of `SIGTERM`. `SIGTERM` alone is not sufficient: a Chrome
 * process that ignores/does not respond to it would otherwise stay alive as
 * an orphan even after the caller (cleanupFailedLaunch/Browser.close()
 * below) has itself already returned - reintroducing, via a different path,
 * the exact "a live child process keeps `node --test` alive" failure mode
 * Issue #259 exists to close. Still fully bounded: rejects (rather than
 * hanging) if the process survives `SIGKILL` too, within `killTimeoutMs`.
 * Exported so this escalation itself - not just the fact that *a* wait is
 * bounded - can be proven directly against a fake process, mirroring
 * test/auth/support/appServer.ts's own waitForExit/stopProcess precedent. */
export async function terminateChild(
  child: TerminableChild,
  termTimeoutMs: number,
  killTimeoutMs: number = KILL_TIMEOUT_MS,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  try {
    await waitForExit(child, termTimeoutMs);
    return;
  } catch {
    // SIGTERM did not terminate the process within termTimeoutMs - the
    // guard above plus this rejection together mean exitCode/signalCode
    // are still both null here, so SIGKILL is always still needed.
  }
  child.kill('SIGKILL');
  try {
    await waitForExit(child, killTimeoutMs);
  } catch {
    // waitForExit's own rejection message ("...holding the port and
    // .next/dev/lock") is written for its original Next-dev-server caller
    // (test/auth/support/appServer.ts) and would be actively misleading
    // here, pointing a reader at a Next.js port/lock problem instead of an
    // orphaned Chrome process - so a Chrome-specific message is thrown
    // instead, even though the bounded-wait mechanics themselves are still
    // reused from waitForExit.
    throw new Error(`Chrome process did not exit within ${String(killTimeoutMs)}ms of SIGKILL`);
  }
}

/** Terminates (via terminateChild's SIGTERM->SIGKILL escalation) a Chrome
 * child that failed to become ready before a `Browser` handle existed to
 * return to the caller, and best-effort removes its temporary profile dir.
 * Never throws for a userDataDir removal failure (best-effort, same as
 * Browser.close() below); *does* propagate a termination failure to the
 * caller, which folds it into the startup error as additional context
 * rather than replacing it (Issue #259: the original Chrome startup
 * failure must remain the primary, actionable error). `termTimeoutMs`
 * defaults to CLEANUP_TIMEOUT_MS but is overridable so tests can prove the
 * bounded-timeout/escalation path itself without a real multi-second
 * wait. */
export async function cleanupFailedLaunch(
  child: TerminableChild,
  userDataDir: string,
  termTimeoutMs: number = CLEANUP_TIMEOUT_MS,
  killTimeoutMs: number = KILL_TIMEOUT_MS,
): Promise<void> {
  try {
    await terminateChild(child, termTimeoutMs, killTimeoutMs);
  } finally {
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup only - a leftover temp profile dir on this rare
      // path is not itself a test-correctness issue.
    }
  }
}

/** Combines a Chrome startup failure with a subsequent cleanup failure into
 * one error, keeping the startup failure primary (message prefix, and
 * `cause`) and the cleanup failure as additional trailing context - mirrors
 * appServer.ts's startAppServer readiness/stop-failure combination.
 * Exported (and used by attemptLaunch below) so this combining logic itself
 * - not a hand-reimplementation of it - is what test coverage exercises. */
export function combineStartupAndCleanupError(startupError: unknown, cleanupError: unknown): Error {
  const startupMessage =
    startupError instanceof Error ? startupError.message : String(startupError);
  const cleanupMessage =
    cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
  return new Error(`${startupMessage}; additionally, cleanup failed: ${cleanupMessage}`, {
    cause: startupError,
  });
}

async function attemptLaunch(chromePath: string): Promise<Browser> {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'stage-tracker-cdp-'));
  let child: ChildProcess;
  try {
    child = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
  } catch (spawnError) {
    // A synchronous spawn() throw (rather than the child's own 'error'
    // event, which readDevToolsPort already handles) leaves no process to
    // terminate, but userDataDir was already created above and would
    // otherwise leak permanently - no later attempt/close() ever revisits
    // this specific directory.
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup only.
    }
    throw spawnError;
  }

  let port: number;
  try {
    port = await readDevToolsPort(child, READY_TIMEOUT_MS);
  } catch (startupError) {
    // The spawned child is not returned to the caller on this path (no
    // Browser handle exists yet) - this function therefore owns cleanup
    // itself, rather than leaving an orphaned Chrome process/temp profile
    // for the caller to discover it never received (Issue #259's root
    // cause: this cleanup previously did not happen at all).
    try {
      await cleanupFailedLaunch(child, userDataDir);
    } catch (cleanupError) {
      // The Chrome startup failure is the primary, actionable diagnostic;
      // a cleanup failure on top of it is additional context, not a
      // replacement.
      throw combineStartupAndCleanupError(startupError, cleanupError);
    }
    throw startupError;
  }

  return {
    async newPage(): Promise<BrowserPage> {
      const response = await fetch(`http://127.0.0.1:${String(port)}/json/new`, { method: 'PUT' });
      const target: unknown = await response.json();
      if (
        typeof target !== 'object' ||
        target === null ||
        !('webSocketDebuggerUrl' in target) ||
        typeof target.webSocketDebuggerUrl !== 'string'
      ) {
        throw new Error('unexpected PUT /json/new response shape from Chrome DevTools');
      }
      const connection = new CdpConnection(target.webSocketDebuggerUrl);
      await connection.send('Page.enable');
      await connection.send('Network.enable');
      return new CdpBrowserPage(connection);
    },
    async close(): Promise<void> {
      try {
        await terminateChild(child, CLEANUP_TIMEOUT_MS);
      } catch {
        // Bounded best-effort only, same tolerance as cleanupFailedLaunch
        // above - a stuck Chrome process must not hang test cleanup, even
        // if it survives both SIGTERM and the SIGKILL escalation.
      }
      try {
        rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup only - see above.
      }
    },
  };
}

/**
 * Launches a headless system Chrome instance. Every `newPage()` call opens
 * its own CDP target/connection (one per test-file `before()`/individual
 * navigation set is the expected usage), all cleaned up together by
 * `close()`.
 *
 * Retries Chrome process startup/readiness up to MAX_LAUNCH_ATTEMPTS times
 * (Issue #259) - and *only* that: a failed attempt's Chrome process/temp
 * profile is fully cleaned up (attemptLaunch's own catch) before any retry,
 * and nothing here retries an Auth assertion, a Catalog rendering
 * assertion, or the surrounding Database job. If every attempt fails, the
 * final attempt's error (with any earlier attempts summarized alongside it)
 * is thrown - callers see one clear, bounded failure, never an indefinite
 * hang.
 */
export async function launchBrowser(): Promise<Browser> {
  const chromePath = resolveChromePath();
  const attemptSummaries: string[] = [];
  for (let attempt = 1; attempt <= MAX_LAUNCH_ATTEMPTS; attempt += 1) {
    try {
      return await attemptLaunch(chromePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attemptSummaries.push(
        `attempt ${String(attempt)}/${String(MAX_LAUNCH_ATTEMPTS)}: ${message}`,
      );
      if (attempt === MAX_LAUNCH_ATTEMPTS) {
        throw new Error(`Chrome startup failed:\n${attemptSummaries.join('\n')}`, { cause: error });
      }
    }
  }
  /* c8 ignore next */
  throw new Error('unreachable: launchBrowser attempt loop exited without returning or throwing');
}
