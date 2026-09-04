import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createEventWithOccurrence, eventFixtureTitle } from '../rls/support/eventFixtures.ts';
import { importOpportunity } from '../rls/support/ticketOpportunityFixtures.ts';
import { createTestActor, type TestActor } from '../rls/support/testActors.ts';
import { startAppServer, type AppServer } from './support/appServer.ts';
import { launchBrowser, type Browser } from './support/browserPage.ts';
import {
  assertNoHorizontalOverflow,
  createJourneyActor,
  runJourneyTeardown,
  type JourneyActor,
} from './support/journeyActor.ts';

// Issue #278 journey 4 of 5: **ticket planning state**.
//
// The personal half of the Ticket Opportunity MVP (Issue #144/#157/#162):
// against an already-imported shared Opportunity, one user moves their own
// planning state 未登録 -> planned -> applied -> 未登録 and watches both
// surfaces that read it follow - /tickets' own row, and Home's 申し込み期限
// block, whose selection depends on that state being exactly `planned`.
//
// Unlike the other journeys, the fixture dates here are *relative to now*
// rather than in a reserved far-future year: both surfaces deliberately
// project only non-past, near-term rows (/tickets shows the current-or-next
// milestone per Opportunity; Home's block is bounded to today..+14 Asia/
// Tokyo days), so a far-future fixture would correctly render nowhere. What
// keeps this file's assertions its own is the unique Event title and
// Opportunity display name it generates, never the date.

/** Comfortably inside Home's today..+14 day window (HOME_WINDOW_DAYS), and
 * far enough out that a run straddling midnight JST cannot push it past. */
const DEADLINE_DAYS_AHEAD = 5;
const OCCURRENCE_DAYS_AHEAD = 40;

const DAY_MS = 24 * 60 * 60 * 1000;

let app: AppServer;
/** The one Chrome this file's actors share. Each actor gets its own
 * BrowserContext out of it, which is what keeps their sessions apart
 * (Issue #287) - see createJourneyActor. */
let browser: Browser;
/** The user whose personal planning state this journey drives. */
let planner: JourneyActor;
/** A second signed-in user, for the negative case: personal planning state
 * is owner-only, so this one must see the same shared Opportunity with no
 * state on it at all. */
let bystander: JourneyActor;
let owner: TestActor;
let eventTitle: string;
let opportunityName: string;

const createdUserIds: string[] = [];
const createdActors: TestActor[] = [];
const initializedCleanups: Array<() => Promise<void>> = [];

/**
 * Seeds one Event plus one TicketOpportunity with an `application_close`
 * milestone.
 *
 * The Opportunity goes in through `import_ticket_opportunity`, which is
 * the *only* write path shared Ticket data has (product-rules.md "Shared /
 * personal authority boundary": no ordinary-user creation surface exists,
 * by design) - so this is the existing write boundary, not a shortcut
 * around one.
 */
async function seedOpportunity(): Promise<void> {
  owner = await createTestActor('ticket-journey-owner', 'Str0ng-Test-Passw0rd!', {
    designatedCatalogCreator: true,
  });
  createdActors.push(owner);

  eventTitle = eventFixtureTitle();
  const { event } = await createEventWithOccurrence(owner, {
    title: eventTitle,
    startsAt: new Date(Date.now() + OCCURRENCE_DAYS_AHEAD * DAY_MS).toISOString(),
  });

  opportunityName = `journey先行-${String(Date.now())}`;
  await importOpportunity(event.id, {
    displayName: opportunityName,
    targetScope: 'event_wide',
    milestones: [
      {
        milestone_type: 'application_close',
        // `datetime` precision, so the source's own time survives - the
        // model never fabricates one for a date-only milestone, and this
        // journey has a real time to give.
        temporal_precision: 'datetime',
        at: new Date(Date.now() + DEADLINE_DAYS_AHEAD * DAY_MS).toISOString(),
      },
    ],
  });
}

before(async () => {
  app = await startAppServer();
  initializedCleanups.push(() => app.stop());
  await seedOpportunity();
  browser = await launchBrowser();
  // Registered before the first actor exists, so the process-level safety
  // net is in place even if an actor's own creation fails partway through
  // (Issue #259).
  initializedCleanups.push(() => browser.close());
  planner = await createJourneyActor(
    browser,
    app,
    { emailPrefix: 'ticket-journey-planner' },
    (id) => {
      createdUserIds.push(id);
    },
  );
  initializedCleanups.push(() => planner.close());
  bystander = await createJourneyActor(
    browser,
    app,
    { emailPrefix: 'ticket-journey-bystander' },
    (id) => {
      createdUserIds.push(id);
    },
  );
  initializedCleanups.push(() => bystander.close());
});

after(async () => {
  await runJourneyTeardown({
    resources: initializedCleanups,
    journeyUserIds: createdUserIds,
    fixtureActors: createdActors,
  });
});

/** This journey's own Opportunity row on /tickets. The shared local DB
 * holds other files' Opportunities too, so every assertion is scoped to
 * the row naming this run's unique Opportunity. */
function opportunityRow(actor: JourneyActor) {
  return actor.page.locator('main li').filter({ hasText: opportunityName });
}

/**
 * The row's single state Badge, matched by its own text.
 *
 * Not an exact-text match: Badge's `done` variant (which `applied` maps to)
 * prepends a component-owned "✓ " inside the same element, deliberately so
 * that state is never carried by color alone - so the element's text is
 * "✓ 申し込み済み", and the checkmark is stripped here rather than baked
 * into the expected string. The anchored pattern is still what keeps this
 * from matching the transition buttons, whose labels ("申し込む予定にする",
 * "申し込む予定に戻す") contain these same substrings.
 */
const STATE_BADGE_PATTERN = /^(?:✓\s*)?(?:申し込む予定|申し込み済み)$/u;

async function stateBadgeLabel(actor: JourneyActor): Promise<string | null> {
  const texts = await opportunityRow(actor)
    .locator('span')
    .filter({ hasText: STATE_BADGE_PATTERN })
    .filter({ visible: true })
    .allInnerTexts();
  return texts[0]?.replace(/^✓\s*/u, '').trim() ?? null;
}

/** Polls until the row's state Badge reads `expected` (null for no badge at
 * all), so an assertion never races the server re-render the state write
 * triggers. */
async function waitForStateBadge(
  actor: JourneyActor,
  expected: string | null,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const actual = await stateBadgeLabel(actor);
    if (actual === expected) {
      return;
    }
    if (Date.now() > deadline) {
      assert.equal(
        actual,
        expected,
        `the Opportunity row's state badge never became ${expected ?? 'absent'}`,
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Presses one of the row's planning-state buttons and waits for the row to
 * actually reflect the result.
 *
 * The control is a real `<form>` whose action revalidates /tickets, so the
 * row re-renders from the server; waiting for the *next* state's button to
 * appear is therefore evidence the write landed, not just that a click was
 * dispatched. TicketOpportunityStateControls renders exactly one
 * transition button per state (plus 登録を解除 once registered), so the
 * button set is itself an unambiguous readout of the current state.
 */
async function pressStateButton(
  actor: JourneyActor,
  press: string,
  expectNext: string,
): Promise<void> {
  const row = opportunityRow(actor);
  await row.getByRole('button', { name: press, exact: true }).click();
  await row
    .getByRole('button', { name: expectNext, exact: true })
    .waitFor({ state: 'visible', timeout: 30_000 });
}

/** Whether Home's 申し込み期限 block currently carries a card for this
 * journey's Opportunity. */
async function homeDeadlineShowsOpportunity(actor: JourneyActor): Promise<boolean> {
  await actor.goto('/');
  return (await actor.page.getByText(opportunityName, { exact: true }).count()) > 0;
}

void test('an imported Opportunity is visible with no personal state, and Home shows no deadline for it yet', async () => {
  await planner.goto('/tickets');
  await assertNoHorizontalOverflow(planner.page, 'the ticket schedule');

  const row = opportunityRow(planner);
  await assert.doesNotReject(
    row.waitFor({ state: 'visible', timeout: 15_000 }),
    `expected the imported Opportunity ${opportunityName} on /tickets`,
  );
  assert.ok((await row.getByText(eventTitle).count()) > 0, 'expected the row to name its Event');

  // Absence of a row is "not registered as a planning target", not a
  // distinct status (product-rules.md "UserTicketOpportunityState") - so
  // the only offer is to register, and there is nothing to unregister.
  await assert.doesNotReject(
    row.getByRole('button', { name: '申し込む予定にする', exact: true }).waitFor({
      state: 'visible',
      timeout: 10_000,
    }),
  );
  assert.equal(await row.getByRole('button', { name: '登録を解除', exact: true }).count(), 0);

  // Home's deadline block selects only the caller's own `planned` rows, so
  // an unregistered Opportunity must not appear there even though its
  // deadline is well inside the window.
  assert.equal(
    await homeDeadlineShowsOpportunity(planner),
    false,
    'expected no Home deadline card before the Opportunity is planned',
  );
});

void test('planned then applied then unregistered, with /tickets and Home following each step', async () => {
  await planner.goto('/tickets');
  await pressStateButton(planner, '申し込む予定にする', '申し込み済みにする');

  await waitForStateBadge(planner, '申し込む予定');
  // A `planned` application_close inside the window is exactly what Home's
  // deadline block is for.
  assert.ok(
    await homeDeadlineShowsOpportunity(planner),
    'expected a Home deadline card once the Opportunity is planned',
  );
  await assertNoHorizontalOverflow(planner.page, 'Home with a deadline card');

  await planner.goto('/tickets');
  await pressStateButton(planner, '申し込み済みにする', '申し込む予定に戻す');
  await waitForStateBadge(planner, '申し込み済み');
  // `applied` is not a deadline to act on any more - Home's block is
  // specifically the caller's own *planned* applications, so the card goes.
  assert.equal(
    await homeDeadlineShowsOpportunity(planner),
    false,
    'expected the Home deadline card to disappear once applied',
  );

  await planner.goto('/tickets');
  await pressStateButton(planner, '登録を解除', '申し込む予定にする');
  // Back to "not registered as a planning target" - which is the absence of
  // a row, not a third status, so the row carries no state badge at all.
  await waitForStateBadge(planner, null);
  assert.equal(await homeDeadlineShowsOpportunity(planner), false);
});

// --- Negative case: personal planning state is the owner's alone ---
//
// The guard is user_ticket_opportunity_states' owner-only RLS
// (`user_ticket_opportunity_states_select_own`, supabase/migrations/
// 20260828000200_create_user_ticket_opportunity_states.sql), surfaced
// through listTicketOpportunitiesWithDetails' per-caller `myState`.
// product-rules.md: "owner 本人だけが read/write できます". The shared
// Opportunity itself stays readable by every authenticated user - what must
// not leak is who is planning to apply for it.
//
// Also covered here: /tickets offers no Opportunity-creation affordance at
// all (product-rules.md "Shared / personal authority boundary"), so an
// ordinary user cannot write shared catalog data from this screen.
void test('another signed-in user sees the same Opportunity with no trace of the planner’s state', async () => {
  // Put a state back on it, so the bystander is looking at an Opportunity
  // that genuinely has one - just not theirs.
  await planner.goto('/tickets');
  await pressStateButton(planner, '申し込む予定にする', '申し込み済みにする');

  await bystander.goto('/tickets');
  const row = opportunityRow(bystander);
  await assert.doesNotReject(
    row.waitFor({ state: 'visible', timeout: 15_000 }),
    'expected the shared Opportunity to be readable by any authenticated user',
  );

  assert.equal(
    await stateBadgeLabel(bystander),
    null,
    'expected no sign of the planner’s own state on the bystander’s row',
  );
  assert.equal(
    await row.getByRole('button', { name: '登録を解除', exact: true }).count(),
    0,
    'expected the bystander to have nothing registered to unregister',
  );
  await assert.doesNotReject(
    row.getByRole('button', { name: '申し込む予定にする', exact: true }).waitFor({
      state: 'visible',
      timeout: 10_000,
    }),
    'expected the bystander to see the unregistered control set',
  );
  assert.equal(
    await homeDeadlineShowsOpportunity(bystander),
    false,
    'expected the planner’s deadline not to appear on another user’s Home',
  );

  // No creation surface for shared Ticket data anywhere on this screen.
  await bystander.goto('/tickets');
  for (const label of ['+ 追加', '＋ 追加', '追加']) {
    assert.equal(
      await bystander.page
        .locator('main')
        .getByRole('button', { name: label, exact: true })
        .count(),
      0,
      `expected no Opportunity-creation affordance labeled ${label} on /tickets`,
    );
  }
});
