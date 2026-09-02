import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { grantCatalogCreator } from '../rls/support/testActors.ts';
import { startAppServer, type AppServer } from './support/appServer.ts';
import {
  assertNoHorizontalOverflow,
  clickWhenInteractive,
  createJourneyActor,
  runJourneyTeardown,
  waitUntilGone,
  type JourneyActor,
} from './support/journeyActor.ts';

// Issue #278 journey 5 of 5: **Event write as a designated catalog creator**.
//
// The whole owner-side Event lifecycle through the real screens (Issue
// #29/#87/#88 for create, #124 for deletion, #123/#125 for cancellation):
// reach the create form from My Page, create an Event with its range and
// first occurrence, add a second occurrence, cancel and uncancel it, then
// delete the occurrence and finally the Event itself.
//
// The negative case is the write boundary itself: Event creation is
// restricted to designated catalog creators (product-rules.md "MVP Event
// catalog write boundary"), so an ordinary authenticated user gets neither
// the affordance nor the route.
//
// Fixture dates live in 2094, a year no other test file's fixtures use.

const FIXTURE_MONTH = '2094-06';
const RANGE_STARTS_ON = '2094-06-10';
const RANGE_ENDS_ON = '2094-06-11';
const FIRST_OCCURRENCE_LOCAL = '2094-06-10T18:00';
const SECOND_OCCURRENCE_LOCAL = '2094-06-11T13:00';

let app: AppServer;
/** Granted catalog_creators membership - the same membership-based
 * allowlist scripts/grant-catalog-creator.mjs writes operationally, never a
 * hard-coded UUID (product-rules.md "先行実装しないもの"). */
let creator: JourneyActor;
/** An ordinary authenticated user, deliberately without that membership. */
let ordinary: JourneyActor;
let eventTitle: string;
let eventId: string;

const createdUserIds: string[] = [];
const initializedCleanups: Array<() => Promise<void>> = [];

before(async () => {
  app = await startAppServer();
  initializedCleanups.push(() => app.stop());
  eventTitle = `event write journey ${String(Date.now())}-${Math.random().toString(36).slice(2)}`;

  creator = await createJourneyActor(app, { emailPrefix: 'event-write-journey-creator' }, (id) => {
    createdUserIds.push(id);
  });
  initializedCleanups.push(() => creator.close());
  // Granted after sign-in rather than before: membership is read per
  // request (resolveCanCreateEvent / isDesignatedCatalogCreator), so the
  // order does not matter, and this keeps the grant on the same admin path
  // the operational script uses.
  await grantCatalogCreator(creator.userId);

  ordinary = await createJourneyActor(
    app,
    { emailPrefix: 'event-write-journey-ordinary' },
    (id) => {
      createdUserIds.push(id);
    },
  );
  initializedCleanups.push(() => ordinary.close());
});

after(async () => {
  await runJourneyTeardown({
    resources: initializedCleanups,
    journeyUserIds: createdUserIds,
    // No fixture actor: the creator makes this journey's Event through the
    // app itself, so deleting the users removes everything it created.
    fixtureActors: [],
  });
});

/**
 * The one sheet currently open, whichever it is.
 *
 * A `<dialog>` that has not been `showModal()`-ed is `display: none` and so
 * absent from the accessibility tree, which makes a bare `dialog` role
 * locator resolve to exactly the open one - useful on the Event edit
 * screen, where every occurrence row and every lifecycle action mounts its
 * own sheet, and several of their titles are dynamic
 * (OccurrenceUpdateForm's title is the occurrence's own date/time label).
 */
function openSheet(actor: JourneyActor) {
  return actor.page.getByRole('dialog');
}

const editPath = () => `/catalog/events/${eventId}/edit?month=${FIXTURE_MONTH}`;
const detailPath = () => `/catalog/events/${eventId}?month=${FIXTURE_MONTH}`;

/**
 * The edit screen's 公演回 section.
 *
 * Scoping to it is required, not tidiness: the 開催期間 section above it
 * carries its own 変更 trigger (EventRangeEditForm), so a page-wide 変更
 * locator silently counts one extra control and shifts every occurrence
 * index by one. Matched by the section's own heading rather than by a
 * CSS-module class, which is hashed.
 */
function occurrenceSection(actor: JourneyActor) {
  return actor.page
    .locator('main section')
    .filter({ has: actor.page.getByRole('heading', { name: '公演回', exact: true }) });
}

/** One 変更 trigger per occurrence, in the chronological order the page
 * lists them. */
function occurrenceEditTrigger(actor: JourneyActor, index: number) {
  return occurrenceSection(actor).getByRole('button', { name: '変更', exact: true }).nth(index);
}

async function occurrenceCount(actor: JourneyActor): Promise<number> {
  return occurrenceSection(actor).getByRole('button', { name: '変更', exact: true }).count();
}

// --- Negative case: the Event create boundary ---
//
// Runs first, before the creator has written anything, so it observes the
// boundary rather than the aftermath. The guard is designated catalog
// creator membership: `isDesignatedCatalogCreator` gates both the My Page
// affordance (via ../_lib/creatorCapability.ts's resolveCanCreateEvent) and
// the create route itself, and underneath both the create_event RPC raises
// insufficient_privilege for a non-creator regardless. product-rules.md:
// "MVP では Event の新規作成を一般 authenticated user へ開放せず、
// designated catalog creator（Administrator）だけに許可します".
void test('an ordinary authenticated user gets neither the create affordance nor the create route', async () => {
  await ordinary.goto('/mypage');
  assert.equal(
    await ordinary.page.getByRole('link', { name: 'イベントを追加' }).count(),
    0,
    'expected no イベントを追加 row for a non-creator',
  );
  // The row is hidden outright rather than shown disabled - and the rest of
  // the section still renders, so this is a real absence, not a failed page.
  await assert.doesNotReject(
    ordinary.page
      .getByRole('link', { name: '招待一覧' })
      .waitFor({ state: 'visible', timeout: 10_000 }),
    'expected the rest of the 予定とイベント section to still render',
  );

  // Reaching the route directly is refused explicitly, with no form behind
  // the denial - and refused as a *permission* problem, never as a
  // not-found or an error that would misreport the cause.
  await ordinary.goto(`/catalog/events/new?month=${FIXTURE_MONTH}`);
  await assert.doesNotReject(
    ordinary.page
      .getByText('イベントを作成する権限がありません')
      .waitFor({ state: 'visible', timeout: 10_000 }),
  );
  assert.equal(
    await ordinary.page.getByLabel('タイトル').count(),
    0,
    'expected no create form behind the denial',
  );
});

void test('a designated catalog creator reaches the create form from My Page and creates an Event with its range and first occurrence', async () => {
  await creator.goto('/mypage');
  const addLink = creator.page.getByRole('link', { name: 'イベントを追加' });
  await assert.doesNotReject(
    addLink.waitFor({ state: 'visible', timeout: 10_000 }),
    'expected the イベントを追加 row for a designated catalog creator',
  );
  await addLink.click();
  await creator.page.waitForURL(/\/catalog\/events\/new/, { timeout: 30_000 });

  await assertNoHorizontalOverflow(creator.page, 'the Event create form');

  await creator.page.getByLabel('タイトル').fill(eventTitle);
  await creator.page.getByLabel('初日').fill(RANGE_STARTS_ON);
  await creator.page.getByLabel('千秋楽').fill(RANGE_ENDS_ON);
  // The initial occurrence is optional (Issue #87/#88: an Event may have
  // zero occurrences at create time); this journey supplies one so the
  // later add/cancel/delete steps have something to sit beside.
  await creator.page.getByLabel('開演日時').fill(FIRST_OCCURRENCE_LOCAL);
  await creator.page.getByRole('button', { name: 'イベントを作成' }).click();

  // createEventAction redirects to the new Event's detail page, so the URL
  // is both the completion signal and the source of its id - a rejected
  // submission would stay on /catalog/events/new with a StatePanel.
  await creator.page.waitForURL(/\/catalog\/events\/[0-9a-f-]+(\?|$)/, { timeout: 30_000 });
  const [, id] = /\/catalog\/events\/([0-9a-f-]+)/.exec(creator.page.url()) ?? [];
  assert.ok(id !== undefined, `could not read an event id out of ${creator.page.url()}`);
  eventId = id;

  await assert.doesNotReject(
    creator.page.getByText(eventTitle).first().waitFor({ state: 'visible', timeout: 10_000 }),
    'expected the new Event detail screen to show its title',
  );
  // Ownership follows creation: only the creator gets the edit affordance.
  await assert.doesNotReject(
    creator.page.getByRole('link', { name: '編集' }).waitFor({ state: 'visible', timeout: 10_000 }),
  );
  await ordinary.goto(detailPath());
  assert.equal(
    await ordinary.page.getByRole('link', { name: '編集' }).count(),
    0,
    'expected no edit affordance for a non-owner, even on a readable shared catalog Event',
  );
});

void test('the owner adds a second occurrence from the edit screen', async () => {
  await creator.goto(editPath());
  await assertNoHorizontalOverflow(creator.page, 'the Event edit screen');
  assert.equal(await occurrenceCount(creator), 1);

  const sheet = openSheet(creator);
  await clickWhenInteractive(
    creator.page.getByRole('button', { name: '＋ 追加' }),
    sheet,
    'opening the add-occurrence sheet',
  );
  await sheet.getByLabel('開演日時').fill(SECOND_OCCURRENCE_LOCAL);
  await sheet.getByRole('button', { name: '公演回を追加', exact: true }).click();
  await waitUntilGone(sheet, 30_000);

  await creator.goto(editPath());
  assert.equal(await occurrenceCount(creator), 2, 'expected the added occurrence to persist');
});

void test('the owner cancels an occurrence and then uncancels it, without deleting anything', async () => {
  await creator.goto(editPath());
  // The 中止 badge is a Badge whose whole text is exactly 中止 - the
  // lifecycle buttons ("この公演回を中止") merely contain that substring, so
  // an exact match is what separates state from affordance here.
  const canceledBadges = () =>
    occurrenceSection(creator).getByText('中止', { exact: true }).filter({ visible: true });
  assert.equal(await canceledBadges().count(), 0, 'expected nothing canceled to begin with');

  const sheet = openSheet(creator);
  await clickWhenInteractive(
    occurrenceEditTrigger(creator, 1),
    sheet,
    'opening the second occurrence sheet',
  );
  await sheet.getByRole('button', { name: 'この公演回を中止' }).click();

  await creator.goto(editPath());
  assert.equal(
    await canceledBadges().count(),
    1,
    'expected exactly the canceled occurrence to be marked',
  );
  // Cancellation is not deletion: the occurrence itself stays (product-rules.md
  // "Cancellation" - downstream data is retained, unlike a delete).
  assert.equal(await occurrenceCount(creator), 2);

  // ...and it is reversible, which is why it needs no destructive
  // confirmation of its own.
  const uncancelSheet = openSheet(creator);
  await clickWhenInteractive(
    occurrenceEditTrigger(creator, 1),
    uncancelSheet,
    'reopening the second occurrence sheet',
  );
  await uncancelSheet.getByRole('button', { name: 'この公演回の中止を解除' }).click();

  await creator.goto(editPath());
  assert.equal(await canceledBadges().count(), 0, 'expected the cancellation to be lifted');
  assert.equal(await occurrenceCount(creator), 2);
});

void test('the owner deletes the occurrence and then the Event, and the Event stops resolving', async () => {
  await creator.goto(editPath());
  const sheet = openSheet(creator);
  await clickWhenInteractive(
    occurrenceEditTrigger(creator, 1),
    sheet,
    'opening the second occurrence sheet to delete it',
  );
  // Deletion is irreversible (no soft delete/trash/restore -
  // product-rules.md "Deletion"), so it is confirmed in its own sheet
  // rather than executed from the row.
  await sheet.getByRole('button', { name: 'この公演回を削除' }).click();
  const confirmSheet = creator.page.getByRole('dialog', { name: 'この公演回を削除' });
  await confirmSheet.waitFor({ state: 'visible', timeout: 15_000 });
  await confirmSheet.getByRole('button', { name: '削除', exact: true }).click();

  await creator.goto(editPath());
  assert.equal(await occurrenceCount(creator), 1, 'expected the deleted occurrence to be gone');

  const deleteEventTrigger = creator.page.getByRole('button', { name: 'このイベントを削除' });
  const deleteEventSheet = creator.page.getByRole('dialog', { name: 'このイベントを削除' });
  await clickWhenInteractive(
    deleteEventTrigger,
    deleteEventSheet,
    'opening the delete-event confirmation sheet',
  );
  await deleteEventSheet.getByRole('button', { name: '削除', exact: true }).click();
  // deleteEventAction redirects to /catalog - the deleted Event's own
  // detail page no longer exists to return to.
  await creator.page.waitForURL(/\/catalog(\?|$)/, { timeout: 30_000 });

  // A deleted Event is a distinct "not found" state for everyone, never an
  // error and never a stale render.
  await creator.goto(detailPath());
  await assert.doesNotReject(
    creator.page.getByText('指定された公演が見つかりません').waitFor({
      state: 'visible',
      timeout: 10_000,
    }),
  );
});
