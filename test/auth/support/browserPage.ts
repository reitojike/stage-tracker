import { existsSync } from 'node:fs';
import {
  chromium,
  errors as playwrightErrors,
  type Browser as PlaywrightBrowser,
  type BrowserContext,
  type LaunchOptions,
  type Page,
} from 'playwright-core';

// Minimal real-browser driver for test/auth, on top of `playwright-core`
// driving the *system* Google Chrome (Issue #277). Only the thin
// `Browser`/`BrowserPage` wrappers below are this repo's own code; browser
// process lifecycle (spawn, readiness, graceful close, force kill, temp
// profile cleanup) is playwright-core's - see launchBrowser's doc comment
// for how the Issue #259 lifecycle contract maps onto it.
//
// Why a real browser at all: Issue #145 makes /catalog's calendar/list body
// a client-gated render (src/app/catalog/_components/CatalogView.tsx's
// `readyToRenderBody`/`selectionReady`) - deliberately, per the Issue's
// canonical addendum, to avoid ever showing an unfiltered result that a
// restored browser-local filter selection is about to override. A plain
// `fetch()` never executes client JS, so it can only ever observe that
// component's *pending* state (see CatalogView.tsx's `data-catalog-ready`
// marker) for a non-empty catalog - it can no longer see the resolved
// calendar/list markup the way test/auth/catalogAccess.test.ts's pre-#145
// assertions expected. This module lets those assertions run against a
// real, hydrated page instead, preserving that file's own stated purpose
// ("real end-to-end acceptance evidence... a real signed-in session...
// actually reaches the authenticated Catalog UI").
//
// Deliberately *not* Playwright Test (`@playwright/test`), and deliberately
// no `npx playwright install` browser download: the runner stays node:test
// (package.json's `test:auth`), and the Chrome binary stays the one already
// present on the machine (local install / ubuntu-latest's preinstalled
// google-chrome), the same resolution targets the pre-#277 driver used.

/** Chrome startup readiness allowance (Issue #259). Passed as playwright-
 * core's launch `timeout` (its own default is 3 minutes): observed CI
 * evidence (run 33322936064 attempt 2) showed a genuine Chrome readiness
 * timeout on a runner concurrently running the full local Supabase container
 * stack - real CPU/IO contention a normal ~1-2s startup never waits anywhere
 * near. Bounded (not the 10s->20min anti-pattern that Issue rules out). */
const LAUNCH_TIMEOUT_MS = 20_000;

/** One retry of *Chrome process startup/readiness only* (Issue #259) - never
 * of an Auth assertion or the surrounding Database job. playwright-core
 * fully terminates a failed attempt's process and removes its temp profile
 * before `launch()` rejects (see launchBrowser's doc comment), so a second
 * attempt never races a leftover first one. */
const MAX_LAUNCH_ATTEMPTS = 2;

/** Default `waitForSelector` allowance - unchanged from the pre-#277 driver. */
const DEFAULT_SELECTOR_TIMEOUT_MS = 5_000;

export interface BrowserPage {
  /** Navigates to `url`, first seeding `cookieHeader` (the same
   * "name=value; name2=value2" shape signInThroughApp's `session.cookie`
   * already produces) as real browser cookies for that origin - equivalent
   * to a signed-in user's own tab, not a synthetic header on a single
   * fetch. Resolves once the page's own `load` event has fired; callers
   * that need to wait for *client-side* work past that (e.g. CatalogView's
   * hydration) call waitForSelector separately. */
  navigate(url: string, cookieHeader?: string): Promise<void>;
  /** Resolves once `document.querySelector(selector)` is non-null in the
   * live page (attached - the element need not be visible), or rejects with
   * a `selector not found within <timeoutMs>ms: <selector>` error once
   * `timeoutMs` (default 5000) elapses - never hangs. */
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
  /** The underlying Playwright `Page` for the same tab, for journeys that
   * need more than the methods above (form fill, click, `waitForURL`, ...)
   * without growing this wrapper (Issue #277, for #278's write journeys).
   * Everything done through it shares this page's cookies/session. */
  readonly raw: Page;
}

export interface Browser {
  /** Opens a new tab in the one shared browser context every page of this
   * `Browser` lives in - cookies seeded via one page's `navigate()` are
   * visible to every other page, the same as the pre-#277 driver's single
   * Chrome profile (and a real user's single browser window). */
  newPage(): Promise<BrowserPage>;
  /** Closes every page/context and terminates the Chrome process, waiting
   * (boundedly - see launchBrowser) for it to actually exit. Safe to call
   * more than once. */
  close(): Promise<void>;
}

/** The subset of playwright-core's `BrowserContext.addCookies()` input
 * `navigate()` uses: `url` lets Playwright derive domain/path/secure from
 * the navigation target itself, the same way the pre-#277 driver's CDP
 * `Network.setCookies` call did. */
export interface InjectedCookie {
  name: string;
  value: string;
  url: string;
}

/** Splits a `Cookie:`-header-shaped string ("a=1; b=2") into the cookies
 * `navigate()` seeds for `url`. Only the first `=` separates name from
 * value, so a value that itself contains `=` (base64 padding in Supabase's
 * session cookie, e.g.) survives intact; empty segments (a trailing `;`)
 * are skipped. An undefined/empty header yields no cookies. Exported so this
 * parsing is proven directly (test/auth/browserPageHarness.test.ts) rather
 * than only via a full signed-in Catalog render. */
export function cookiesFromHeader(cookieHeader: string | undefined, url: string): InjectedCookie[] {
  if (cookieHeader === undefined) {
    return [];
  }
  return cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((pair) => {
      const separator = pair.indexOf('=');
      if (separator === -1) {
        return { name: pair, value: '', url };
      }
      return { name: pair.slice(0, separator), value: pair.slice(separator + 1), url };
    });
}

class PlaywrightBrowserPage implements BrowserPage {
  readonly raw: Page;

  constructor(page: Page) {
    this.raw = page;
  }

  async navigate(url: string, cookieHeader?: string): Promise<void> {
    const cookies = cookiesFromHeader(cookieHeader, url);
    if (cookies.length > 0) {
      await this.raw.context().addCookies(cookies);
    }
    await this.raw.goto(url, { waitUntil: 'load' });
  }

  async waitForSelector(selector: string, timeoutMs = DEFAULT_SELECTOR_TIMEOUT_MS): Promise<void> {
    try {
      // 'attached' (not Playwright's default 'visible'): the pre-#277
      // contract was `document.querySelector(selector) !== null`, which a
      // hidden-but-present element satisfies.
      await this.raw.waitForSelector(selector, { state: 'attached', timeout: timeoutMs });
    } catch (error) {
      if (error instanceof playwrightErrors.TimeoutError) {
        throw new Error(`selector not found within ${String(timeoutMs)}ms: ${selector}`, {
          cause: error,
        });
      }
      throw error;
    }
  }

  content(): Promise<string> {
    return this.raw.evaluate(() => document.documentElement.outerHTML);
  }

  visibleText(): Promise<string> {
    return this.raw.evaluate(() => document.body.innerText);
  }

  close(): Promise<void> {
    return this.raw.close();
  }
}

class PlaywrightDrivenBrowser implements Browser {
  private readonly browser: PlaywrightBrowser;
  private readonly context: BrowserContext;

  constructor(browser: PlaywrightBrowser, context: BrowserContext) {
    this.browser = browser;
    this.context = context;
  }

  async newPage(): Promise<BrowserPage> {
    return new PlaywrightBrowserPage(await this.context.newPage());
  }

  async close(): Promise<void> {
    // Closing the Browser closes every context/page it owns and then
    // terminates the process (graceful `Browser.close`, force-killed if
    // that does not complete - see launchBrowser). Resolves immediately if
    // the browser is already closed.
    await this.browser.close();
  }
}

export interface LaunchBrowserOptions {
  /** Explicit Chrome/Chromium binary to launch instead of resolving one
   * (overrides `CHROME_PATH` too). Primarily for the driver's own
   * fault-path tests, which point it at a binary that is not Chrome. */
  executablePath?: string;
  /** Per-attempt readiness allowance; defaults to LAUNCH_TIMEOUT_MS. */
  launchTimeoutMs?: number;
}

/** Where a "Chrome not found" failure should point the reader: the same
 * targets the pre-#277 driver's own candidate list covered, expressed as
 * *how* each is resolved now. */
function chromeResolutionHint(): string {
  return [
    'Chrome resolution: set CHROME_PATH to an explicit Chrome/Chromium binary path, or install Google Chrome where',
    "playwright-core's channel 'chrome' looks for it (Linux: /opt/google/chrome/chrome - the ubuntu-latest CI runner's",
    'preinstalled google-chrome; Windows: <Program Files|Program Files (x86)|LocalAppData>\\Google\\Chrome\\Application\\chrome.exe;',
    "macOS: /Applications/Google Chrome.app). This test suite deliberately never downloads a browser ('npx playwright install' is not used).",
  ].join(' ');
}

/** "No Chrome to launch" - a deterministic resolution failure, distinct
 * from a Chrome process that started but failed to become ready, which is
 * the only kind of failure launchBrowser's bounded retry is for. */
class ChromeNotFoundError extends Error {}

type LaunchTarget = Pick<LaunchOptions, 'channel' | 'executablePath'>;

/** Resolves the launch target: an explicit override, else `CHROME_PATH`,
 * else playwright-core's own `channel: 'chrome'` system-Chrome lookup. A
 * `CHROME_PATH` that points at a missing file is an error (naming the
 * path), not a silent fallback to a different Chrome than the one
 * configured. */
function resolveLaunchTarget(options: LaunchBrowserOptions): LaunchTarget {
  const executablePath = options.executablePath ?? process.env.CHROME_PATH;
  if (executablePath === undefined || executablePath === '') {
    return { channel: 'chrome' };
  }
  if (!existsSync(executablePath)) {
    const source = options.executablePath === undefined ? 'CHROME_PATH' : 'executablePath';
    throw new ChromeNotFoundError(
      `no Chrome executable at ${executablePath} (${source}). ${chromeResolutionHint()}`,
    );
  }
  return { executablePath };
}

/** playwright-core's own "not found" message for `channel: 'chrome'` names
 * the first path it looked at, then recommends `npx playwright install
 * chrome` - the browser download this suite deliberately does not use - so
 * that second line is replaced with this repo's own resolution hint. */
function isChannelNotFoundMessage(error: unknown): error is Error {
  return (
    error instanceof Error &&
    error.message.startsWith("Chromium distribution 'chrome' is not found")
  );
}

async function attemptLaunch(target: LaunchTarget, timeoutMs: number): Promise<Browser> {
  let browser: PlaywrightBrowser;
  try {
    browser = await chromium.launch({ ...target, headless: true, timeout: timeoutMs });
  } catch (error) {
    if (isChannelNotFoundMessage(error)) {
      const [firstLine] = error.message.split('\n');
      throw new ChromeNotFoundError(`${firstLine ?? error.message}. ${chromeResolutionHint()}`, {
        cause: error,
      });
    }
    throw error;
  }
  try {
    const context = await browser.newContext();
    return new PlaywrightDrivenBrowser(browser, context);
  } catch (error) {
    // The Browser handle is not returned on this path, so nothing else
    // could ever close it - terminate the process here.
    await browser.close();
    throw error;
  }
}

/**
 * Launches a headless system Google Chrome via playwright-core. Every
 * `newPage()` call opens a tab in one shared context (one per test-file
 * `before()`/individual navigation set is the expected usage), all cleaned
 * up together by `close()`.
 *
 * Lifecycle contract (Issue #259), now provided by playwright-core's
 * process launcher rather than this file's own code - references are to
 * playwright-core 1.62.1's bundled `packages/utils/processLauncher.ts` and
 * `packages/playwright-core/src/server/browserType.ts`:
 *
 * - **Launch failure leaks no process.** `browserType._launchProcess`
 *   races readiness against the child's own exit and the launch `timeout`;
 *   on either failure it runs `closeOrKill` before rethrowing (graceful
 *   `Browser.close`, then a force kill if that does not complete), and the
 *   spawned process's `close` event removes the temp profile/artifacts
 *   directories. The force kill is `taskkill /pid <pid> /T /F` on Windows
 *   and `process.kill(-pid, 'SIGKILL')` on POSIX (the child is spawned
 *   `detached`, i.e. as its own process group leader), so Chrome's helper
 *   subprocesses go with it - stronger than the pre-#277 driver's
 *   single-pid SIGTERM->SIGKILL.
 * - **Every termination wait is bounded.** `browser.close()` is that same
 *   `closeOrKill`, with a 30s cap (`DEFAULT_PLAYWRIGHT_TIMEOUT`) on the
 *   graceful path before the force kill - a stuck Chrome cannot hang
 *   teardown, and `close()` on an already-closed browser resolves.
 * - **No orphan on abnormal exit either.** `launchProcess` registers a
 *   `process.on('exit')` handler that force-kills every still-running
 *   browser it launched, plus SIGINT/SIGTERM/SIGHUP handlers that close
 *   them gracefully, so even a `node --test` process that dies without
 *   reaching `after()` does not leave Chrome alive to keep a CI job open.
 * - **Partial-init safety** is unchanged and lives in the callers:
 *   catalogAccess.test.ts only registers a cleanup for a resource once it
 *   actually exists (test/auth/support/cleanupTasks.ts).
 *
 * Retries Chrome process startup/readiness up to MAX_LAUNCH_ATTEMPTS times
 * - and *only* that: nothing here retries an Auth assertion, a Catalog
 * rendering assertion, or the surrounding Database job. A "Chrome not
 * found" resolution failure is deterministic and is not retried. If every
 * attempt fails, the final attempt's error (with any earlier attempts
 * summarized alongside it, and reachable via `cause`) is thrown - callers
 * see one clear, bounded failure, never an indefinite hang.
 */
export async function launchBrowser(options: LaunchBrowserOptions = {}): Promise<Browser> {
  const target = resolveLaunchTarget(options);
  const timeoutMs = options.launchTimeoutMs ?? LAUNCH_TIMEOUT_MS;
  const attemptSummaries: string[] = [];
  for (let attempt = 1; attempt <= MAX_LAUNCH_ATTEMPTS; attempt += 1) {
    try {
      return await attemptLaunch(target, timeoutMs);
    } catch (error) {
      if (error instanceof ChromeNotFoundError) {
        throw error;
      }
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
