import assert from 'node:assert/strict';
import type { Locator, Page } from 'playwright-core';
import {
  deleteTestActor,
  deleteUserAndOwnedFixtures,
  type TestActor,
} from '../../rls/support/testActors.ts';
import type { AppServer } from './appServer.ts';
import { launchBrowser, type Browser } from './browserPage.ts';
import { collectCleanupFailures } from './cleanupTasks.ts';
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
  /**
   * The cookie header this session *started* with, for an assertion that
   * needs a plain `fetch()` (a redirect/status check) rather than a
   * rendered page.
   *
   * Deliberately not re-applied to the browser on later navigations - see
   * `goto`. Prefer driving the real page wherever a journey has the
   * choice; this snapshot is only valid for as long as its refresh token
   * has not rotated (supabase/config.toml's
   * `enable_refresh_token_rotation`).
   */
  readonly cookie: string;
  /** The live Playwright page for this actor's only tab. */
  readonly page: Page;
  /**
   * Navigates to an app-relative path (e.g. `/catalog/invitations`) and
   * resolves once the page's `load` event has fired.
   *
   * Sends whatever cookies the browser currently holds - it never re-seeds
   * the sign-in cookie captured above. That distinction is load-bearing:
   * this local stack has `enable_refresh_token_rotation = true` with a
   * 10s reuse interval, so `@supabase/ssr` rotates the session cookie
   * during a journey, and pushing the original value back over the rotated
   * one hands the server a spent refresh token. The request is then
   * unauthenticated, and a page like Event detail silently renders *no*
   * participation controls at all (see events/[eventId]/page.tsx's
   * `user !== null` guard) - which reads as "the write never happened"
   * rather than as a session problem. Seeding once, then letting the
   * browser's own jar take over, is also simply what a real signed-in user
   * does.
   *
   * Also waits for the route's own content to have actually rendered - see
   * waitForRenderedContent, without which every assertion made right after
   * a navigation is a race against streaming.
   */
  goto(path: string): Promise<void>;
  close(): Promise<void>
}

/** How long waitForRenderedContent allows a route's content to arrive. */
const CONTENT_TIMEOUT_MS = 30_000;

/**
 * Resolves once the route's own content is really on screen.
 *
 * `load` is not that point. Every Gate A surface renders inside AppShell's
 * `<main>` (src/ui/AppShell.tsx) via a per-segment `layout.tsx`, precisely
 * so the app bar and nav stay painted while the route below streams in
 * (Issue #70) - so `load` can fire with the shell present and `<main>`
 * still holding only that segment's `loading.tsx` fallback, or nothing
 * renderable at all. An assertion made at that moment reads a page that
 * has not shown its content yet, and reports the *content* as missing:
 * "the write never happened", when the truth is "not rendered yet". That
 * is exactly the intermittent failure this exists to remove.
 *
 * Three conditions together mean "arrived": `<main>` is visible, no
 * page-level LoadingIndicator (`role="status"` with a `...読み込み中`
 * label - see src/ui/LoadingIndicator.tsx) is still showing inside it, and
 * it has some rendered text. The last one matters on its own: streamed
 * content lands in the DOM before it is displayed, so a purely
 * presence-based check can pass while `innerText` is still empty.
 */
export async function waitForRenderedContent(page: Page): Promise<void> {
  const main = page.locator('main');
  await main.waitFor({ state: 'visible', timeout: CONTENT_TIMEOUT_MS });
  // A locator matching nothing counts as hidden, so this resolves at once
  // on a route whose content was already server-rendered.
  await page
    .locator('main [role="status"][aria-label$="読み込み中"]')
    .waitFor({ state: 'hidden', timeout: CONTENT_TIMEOUT_MS });

  const deadline = Date.now() + CONTENT_TIMEOUT_MS;
  for (;;) {
    if ((await main.innerText()).trim().length > 0) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `the route at ${page.url()} rendered no content within ${String(CONTENT_TIMEOUT_MS)}ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
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

    // The one and only cookie seeding: from here the browser keeps its own
    // jar, including anything @supabase/ssr rotates into it (see `goto`).
    await browserPage.navigate(`${app.baseUrl}/`, session.cookie);

    return {
      userId: session.userId,
      email: session.email,
      cookie: session.cookie,
      page: browserPage.raw,
      goto: async (path) => {
        await browserPage.navigate(`${app.baseUrl}${path}`);
        await waitForRenderedContent(browserPage.raw);
      },
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

export interface JourneyTeardown {
  /**
   * Process/handle cleanups, in *creation* order - this runs them in
   * reverse. Push a thunk only once the resource actually exists, so a
   * `before()` that threw partway cannot produce a secondary
   * `undefined.close()` (Issue #259).
   */
  resources: ReadonlyArray<() => Promise<void>>;
  /** Users created by createJourneyActor (collected via its
   * `onUserProvisioned` callback, so a sign-in that failed partway still
   * has its user tracked). */
  journeyUserIds: readonly string[];
  /** Password-path fixture actors - typically the designated catalog
   * creator that owns this journey's event. */
  fixtureActors: readonly TestActor[];
}

/**
 * Runs a journey file's whole `after()` teardown and throws one aggregate
 * error naming every failure, so no journey file has to re-derive this.
 *
 * Fixture teardown is strictly serial, and journey users come before
 * fixture actors. Both matter: a journey user's participation/invitation
 * rows reference the fixture owner's occurrences, so removing the user's
 * rows first is what lets the owner's occurrences delete cleanly. Running
 * the two groups concurrently (as a read-only test file safely can) would
 * make that a race.
 *
 * Resource teardown has no such dependency on fixture teardown, so the two
 * groups still run concurrently with each other - and both surface *raw*
 * failures, which are merged into a single message here rather than
 * nesting one already-formatted "cleanup failed:" error inside another.
 */
export async function runJourneyTeardown(teardown: JourneyTeardown): Promise<void> {
  const [resourceFailures, fixtureFailures] = await Promise.all([
    collectCleanupFailures([...teardown.resources].reverse()),
    collectCleanupFailures([
      ...teardown.journeyUserIds.map((id) => () => deleteUserAndOwnedFixtures(id)),
      ...teardown.fixtureActors.map((actor) => () => deleteTestActor(actor)),
    ]),
  ]);

  const failures = [...resourceFailures, ...fixtureFailures];
  if (failures.length > 0) {
    const messages = failures.map((failure) =>
      failure instanceof Error ? failure.message : String(failure),
    );
    throw new Error(`cleanup failed:\n${messages.join('\n')}`);
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
/** Gap between the position samples waitUntilStill compares. Comfortably
 * shorter than the 200ms `transform` transition src/ui/Sheet.module.css
 * gives every bottom sheet, so two equal samples really do mean "arrived",
 * not "sampled twice inside one slow frame". */
const STILLNESS_SAMPLE_MS = 120;

/**
 * Resolves once `locator` has stopped moving on screen.
 *
 * Every sheet in these journeys is src/ui/Sheet.tsx, which slides up over
 * 200ms (`transform` transition plus `@starting-style`). A sheet becomes
 * *visible* at the start of that slide, so acting the moment it appears
 * means acting on a moving target: Playwright's own actionability check
 * samples a position, and by the time the click is dispatched the control
 * has moved on, so the click lands on whatever is now under those
 * coordinates. For a bottom sheet that is the `<dialog>` element itself -
 * i.e. the backdrop - whose handler dismisses the sheet without
 * committing anything (see Sheet.tsx's onClick). The observable result is
 * a sheet that closes exactly as a successful save would, with no write:
 * a silent, intermittently-failing test rather than an obvious one.
 */
export async function waitUntilStill(locator: Locator, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let previous: { x: number; y: number } | null = null;
  for (;;) {
    const box = await locator.boundingBox();
    if (box !== null && previous !== null && box.x === previous.x && box.y === previous.y) {
      return;
    }
    previous = box === null ? null : { x: box.x, y: box.y };
    if (Date.now() > deadline) {
      throw new Error(`element never stopped moving within ${String(timeoutMs)}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, STILLNESS_SAMPLE_MS));
  }
}

/**
 * Clicks `trigger` until `settled` becomes visible and has stopped moving.
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
      // `settled` is normally a node inside the sheet the trigger just
      // opened, so waiting for it to stop moving is what makes the caller's
      // *next* click land on the control it aimed at - see waitUntilStill.
      await waitUntilStill(settled);
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
