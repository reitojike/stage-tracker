import assert from 'node:assert/strict';
import type { Locator, Page } from 'playwright-core';
import type { AppServer } from './appServer.ts';
import { launchBrowser, type Browser } from './browserPage.ts';
import { signInThroughApp } from './signInThroughApp.ts';

// Shared support for the Issue #278 browser write journeys. Everything here
// is composition over what already exists (startAppServer, launchBrowser,
// signInThroughApp) plus the small amount of Playwright-`Page` plumbing the
// five journey files would otherwise each repeat - it deliberately adds no
// new sign-in, seeding, or permission path of its own.

/**
 * Smartphone-first default viewport (Issue #278 Decisions/Invariants:
 * "390px viewport を default にし"). 390x844 is the iPhone 14/15 logical
 * viewport, the width docs/ux-ui.md's own layout vocabulary is written
 * against. Height matters too: a 390-wide but desktop-tall window would
 * never surface a sheet footer that a real phone pushes below the fold.
 */
export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

/**
 * One signed-in user, driving its *own* Chrome process.
 *
 * One browser per actor, rather than several pages/tabs of one browser:
 * `launchBrowser()`'s pages all share a single BrowserContext (see its own
 * doc comment - "cookies seeded via one page's navigate() are visible to
 * every other page"), and a Supabase session cookie is one name at one
 * origin. Two actors in that shared jar would therefore overwrite each
 * other, and every subsequent in-page navigation or Server Action fetch -
 * which sends whatever the jar currently holds, not what the last
 * `goto()` intended - would silently act as the wrong user. The two-user
 * journeys here (invitation, personal schedule sharing) alternate between
 * actors precisely in that way, so the isolation has to be real rather
 * than re-seeded per navigation. A separate Chrome per actor is also what
 * the product situation actually is: two people on two devices.
 */
export interface JourneyActor {
  readonly userId: string;
  /** The account's registered email - the exact string #55's
   * authenticated-user targeting boundary (invitation, schedule share)
   * expects a *counterpart* actor to type in. */
  readonly email: string;
  /** This actor's session cookie header, for assertions that need a plain
   * `fetch()` (a redirect/status check) rather than a rendered page. */
  readonly cookie: string;
  /** The live Playwright page for this actor's only tab. */
  readonly page: Page;
  /** Navigates to an app-relative path (e.g. `/catalog/invitations`) and
   * resolves once the page's `load` event has fired. */
  goto(path: string): Promise<void>;
  close(): Promise<void>;
}

export interface CreateJourneyActorOptions {
  /** Prefix for the generated account email, so a leaked test user names
   * the journey that created it. */
  emailPrefix: string;
}

/**
 * Signs a freshly provisioned user in through the app's own magic-link
 * flow (never a Supabase-SDK shortcut - see signInThroughApp) and hands
 * back a real browser tab already carrying that session at
 * MOBILE_VIEWPORT.
 *
 * `onUserProvisioned` fires the instant the auth user exists, before the
 * OTP/mailpit/confirm steps that can still fail - register cleanup from
 * there, not from the resolved actor, so a partial failure still leaves
 * the user tracked (the same contract signInThroughApp itself documents).
 */
export async function createJourneyActor(
  app: AppServer,
  options: CreateJourneyActorOptions,
  onUserProvisioned: (userId: string) => void,
): Promise<JourneyActor> {
  const browser: Browser = await launchBrowser();
  try {
    const browserPage = await browser.newPage();
    await browserPage.raw.setViewportSize(MOBILE_VIEWPORT);

    const session = await signInThroughApp(app, {
      emailPrefix: options.emailPrefix,
      onUserProvisioned,
    });
    assert.notEqual(session.cookie, '', 'expected a real session cookie');

    return {
      userId: session.userId,
      email: session.email,
      cookie: session.cookie,
      page: browserPage.raw,
      goto: (path) => browserPage.navigate(`${app.baseUrl}${path}`, session.cookie),
      close: () => browser.close(),
    };
  } catch (error) {
    // The Browser handle never reaches the caller on this path, so nothing
    // else could close it. Same shape browserPage.ts's own attemptLaunch
    // uses: the primary failure stays primary, a cleanup failure is
    // appended as context rather than replacing it.
    try {
      await browser.close();
    } catch (closeError) {
      const message = error instanceof Error ? error.message : String(error);
      const closeMessage = closeError instanceof Error ? closeError.message : String(closeError);
      throw new Error(`${message}; additionally, cleanup failed: ${closeMessage}`, {
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * Asserts the page does not scroll horizontally (Issue #278: "journey 中に
 * page-level horizontal overflow が無いことを 1 箇所以上で assert する").
 *
 * Compares the document element's own scrollWidth against its clientWidth
 * rather than against MOBILE_VIEWPORT.width: clientWidth is what the
 * document actually got after any scrollbar gutter, so this stays a
 * statement about the *page* ("nothing sticks out sideways") rather than
 * about a hard-coded number. A 1px allowance absorbs sub-pixel layout
 * rounding, which is not the kind of overflow this guards against - the
 * regressions it targets (a fixed-width control, an unwrapped long string)
 * overflow by tens of pixels.
 */
export async function assertNoHorizontalOverflow(page: Page, surface: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(
    scrollWidth <= clientWidth + 1,
    `${surface} overflows horizontally at ${String(MOBILE_VIEWPORT.width)}px: ` +
      `document scrollWidth ${String(scrollWidth)} > clientWidth ${String(clientWidth)}`,
  );
}

/** How long clickWhenInteractive keeps re-clicking before giving up. */
const HYDRATION_CLICK_TIMEOUT_MS = 20_000;
/** How long each individual attempt waits for the expected result. */
const HYDRATION_CLICK_ATTEMPT_MS = 1_000;

/**
 * Clicks `trigger` until `settled` becomes visible.
 *
 * Necessary because these journeys drive client components whose behavior
 * is attached by React hydration, not by the server-rendered markup: the
 * button exists (and is "actionable" as far as Playwright's own auto-wait
 * is concerned) from the first paint, but a click landing before hydration
 * runs no handler at all and is silently lost. Re-clicking until the
 * expected result appears is the bounded, deterministic way to express
 * "click this once it actually does something", and it stays honest for
 * genuine failures: a trigger whose handler is broken never produces
 * `settled` and this still fails, with the same message it would have had
 * on a single click.
 *
 * Safe to repeat only because every `trigger` used here is idempotent in
 * the pre-settled state (opening a sheet, choosing an already-open sheet's
 * row). Never point this at a control whose second click would mean
 * something different from its first.
 */
export async function clickWhenInteractive(
  trigger: Locator,
  settled: Locator,
  description: string,
  timeoutMs = HYDRATION_CLICK_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      await trigger.click({ timeout: HYDRATION_CLICK_ATTEMPT_MS });
      await settled.waitFor({ state: 'visible', timeout: HYDRATION_CLICK_ATTEMPT_MS });
      return;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline) {
      const detail = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(
        `${description}: the expected result never became visible within ${String(timeoutMs)}ms. ` +
          `Last attempt failed with: ${detail}`,
      );
    }
  }
}

/**
 * Resolves once `locator` is gone (detached or hidden). Used where a
 * journey's next step depends on a sheet having actually closed - a
 * subsequent click would otherwise land on the still-open sheet's backdrop.
 */
export async function waitUntilGone(locator: Locator, timeoutMs = 15_000): Promise<void> {
  await locator.waitFor({ state: 'hidden', timeout: timeoutMs });
}
