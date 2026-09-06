import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { createEventWithoutOccurrence } from '../rls/support/eventFixtures.ts';
import {
  createAdminClient,
  createTestActor,
  deleteTestActor,
  grantCatalogCreator,
  type TestActor,
} from '../rls/support/testActors.ts';
import { startAppServer, type AppServer } from './support/appServer.ts';
import { launchBrowser, type Browser } from './support/browserPage.ts';
import {
  clickWhenInteractive,
  createJourneyActor,
  runJourneyTeardown,
  type JourneyActor,
} from './support/journeyActor.ts';

/*
 * Issue #341. The shared UI conventions of #307's refactor were guarded by
 * reading source and CSS text: a character count stood in for "the button
 * does not resize", the presence of `showModal()`/`close()` stood in for
 * "Escape actually closes and focus comes back", and `type="checkbox"`
 * stood in for "Tab and Space operate it". None of those observe what a
 * user observes.
 *
 * This file checks the three that hurt a user when they break - width,
 * placement, and keyboard/focus - by operating the real screens in a real
 * browser. It is deliberately *not* a second copy of the static contracts:
 * #312 owns the shared authority's own declarations and the per-consumer
 * composition wiring (src/ui/__tests__/*.test.ts), which is what catches a
 * dropped `composes:` line by name. Only what could not be observed from
 * source is here.
 *
 * Scope discipline (Issue #341: "同じ確認を全 consumer へ複製せず"): each
 * group below is checked on the smallest set of screens that still
 * represents the shared convention, not on every call site. Where a
 * convention has two independent compositions - the fixed submit bar is
 * composed once by EventWriteForm.module.css and once by
 * ScheduleWriteForm.module.css - both are exercised, because a regression
 * in one says nothing about the other. Where several screens share one
 * composition (Schedule create and Schedule edit are the same module), one
 * stands for the rest.
 *
 * This file adds no auth or domain assertions of its own. It borrows the
 * existing journey harness only to *reach* the screens; sign-in,
 * permission and write semantics stay proven by the journey files that own
 * them.
 */

/**
 * The width these measurements are taken at.
 *
 * Issue #316 measured this same bar at 320 / 375 / 414 / 768px and found
 * "全幅で同一の geometry, 横 overflow 0" - the offsets involved are
 * lengths (`--primary-nav-row-height`, the escape padding) on a band that
 * is `inset-inline: 0`, so neither the nav-overlap nor the last-field
 * clearance question is width-dependent. That evidence is reused here as
 * design input rather than re-run: the permanent matrix is one width, and
 * the one width-dependent part of the bar (`.inner`'s 640px cap and its
 * centering) stays where it already is, asserted as a declaration by
 * src/ui/__tests__/fixedSubmitBar.test.ts.
 *
 * 375x667 rather than the harness's 390x844 default: 375 is #316's own
 * canonical phone width, and the shorter viewport is the point - it forces
 * these forms to actually scroll, which is the state in which a fixed bar
 * can strand the last field.
 */
const GEOMETRY_VIEWPORT = { width: 375, height: 667 } as const;

/**
 * Allowance when comparing two rendered sizes of the same button - both
 * dimensions, since docs/ux-ui.md's guarantee is that neither moves
 * ("押しても行の高さや幅が動きません").
 *
 * The pending overlay stacks both labels in one grid cell, so the cell -
 * and the button around it - is the width of the widest label in every
 * state; the two measurements are expected to be equal, not merely close.
 * Half a pixel absorbs sub-pixel layout rounding only. The regression this
 * guards against (a lost overlay, so the button follows whichever label is
 * currently visible) moves the width by whole glyphs - three full-width
 * ones for the pair measured below.
 */
const WIDTH_TOLERANCE_PX = 0.5;

/** Bound on the Tab presses spent looking for a control, so one that is
 * genuinely unreachable by keyboard fails with a clear message instead of
 * looping. Comfortably above the number of tab stops preceding any control
 * reached here, including a full cycle of a modal's focus trap. */
const MAX_TAB_PRESSES = 60;

/**
 * How far the fixed bar may reach into PrimaryNav.
 *
 * Two terms. 1px is the shared hairline #316 measured and settled on: the
 * bar draws its own `border-top` along the nav's top edge, so that single
 * row of pixels is the intended overlap, not a defect. The second px
 * absorbs sub-pixel layout - the bar is `position: fixed` and therefore
 * lands on whole viewport pixels, while PrimaryNav is `position: sticky`
 * and so sits wherever the flow above it ends. Observed on current main at
 * 375x667: Event create puts the nav at 606..667, Schedule create at
 * 605.5..666.5 for the identical nav, purely because that page's content
 * height is fractional. The same 1px sub-pixel allowance
 * assertNoHorizontalOverflow already makes, for the same reason.
 *
 * Still far tighter than the regression it guards: the pre-#316 Event bar
 * submerged 35px into the nav with a 34px home indicator substituted, and
 * hid half the submit button.
 */
const NAV_OVERLAP_ALLOWANCE_PX = 2;

/** Fixture dates in a year no other test file's fixtures use. */
const RANGE_STARTS_ON = '2091-04-11';
/** Deliberately before RANGE_STARTS_ON: both are valid `date` inputs, so
 * the browser submits, and the server rejects the range
 * (eventCatalogWrite.ts's "終了日は開始日より前にできません。"). That is
 * what gives the pending measurement below a completed round trip that
 * leaves the button on screen - and creates no Event to clean up. */
const RANGE_ENDS_ON = '2091-04-10';
const EVENT_CREATE_PATH = '/catalog/events/new?month=2091-04';

/*
 * Group 4 of Issue #358: TriStateCheckbox's own indeterminate->checked
 * activation semantics (domain/triState.ts's nextTriState: activating an
 * indeterminate control resolves to `checked`, never `unchecked` - the one
 * behavior a plain 2-state checkbox does not have and Schedule create's own
 * checkbox coverage above says nothing about). Static source/CSS reading
 * (src/ui/__tests__/TriStateCheckbox.test.ts) already proves that contract
 * as *code*; this is the one representative real-browser check that a user
 * actually gets a checked box, not a stuck indeterminate one, after
 * operating the aggregate control by keyboard. FilterSheet's 宝塚/組 facet
 * stands in for every other TriStateCheckbox consumer - this is not
 * repeated per consumer.
 */
const TRISTATE_FIXTURE_SUFFIX = `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
const TRISTATE_GROUP_A_KEY = `sharedui-tristate-a-${TRISTATE_FIXTURE_SUFFIX}`;
const TRISTATE_GROUP_B_KEY = `sharedui-tristate-b-${TRISTATE_FIXTURE_SUFFIX}`;
const TRISTATE_GROUP_A_LABEL = 'TriState Group A';
const TRISTATE_GROUP_B_LABEL = 'TriState Group B';

let app: AppServer;
let browser: Browser;
/** Granted catalog_creators membership, which is what makes
 * /catalog/events/new render a form at all (product-rules.md "MVP Event
 * catalog write boundary"). Reusing the membership helper the Event
 * journey and the operational script both use - never a hard-coded UUID. */
let creator: JourneyActor;
/** A separate, non-browser `TestActor` used only to own the group-4 fixture
 * Event below - `creator` is a browser `JourneyActor` (no `.client` of its
 * own to call `create_event` through), and this fixture's ownership has no
 * bearing on any of the other groups' assertions, so it gets its own
 * independent actor and teardown rather than borrowing `creator`'s. */
let tristateFixtureOwner: TestActor;

const createdUserIds: string[] = [];
const initializedCleanups: Array<() => Promise<void>> = [];

before(async () => {
  app = await startAppServer();
  initializedCleanups.push(() => app.stop());

  browser = await launchBrowser();
  initializedCleanups.push(() => browser.close());

  creator = await createJourneyActor(browser, app, { emailPrefix: 'shared-ui-behavior' }, (id) => {
    createdUserIds.push(id);
  });
  initializedCleanups.push(() => creator.close());
  await grantCatalogCreator(creator.userId);
  await creator.page.setViewportSize(GEOMETRY_VIEWPORT);

  // Seeds a 0-occurrence Event classified as 宝塚 with two catalog groups,
  // via the same operator-assisted import_event_classification RPC
  // test/rls/eventClassification.test.ts uses - not a new write path. This
  // is the minimum the group-4 TriStateCheckbox test below needs: without
  // an Event actually associated with a genre's groups,
  // listCatalogGroupOptions returns none and FilterSheet never renders the
  // group facet's TriStateCheckbox options at all
  // (secondaryOptions.length > 0 in FilterSheet.tsx).
  tristateFixtureOwner = await createTestActor('shared-ui-behavior-tristate', 'Str0ng-Test-Pw!', {
    designatedCatalogCreator: true,
  });
  const admin = createAdminClient();
  const { event: tristateEvent } = await createEventWithoutOccurrence(
    tristateFixtureOwner,
    '2094-06-01',
    '2094-06-01',
    { title: `shared ui behavior tristate ${TRISTATE_FIXTURE_SUFFIX}` },
  );
  const { error: classificationError } = await admin.rpc('import_event_classification', {
    p_event_id: tristateEvent.id,
    p_set_genre: true,
    p_genre_key: 'takarazuka',
    p_set_groups: true,
    p_groups: [
      { key: TRISTATE_GROUP_A_KEY, displayName: TRISTATE_GROUP_A_LABEL },
      { key: TRISTATE_GROUP_B_KEY, displayName: TRISTATE_GROUP_B_LABEL },
    ],
  });
  assert.equal(classificationError, null, classificationError?.message);
  initializedCleanups.push(() => deleteTestActor(tristateFixtureOwner));
});

after(async () => {
  await runJourneyTeardown({
    resources: initializedCleanups,
    journeyUserIds: createdUserIds,
    fixtureActors: [],
  });
});

interface Rect {
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface SubmitBarGeometry {
  /** The out-of-flow bar the submit button sits in. Found by walking up
   * from the button to the nearest `position: fixed` ancestor rather than
   * by class name: the consumers name their own classes (`fixedSubmit` vs
   * `submitBand`), and "the bar is fixed" is itself part of what is being
   * checked - a band that lost `position: fixed` has no such ancestor and
   * fails here instead of being quietly measured in flow. */
  band: Rect;
  button: Rect;
  nav: Rect;
  /** The last control a user can actually reach in the form, in document
   * order. Visually hidden inputs (the checkbox/segment proxies, clipped
   * to 1px) are excluded by size - measuring one of those would report
   * where its 1px box sits, not where a field is. */
  lastControl: Rect;
  lastControlName: string;
}

/**
 * Scrolls the form to its end and reads the geometry of the fixed submit
 * bar there.
 *
 * The end of the scroll is the only place the question is interesting: the
 * band is out of flow, so it is exactly where the form runs out that it
 * would otherwise come to rest on top of the last field. `behavior:
 * 'instant'` and the two frames after it keep this off a fixed sleep - the
 * scroll is committed and laid out before anything is measured.
 */
async function readSubmitBarGeometry(page: Page, submitLabel: string): Promise<SubmitBarGeometry> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );

  const geometry = await page.evaluate((label: string): SubmitBarGeometry | { error: string } => {
    const toRect = (element: Element): Rect => {
      const { top, bottom, width, height } = element.getBoundingClientRect();
      return { top, bottom, width, height };
    };

    const button = [...document.querySelectorAll('button[type="submit"]')].find((candidate) =>
      candidate.textContent.includes(label),
    );
    if (button === undefined) {
      return { error: `no submit button whose label contains ${label}` };
    }

    let band: HTMLElement | null = button.parentElement;
    while (band !== null && getComputedStyle(band).position !== 'fixed') {
      band = band.parentElement;
    }
    if (band === null) {
      return { error: `the ${label} submit button has no position: fixed ancestor` };
    }

    const nav = document.querySelector('nav[aria-label="主要ナビゲーション"]');
    if (nav === null) {
      return { error: 'PrimaryNav is not on this screen' };
    }

    const form = button.closest('form');
    if (form === null) {
      return { error: `the ${label} submit button is not inside a form` };
    }
    const lastControl = [...form.querySelectorAll('input:not([type="hidden"]), textarea, select')]
      .filter((control) => {
        const rect = control.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1;
      })
      .at(-1);
    if (lastControl === undefined) {
      return { error: `the ${label} form has no visible control` };
    }

    return {
      band: toRect(band),
      button: toRect(button),
      nav: toRect(nav),
      lastControl: toRect(lastControl),
      lastControlName: lastControl.getAttribute('name') ?? '(unnamed)',
    };
  }, submitLabel);

  if ('error' in geometry) {
    assert.fail(geometry.error);
  }
  return geometry;
}

/**
 * Asserts the two things a user loses when this bar regresses: the submit
 * action is not underneath the nav, and the form's last field is not
 * underneath the bar.
 *
 * The band's allowance is NAV_OVERLAP_ALLOWANCE_PX (the intended hairline
 * plus sub-pixel layout). The button itself gets no allowance: whatever
 * the bar does at its own edge, the action a user presses has to clear the
 * nav outright.
 */
function assertSubmitBarClears(geometry: SubmitBarGeometry, surface: string): void {
  assert.ok(
    geometry.band.bottom <= geometry.nav.top + NAV_OVERLAP_ALLOWANCE_PX,
    `${surface}: the fixed submit bar overlaps PrimaryNav by more than its own hairline ` +
      `(band bottom ${String(geometry.band.bottom)} vs nav top ${String(geometry.nav.top)}, ` +
      `allowance ${String(NAV_OVERLAP_ALLOWANCE_PX)}px)`,
  );
  assert.ok(
    geometry.button.bottom <= geometry.nav.top,
    `${surface}: the submit button is underneath PrimaryNav ` +
      `(button bottom ${String(geometry.button.bottom)} vs nav top ${String(geometry.nav.top)})`,
  );
  assert.ok(
    geometry.lastControl.bottom <= geometry.band.top,
    `${surface}: the last field (${geometry.lastControlName}) is underneath the fixed submit bar ` +
      `at the end of the scroll (field bottom ${String(geometry.lastControl.bottom)} ` +
      `vs bar top ${String(geometry.band.top)})`,
  );
}

/**
 * Presses Tab until `matches` recognises the focused control.
 *
 * Real Tab presses rather than `element.focus()`: `:focus-visible` is the
 * whole point of the ring assertions below, and Chrome only matches it for
 * a checkbox/radio when the focus came from the keyboard. A programmatic
 * focus would satisfy a "the control is focused" check while the
 * user-visible ring stayed invisible.
 */
async function tabUntil(
  page: Page,
  matches: (active: { name: string; type: string }) => boolean,
  description: string,
): Promise<void> {
  for (let press = 1; press <= MAX_TAB_PRESSES; press += 1) {
    await page.keyboard.press('Tab');
    const active = await page.evaluate(() => ({
      name: document.activeElement?.getAttribute('name') ?? '',
      type: document.activeElement?.getAttribute('type') ?? '',
    }));
    if (matches(active)) {
      return;
    }
  }
  throw new Error(`${description} was not reachable within ${String(MAX_TAB_PRESSES)} Tab presses`);
}

interface TransferredFocusRing {
  focusVisible: boolean;
  outlineWidth: number;
  outlineStyle: string;
}

/**
 * The focus ring as it is actually painted, read from the *visible* proxy
 * rather than from the focused element.
 *
 * docs/ux-ui.md "visually hidden inputからvisible proxyへのfocus ring転送":
 * the control that receives focus is clipped to nothing, so the global
 * `:focus-visible` ring on it is invisible by construction, and each such
 * control transfers the ring to the element the user can see. The two
 * `proxyOf` shapes are the two selector shapes that doc says cannot be
 * collapsed into one - an aria-hidden sibling box, and the enclosing
 * label - named structurally so this never depends on hashed CSS module
 * class names.
 */
async function readTransferredFocusRing(
  page: Page,
  proxyOf: 'sibling-box' | 'enclosing-label',
): Promise<TransferredFocusRing> {
  return page.evaluate((kind: string): TransferredFocusRing => {
    const active = document.activeElement;
    const absent = { focusVisible: false, outlineWidth: 0, outlineStyle: 'none' };
    if (active === null) {
      return absent;
    }
    const proxy =
      kind === 'sibling-box'
        ? (active.parentElement?.querySelector('span[aria-hidden="true"]') ?? null)
        : active.closest('label');
    if (proxy === null) {
      return absent;
    }
    const computed = getComputedStyle(proxy);
    return {
      focusVisible: active.matches(':focus-visible'),
      outlineWidth: Number.parseFloat(computed.outlineWidth),
      outlineStyle: computed.outlineStyle,
    };
  }, proxyOf);
}

/*
 * Group 2 of Issue #341: fixed submit bar.
 *
 * Both compositions of src/ui/fixedSubmitBar.module.css are exercised -
 * EventWriteForm's (Event create) and ScheduleWriteForm's (Schedule
 * create, the same module Schedule edit composes, so it stands for both).
 * Event *edit* deliberately has no fixed bar - #316's own correction of
 * the Issue text current at the time - and is not measured here.
 *
 * Bound on what this proves: a headless desktop Chrome window at 375x667
 * with `env(safe-area-inset-bottom)` resolving to 0, which is what the
 * current shell produces (src/app/layout.tsx leaves `viewportFit` unset).
 * #316's 34px safe-area substitution is *not* re-run here and this is
 * *not* real-device verification. The home-indicator case stays covered by
 * #316's own browser evidence plus its PO waive of the physical iPhone
 * gate, and the safe-area term in the bar's offset stays asserted as a
 * declaration by fixedSubmitBar.test.ts. Nothing here revives that waived
 * gate, satisfies it, or narrows it.
 */

void test('Event create: the fixed submit bar clears PrimaryNav and never covers the last field', async () => {
  await creator.goto(EVENT_CREATE_PATH);
  await creator.page.getByLabel('タイトル').waitFor({ state: 'visible', timeout: 10_000 });

  assertSubmitBarClears(
    await readSubmitBarGeometry(creator.page, 'イベントを作成'),
    'Event create',
  );
});

void test('Schedule create: the fixed submit bar clears PrimaryNav and never covers the last field', async () => {
  await creator.goto('/schedule/new');
  await creator.page.getByLabel('件名').waitFor({ state: 'visible', timeout: 10_000 });

  assertSubmitBarClears(await readSubmitBarGeometry(creator.page, '予定を作成'), 'Schedule create');
});

interface PendingLabelMeasurement {
  buttonWidth: number;
  buttonHeight: number;
  /** Painted width of each label's text, measured over the text itself
   * with a Range. Not the spans' box widths: both spans are grid items in
   * one cell and therefore both stretch to the cell, so comparing their
   * boxes would compare the cell to itself and prove nothing about
   * whether the sizing copy is the one holding it open. */
  sizingTextWidth: number;
  visibleTextWidth: number;
  label: string;
}

/*
 * Group 1 of Issue #341: pending label width.
 *
 * Measured on Event create, whose pair is the widest-apart of the 17 call
 * sites ("イベントを作成" against "作成中…"): if the shared overlay stops
 * holding the width, the button moves by three full-width glyphs, which is
 * both the most user-visible form of the regression and the clearest
 * signal to measure. One call site, not seventeen - the overlay is one
 * shared mechanism, and #312's static wiring is what names the consumers
 * that compose it.
 *
 * The submission is held open on purpose. A local round trip is over in
 * well under a second, so "measure while pending" against a live server is
 * a race; intercepting the Server Action POST and releasing it only once
 * the measurement is done makes the pending state last exactly as long as
 * the measurement needs - no sleep anywhere, and no change to what the
 * page itself does.
 */
void test('pending label: the submit button keeps its size through 通常 → 送信中 → 失敗', async () => {
  await creator.goto(EVENT_CREATE_PATH);
  await creator.page.getByLabel('タイトル').waitFor({ state: 'visible', timeout: 10_000 });

  const measure = async (): Promise<PendingLabelMeasurement | null> =>
    creator.page.evaluate((): PendingLabelMeasurement | null => {
      const button = [...document.querySelectorAll('button[type="submit"]')].find((candidate) =>
        candidate.textContent.includes('作成'),
      );
      if (button === undefined) {
        return null;
      }
      const stacked = [...(button.querySelector('span')?.children ?? [])];
      const sizing = stacked.find((span) => span.getAttribute('aria-hidden') === 'true');
      const visible = stacked.find((span) => span.getAttribute('aria-hidden') !== 'true');
      if (sizing === undefined || visible === undefined) {
        return null;
      }
      const textWidth = (element: Element): number => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect().width;
      };
      const box = button.getBoundingClientRect();
      return {
        buttonWidth: box.width,
        buttonHeight: box.height,
        sizingTextWidth: textWidth(sizing),
        visibleTextWidth: textWidth(visible),
        label: visible.textContent.trim(),
      };
    });

  const idle = await measure();
  assert.ok(idle !== null, 'expected the create button to render the stacked label pair');
  assert.equal(idle.label, 'イベントを作成');

  // Valid enough for the browser to submit (both required fields filled,
  // both well-formed dates), invalid for the server (reversed range), so
  // the round trip completes back onto this same screen and writes nothing.
  await creator.page.getByLabel('タイトル').fill(`shared ui behavior ${String(Date.now())}`);
  await creator.page.getByLabel('初日').fill(RANGE_STARTS_ON);
  await creator.page.getByLabel('千秋楽').fill(RANGE_ENDS_ON);

  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await creator.page.route(
    (url) => url.pathname === '/catalog/events/new',
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await held;
      await route.continue();
    },
  );

  try {
    await creator.page.getByRole('button', { name: 'イベントを作成' }).click();
    // The pending state itself is the synchronization point: the form
    // publishes it as aria-busy (docs/ux-ui.md "送信中はform全体を
    // aria-busy にして入力を無効化し"), and the label has already swapped
    // by the time that attribute is on the DOM.
    await creator.page
      .locator('form[aria-busy="true"]')
      .waitFor({ state: 'attached', timeout: 15_000 });
    await creator.page
      .locator('button[type="submit"][disabled]')
      .waitFor({ state: 'attached', timeout: 15_000 });

    const pending = await measure();
    assert.ok(
      pending !== null,
      'expected the stacked label pair to survive into the pending state',
    );
    assert.equal(pending.label, '作成中…', 'expected the visible label to have swapped');

    assert.ok(
      Math.abs(pending.buttonWidth - idle.buttonWidth) <= WIDTH_TOLERANCE_PX,
      `the submit button resized when its label swapped to the pending wording: ` +
        `${String(idle.buttonWidth)}px (${idle.label}) -> ` +
        `${String(pending.buttonWidth)}px (${pending.label})`,
    );
    assert.ok(
      Math.abs(pending.buttonHeight - idle.buttonHeight) <= WIDTH_TOLERANCE_PX,
      `the submit button changed height when its label swapped: ` +
        `${String(idle.buttonHeight)}px -> ${String(pending.buttonHeight)}px`,
    );
    // The overlay only holds the width if the aria-hidden copy really is
    // the wider of the two - a copy narrower than the visible label would
    // let the button move with the overlay still intact. This is the part
    // of the removed character-count proxy that was worth keeping, now
    // measured as painted width instead of guessed from string length.
    for (const state of [idle, pending]) {
      assert.ok(
        state.sizingTextWidth + WIDTH_TOLERANCE_PX >= state.visibleTextWidth,
        `the aria-hidden sizing copy (${String(state.sizingTextWidth)}px) is narrower than the ` +
          `visible label "${state.label}" (${String(state.visibleTextWidth)}px), ` +
          `so it is not what is holding the button open`,
      );
    }
  } finally {
    release();
    // `behavior: 'wait'` rather than the default: the handler above is
    // parked on `held` at this point, and tearing the route down without
    // waiting for it leaves it to resume against a route Playwright has
    // already disposed of ("Route is already handled!"), which surfaces as
    // an unhandledRejection attributed to whatever test runs next.
    await creator.page.unrouteAll({ behavior: 'wait' });
  }

  // The failure half of 通常 → 送信中 → 失敗: the rejected range comes back
  // as a field error, the button leaves the pending state, and it is the
  // same size it started at.
  await creator.page
    .getByText('終了日は開始日より前にできません。')
    .waitFor({ state: 'visible', timeout: 30_000 });
  const settled = await measure();
  assert.ok(settled !== null, 'expected the create button to survive the rejected submission');
  assert.equal(settled.label, 'イベントを作成');
  assert.ok(
    Math.abs(settled.buttonWidth - idle.buttonWidth) <= WIDTH_TOLERANCE_PX,
    `the submit button did not return to its original width after the failure: ` +
      `${String(idle.buttonWidth)}px -> ${String(settled.buttonWidth)}px`,
  );
  // Both dimensions here, as in the pending comparison above: the failure
  // state adds a StatePanel and re-mounts the fields around this button, so
  // "the button came back the same size" is not answered by width alone.
  assert.ok(
    Math.abs(settled.buttonHeight - idle.buttonHeight) <= WIDTH_TOLERANCE_PX,
    `the submit button did not return to its original height after the failure: ` +
      `${String(idle.buttonHeight)}px -> ${String(settled.buttonHeight)}px`,
  );
});

/*
 * Group 3 of Issue #341: keyboard operation and visible focus.
 *
 * Two representatives of the one shared visually-hidden-input pattern
 * (src/ui/visuallyHidden.module.css, #317), chosen because they differ in
 * the way that matters here: a checkbox whose ring is transferred to an
 * aria-hidden sibling box, and a radio chip whose ring is transferred to
 * the enclosing label. The chip additionally lives inside the shared
 * Sheet, so it carries the Escape/focus-return check with it rather than
 * needing a Sheet scenario of its own.
 */

void test('Schedule create: the visually hidden checkbox is reachable by Tab, operable by Space, and shows its ring on the visible box', async () => {
  await creator.goto('/schedule/new');
  await creator.page.getByLabel('件名').waitFor({ state: 'visible', timeout: 10_000 });

  const blocking = creator.page.locator('input[name="blocking"][type="checkbox"]');
  await blocking.waitFor({ state: 'attached', timeout: 10_000 });
  const before = await blocking.isChecked();

  // Start the walk from the top of the tab order rather than from wherever
  // the navigation happened to leave focus, so the count below is the real
  // one a user traverses.
  await creator.page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  });
  await tabUntil(
    creator.page,
    (active) => active.name === 'blocking' && active.type === 'checkbox',
    'the blocking checkbox on Schedule create',
  );

  const ring = await readTransferredFocusRing(creator.page, 'sibling-box');
  assert.ok(ring.focusVisible, 'expected the keyboard-focused checkbox to match :focus-visible');
  assert.ok(
    ring.outlineWidth > 0 && ring.outlineStyle !== 'none',
    `expected the focus ring to be transferred to the visible box, but it computed to ` +
      `${String(ring.outlineWidth)}px ${ring.outlineStyle}`,
  );

  await creator.page.keyboard.press('Space');
  assert.equal(
    await blocking.isChecked(),
    !before,
    'expected Space on the focused checkbox to toggle its DOM state',
  );
});

void test('Catalog filter Sheet: a chip is operable by keyboard, and Escape returns focus to the trigger', async () => {
  await creator.goto('/catalog');
  await creator.page
    .locator('[data-catalog-ready="true"]')
    .waitFor({ state: 'attached', timeout: 30_000 });

  const trigger = creator.page.getByRole('button', { name: '絞り込み', exact: true });
  const dialog = creator.page.locator('dialog').first();
  await clickWhenInteractive(trigger, dialog, 'opening the catalog filter Sheet');

  const chipCount = await creator.page.locator('input[name="catalog-filter-genre"]').count();
  assert.ok(chipCount >= 2, `expected the genre chips to render, found ${String(chipCount)}`);

  await tabUntil(
    creator.page,
    (active) => active.name === 'catalog-filter-genre',
    'a genre chip inside the filter Sheet',
  );

  const ring = await readTransferredFocusRing(creator.page, 'enclosing-label');
  assert.ok(ring.focusVisible, 'expected the keyboard-focused chip input to match :focus-visible');
  assert.ok(
    ring.outlineWidth > 0 && ring.outlineStyle !== 'none',
    `expected the focus ring to be transferred to the visible chip, but it computed to ` +
      `${String(ring.outlineWidth)}px ${ring.outlineStyle}`,
  );

  // Tab lands on the *checked* radio of a radio group (the default
  // "すべて"), where Space is a no-op by definition. ArrowDown is the
  // keyboard operation this group actually offers: it moves to the next
  // chip and selects it, which is the DOM state change worth observing.
  const chipLabel = () =>
    creator.page.evaluate(() => document.activeElement?.closest('label')?.textContent.trim() ?? '');
  const focusedFirst = await chipLabel();
  await creator.page.keyboard.press('ArrowDown');
  await creator.page.waitForFunction(
    (previous: string) =>
      (document.activeElement?.closest('label')?.textContent.trim() ?? '') !== previous,
    focusedFirst,
    { timeout: 10_000 },
  );
  const moved = await creator.page.evaluate(() => {
    const active = document.activeElement;
    return {
      checked: active instanceof HTMLInputElement && active.checked,
      label: active?.closest('label')?.textContent.trim() ?? '',
    };
  });
  assert.notEqual(moved.label, focusedFirst, 'expected ArrowDown to move to a different chip');
  assert.ok(
    moved.checked,
    `expected ArrowDown to select the chip it moved to (${moved.label}), not just focus it`,
  );

  await creator.page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 15_000 });

  // The native <dialog> returns focus to whatever was focused when
  // showModal() ran, which is the trigger the user pressed. Asserting the
  // trigger specifically - rather than "focus is somewhere" - is what
  // catches the regression a user feels: a dismissed Sheet that drops
  // focus to <body> restarts the whole tab order.
  const returned = await creator.page.evaluate(() => ({
    tagName: document.activeElement?.tagName ?? '',
    label: document.activeElement?.getAttribute('aria-label') ?? '',
  }));
  assert.equal(returned.tagName, 'BUTTON');
  assert.equal(
    returned.label,
    '絞り込み',
    'expected focus to return to the filter trigger after Escape',
  );
});

/*
 * Group 4 of Issue #358: TriStateCheckbox's own indeterminate activation.
 *
 * The genre chip above is a `role="radio"` input, not a TriStateCheckbox -
 * it says nothing about whether TriStateCheckbox's own checked/unchecked/
 * indeterminate contract holds up for a real consumer. This is the one
 * shared-control-specific behavior that is not just "checkbox in general"
 * (already covered for the screen-local 2-state checkbox in group 3 above):
 * activating an *indeterminate* control resolves to `checked`, never back
 * to `unchecked` (domain/triState.ts's nextTriState).
 */
void test("Catalog filter Sheet: the group facet's TriStateCheckbox resolves indeterminate to checked, not unchecked, on Space", async () => {
  await creator.goto('/catalog');
  await creator.page
    .locator('[data-catalog-ready="true"]')
    .waitFor({ state: 'attached', timeout: 30_000 });

  const trigger = creator.page.getByRole('button', { name: '絞り込み', exact: true });
  const dialog = creator.page.locator('dialog').first();
  await clickWhenInteractive(trigger, dialog, 'opening the catalog filter Sheet');

  await creator.page.locator('[role="radiogroup"]').getByText('宝塚', { exact: true }).click();

  const groupA = creator.page.getByText(TRISTATE_GROUP_A_LABEL, { exact: true });
  const groupB = creator.page.getByText(TRISTATE_GROUP_B_LABEL, { exact: true });
  await groupA.waitFor({ state: 'visible', timeout: 10_000 });
  await groupB.waitFor({ state: 'visible', timeout: 10_000 });

  const aggregateInput = creator.page.getByLabel('組すべて');

  // Selecting exactly one of the two known groups (mouse - this establishes
  // the fixture state the keyboard step below exercises, it is not itself
  // part of what's being tested) puts the aggregate "組すべて" control into
  // `indeterminate` (domain/catalogFilterSheet.ts's secondaryAggregateState:
  // some but not all known values selected).
  await groupA.click();
  await creator.page.waitForFunction(
    () => document.querySelector('input[aria-checked="mixed"]') !== null,
    undefined,
    { timeout: 10_000 },
  );

  const beforeSpace = await aggregateInput.evaluate((el: HTMLInputElement) => ({
    indeterminate: el.indeterminate,
    ariaChecked: el.getAttribute('aria-checked'),
    checked: el.checked,
  }));
  assert.equal(
    beforeSpace.indeterminate,
    true,
    'expected the aggregate control to be indeterminate',
  );
  assert.equal(beforeSpace.ariaChecked, 'mixed');
  assert.equal(beforeSpace.checked, false);

  // Reaches the aggregate control by real keyboard focus: clicking groupA's
  // label above also focuses its native input (label click semantics), and
  // the aggregate control renders immediately before it in DOM order
  // (FilterSheet.tsx), so one Shift+Tab is the real, minimal path back to
  // it - not a programmatic .focus() that would bypass the same
  // :focus-visible mechanism group 3 above already verified generically.
  await creator.page.keyboard.press('Shift+Tab');
  const focusedLabel = await creator.page.evaluate(
    () => document.activeElement?.closest('label')?.textContent.trim() ?? '',
  );
  assert.equal(
    focusedLabel,
    '組すべて',
    'expected Shift+Tab from group A to land on the aggregate "組すべて" control',
  );

  await creator.page.keyboard.press('Space');

  const afterSpace = await aggregateInput.evaluate((el: HTMLInputElement) => ({
    indeterminate: el.indeterminate,
    ariaChecked: el.getAttribute('aria-checked'),
    checked: el.checked,
  }));
  assert.equal(
    afterSpace.checked,
    true,
    'expected Space on an indeterminate TriStateCheckbox to resolve to checked, not unchecked',
  );
  assert.equal(afterSpace.indeterminate, false);
  assert.equal(afterSpace.ariaChecked, null);

  // The aggregate resolving to checked applies to the whole facet
  // (applyAggregateToggle -> the full known-groups list), so both options
  // end up selected too - not just the aggregate's own visual state.
  const groupBChecked = await creator.page
    .locator('label')
    .filter({ hasText: TRISTATE_GROUP_B_LABEL })
    .locator('input[type="checkbox"]')
    .isChecked();
  assert.equal(groupBChecked, true, 'expected group B to become checked too');
});
