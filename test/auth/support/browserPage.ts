import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

/** Reads Chrome's own `DevTools listening on ws://host:port/...` startup
 * line from stderr - the standard way to learn the actual port when
 * launched with `--remote-debugging-port=0` (letting the OS pick a free
 * one, avoiding the same port-collision risk test/auth/support/appServer.ts's
 * findFreePort exists to avoid for the Next dev server). */
function readDevToolsPort(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => {
      reject(new Error('Chrome did not report a DevTools port within 10s'));
    }, 10_000);
    child.stderr?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const match = /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(buffer);
      const port = match?.[1];
      if (port !== undefined) {
        clearTimeout(timeout);
        resolve(Number(port));
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited early with code ${String(code)} before reporting a port`));
    });
  });
}

/**
 * Launches a headless system Chrome instance. Every `newPage()` call opens
 * its own CDP target/connection (one per test-file `before()`/individual
 * navigation set is the expected usage), all cleaned up together by
 * `close()`.
 */
export async function launchBrowser(): Promise<Browser> {
  const chromePath = resolveChromePath();
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'stage-tracker-cdp-'));
  const child = spawn(
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
  const port = await readDevToolsPort(child);

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
      // Waits for the process to actually exit before touching userDataDir -
      // an immediate rmSync right after kill() races Chrome's own still-open
      // file handles there (observed hardening precedent: test/auth/support/
      // appServer.ts's stopProcess/waitForExit exists for the same reason,
      // for the Next dev server child). Bounded rather than awaited
      // indefinitely: a stuck Chrome process must not hang test cleanup, and
      // a leftover temp profile dir on that rare path is not itself a
      // test-correctness issue.
      const exited =
        child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              const timeout = setTimeout(resolve, 5000);
              child.once('exit', () => {
                clearTimeout(timeout);
                resolve();
              });
            });
      child.kill('SIGTERM');
      await exited;
      try {
        rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup only - see above.
      }
    },
  };
}
