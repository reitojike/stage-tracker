import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createEventWithOccurrence, eventFixtureTitle } from '../rls/support/eventFixtures.ts';
import { createTestActor, type TestActor } from '../rls/support/testActors.ts';
import { startAppServer, type AppServer } from './support/appServer.ts';
import { launchBrowser, type Browser } from './support/browserPage.ts';
import {
  occurrenceRow,
  occurrenceSheet,
  readParticipationStatus,
  setParticipation,
} from './support/eventDetailDriver.ts';
import {
  assertNoHorizontalOverflow,
  clickWhenInteractive,
  createJourneyActor,
  runJourneyTeardown,
  type JourneyActor,
} from './support/journeyActor.ts';

// Issue #278 journey 1 of 5: **participation**.
//
// End-to-end evidence that the per-occurrence participation write actually
// travels UI -> Server Action -> typed boundary -> RLS -> re-render, and
// that My Calendar picks the result up. The domain projections underneath
// (src/domain/myCalendar.ts, participation.ts) and the DB boundary
// (test/rls/occurrenceParticipations.test.ts) are already proven
// deterministically; what has never been proven is the *wiring*, which is
// exactly where #254/#255/#257-class UI regressions lived.
//
// Fixture dates live in 2091, a year no other test file's fixtures use, so
// the My Calendar month assertion below cannot be polluted by unrelated
// rows already present in the shared local DB. Every user and fixture this
// file creates is its own (Issue #278: "test 間で shared state を持たない").

/** Both occurrences are in this month, so one My Calendar page load covers
 * the whole journey. */
const FIXTURE_MONTH = '2091-03';
/** 2091-03-05 19:00 JST (= 10:00Z) - the occurrence the journey registers. */
const ACTIVE_DATE = '2091-03-05';
const ACTIVE_STARTS_AT = '2091-03-05T10:00:00.000Z';
/** 2091-03-06 19:00 JST - canceled by the owner before the journey runs. */
const CANCELED_STARTS_AT = '2091-03-06T10:00:00.000Z';

let app: AppServer;
/** The one Chrome this file's actors share. Each actor gets its own
 * BrowserContext out of it, which is what keeps their sessions apart
 * (Issue #287) - see createJourneyActor. */
let browser: Browser;
let viewer: JourneyActor;
let owner: TestActor;
let eventId: string;
let activeOccurrenceId: string;
let canceledOccurrenceId: string;

const createdUserIds: string[] = [];
const createdActors: TestActor[] = [];
// Populated only once each resource actually exists, so after() can never
// reach an `undefined.close()` for something before() never got to
// (Issue #259 - see catalogAccess.test.ts's own identical comment).
const initializedCleanups: Array<() => Promise<void>> = [];

/** The fixture event is created through create_event, which is restricted
 * to designated catalog creators (Issue #29) - so the fixture owner needs
 * that membership. The *viewer* below deliberately does not have it: this
 * journey is about what an ordinary authenticated user does with their own
 * participation, which is never scoped to event ownership. */
async function seedEvent(): Promise<void> {
  owner = await createTestActor('participation-journey-owner', 'Str0ng-Test-Passw0rd!', {
    designatedCatalogCreator: true,
  });
  createdActors.push(owner);

  const { event, occurrence } = await createEventWithOccurrence(owner, {
    title: eventFixtureTitle(),
    startsAt: ACTIVE_STARTS_AT,
    startsOn: ACTIVE_DATE,
    endsOn: '2091-03-06',
  });
  eventId = event.id;
  activeOccurrenceId = occurrence.id;

  // A second occurrence, canceled by its owner. create_event only creates
  // the first one per event, so this is inserted directly - the same
  // owner-authenticated path catalogAccess.test.ts's insertOccurrence uses.
  const { data: canceled, error } = await owner.client
    .from('event_occurrences')
    .insert({ event_id: eventId, starts_at: CANCELED_STARTS_AT })
    .select()
    .single();
  if (error !== null) {
    throw new Error(`failed to insert the canceled fixture occurrence: ${error.message}`);
  }
  canceledOccurrenceId = canceled.id;

  // Occurrence-level cancellation, through the owner's own column-level
  // UPDATE grant (product-rules.md "Cancellation" / Issue #125) - not an
  // admin/service-role shortcut, so what the journey observes below is the
  // state a real owner cancel produces.
  const { error: cancelError } = await owner.client
    .from('event_occurrences')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', canceledOccurrenceId);
  if (cancelError !== null) {
    throw new Error(`failed to cancel the fixture occurrence: ${cancelError.message}`);
  }
}

before(async () => {
  app = await startAppServer();
  initializedCleanups.push(() => app.stop());
  await seedEvent();
  browser = await launchBrowser();
  // Registered before the first actor exists, so the process-level safety
  // net is in place even if an actor's own creation fails partway through
  // (Issue #259).
  initializedCleanups.push(() => browser.close());
  viewer = await createJourneyActor(
    browser,
    app,
    { emailPrefix: 'participation-journey' },
    (userId) => {
      createdUserIds.push(userId);
    },
  );
  initializedCleanups.push(() => viewer.close());
});

after(async () => {
  await runJourneyTeardown({
    resources: initializedCleanups,
    journeyUserIds: createdUserIds,
    fixtureActors: createdActors,
  });
});

void test('a viewer moves an occurrence from undecided to 気になる to 参加する, and My Calendar follows', async () => {
  await viewer.goto(`/catalog/events/${eventId}?month=${FIXTURE_MONTH}`);

  // The 390px smartphone-first invariant, asserted on the densest surface
  // this journey touches (Issue #278): the Event detail page carries the
  // event title, an occurrence list, and a per-occurrence action row.
  await assertNoHorizontalOverflow(viewer.page, 'the Event detail page');

  assert.equal(
    await readParticipationStatus(viewer, activeOccurrenceId),
    null,
    'expected no participation label before the journey registers one',
  );

  await setParticipation(viewer, activeOccurrenceId, '気になる');
  // A reload is genuinely required, not a shortcut: setParticipationChoiceAction
  // revalidates the route server-side, but ParticipationSheet is an
  // imperative call site with no router.refresh() of its own, so the
  // already-rendered page keeps showing the pre-write state until it is
  // fetched again. Reloading is what proves the write actually persisted
  // rather than only updating local component state.
  await viewer.goto(`/catalog/events/${eventId}?month=${FIXTURE_MONTH}`);
  assert.equal(await readParticipationStatus(viewer, activeOccurrenceId), '気になる');

  await setParticipation(viewer, activeOccurrenceId, '参加する');
  await viewer.goto(`/catalog/events/${eventId}?month=${FIXTURE_MONTH}`);
  assert.equal(await readParticipationStatus(viewer, activeOccurrenceId), '参加する');

  // My Calendar reads the same participation through an entirely separate
  // page/read path (listMyParticipations -> buildMyCalendarDayMarkers), so
  // this is what proves the write reached shared state rather than only the
  // screen it was made on. The day cell's aria-label is the marker's own
  // non-color carrier (MyMonthCalendar.tsx), which makes it both the
  // accessible presentation and a stable assertion hook.
  await viewer.goto(`/calendar?month=${FIXTURE_MONTH}`);
  const dayCell = viewer.page.locator(`[data-date="${ACTIVE_DATE}"]`);
  const label = await dayCell.getAttribute('aria-label');
  assert.ok(label !== null, `expected a day cell for ${ACTIVE_DATE} in My Calendar`);
  assert.match(label, /参加する公演1件/);
});

// --- Negative case: an effectively canceled occurrence refuses a new
// active commitment ---
//
// The guard proven here is ParticipationSheet's own `isEffectivelyCanceled`
// branch, which is what a user can actually reach. The database enforces
// the same rule independently (the occurrence_participations INSERT/UPDATE
// trigger added by supabase/migrations/20260826000200_create_event_
// occurrence_cancellation.sql, proven in test/rls/eventCancellation.test.ts)
// - this journey's job is to prove the reachable surface never offers the
// choice in the first place, which is the half no DB test can cover.
void test('an effectively canceled occurrence offers no way to start attending', async () => {
  await viewer.goto(`/catalog/events/${eventId}?month=${FIXTURE_MONTH}`);

  const row = occurrenceRow(viewer, canceledOccurrenceId);
  await assert.doesNotReject(
    row.getByText('中止', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 }),
    'expected the canceled occurrence to be labeled 中止',
  );

  const sheet = occurrenceSheet(viewer, canceledOccurrenceId, '参加の状態');
  await clickWhenInteractive(
    row.getByRole('button', { name: '変更', exact: true }),
    sheet,
    'opening the participation sheet for the canceled occurrence',
  );

  assert.equal(
    await sheet.getByRole('button', { name: '参加する', exact: true }).count(),
    0,
    'expected no 参加する choice on an effectively canceled occurrence',
  );
  assert.equal(
    await sheet.getByRole('button', { name: '気になる', exact: true }).count(),
    0,
    'expected no 気になる choice on an effectively canceled occurrence',
  );
  // The viewer has no participation on this occurrence, so there is nothing
  // to withdraw either - the sheet must say so rather than presenting an
  // empty list of choices with no explanation.
  await assert.doesNotReject(
    sheet
      .getByText('この公演は中止されているため、選択できる項目がありません。')
      .waitFor({ state: 'visible', timeout: 10_000 }),
  );

  // ...and nothing was written as a side effect of looking.
  await viewer.goto(`/catalog/events/${eventId}?month=${FIXTURE_MONTH}`);
  assert.equal(await readParticipationStatus(viewer, canceledOccurrenceId), null);
});
