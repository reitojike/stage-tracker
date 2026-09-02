import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startAppServer, type AppServer } from './support/appServer.ts';
import {
  assertNoHorizontalOverflow,
  clickWhenInteractive,
  createJourneyActor,
  runJourneyTeardown,
  waitUntilGone,
  type JourneyActor,
} from './support/journeyActor.ts';

// Issue #278 journey 3 of 5: **personal schedule sharing**.
//
// The full owner/recipient round trip for an event-independent personal
// schedule entry (Issue #37/#121, over #55's exact-registered-email
// targeting): create a time-bounded entry, share it by email, see it
// appear on the recipient's own My Calendar as a *shared* blocking entry,
// have the recipient leave the share, re-share, and finally delete the
// entry so it disappears for both.
//
// Unlike participation and invitation, nothing here goes through a
// catalog fixture: any authenticated user may create their own entry
// (personal_schedule_entries_insert_own), so this file provisions only its
// own two users. Fixture dates live in 2093, a year no other test file's
// fixtures use.

const FIXTURE_MONTH = '2093-05';
const FIXTURE_DATE = '2093-05-12';
/** A time-bounded (not all-day) entry, as the Issue's journey specifies -
 * `datetime-local` values are wall-clock Asia/Tokyo, which is what the
 * form's own timezone note tells the user they are entering. */
const STARTS_AT_LOCAL = `${FIXTURE_DATE}T13:00`;
const ENDS_AT_LOCAL = `${FIXTURE_DATE}T15:30`;

let app: AppServer;
let owner: JourneyActor;
let recipient: JourneyActor;
/** Unique per run, so this file's assertions can never match an entry left
 * behind by anything else in the shared local DB. */
let entryTitle: string;
let entryId: string;

const createdUserIds: string[] = [];
const initializedCleanups: Array<() => Promise<void>> = [];

before(async () => {
  app = await startAppServer();
  initializedCleanups.push(() => app.stop());
  entryTitle = `schedule journey ${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
  owner = await createJourneyActor(app, { emailPrefix: 'schedule-journey-owner' }, (id) => {
    createdUserIds.push(id);
  });
  initializedCleanups.push(() => owner.close());
  recipient = await createJourneyActor(app, { emailPrefix: 'schedule-journey-recipient' }, (id) => {
    createdUserIds.push(id);
  });
  initializedCleanups.push(() => recipient.close());
});

after(async () => {
  await runJourneyTeardown({
    resources: initializedCleanups,
    journeyUserIds: createdUserIds,
    // No fixture actor: this journey's data is created by its own users
    // through the app, so deleting them removes everything it made.
    fixtureActors: [],
  });
});

/** The My Calendar day cell for this journey's date, whose aria-label is
 * the marker's own non-color carrier (MyMonthCalendar.tsx) and therefore
 * both the accessible presentation and a stable assertion hook. */
async function dayCellLabel(actor: JourneyActor): Promise<string> {
  await actor.goto(`/calendar?month=${FIXTURE_MONTH}`);
  const label = await actor.page
    .locator(`[data-date="${FIXTURE_DATE}"]`)
    .getAttribute('aria-label');
  assert.ok(label !== null, `expected a My Calendar day cell for ${FIXTURE_DATE}`);
  return label;
}

/** The entry's row in the selected-day list, if this actor can see it. */
function entryRow(actor: JourneyActor) {
  return actor.page.locator('main a').filter({ hasText: entryTitle });
}

async function canSeeEntryOnCalendar(actor: JourneyActor): Promise<boolean> {
  await actor.goto(`/calendar?month=${FIXTURE_MONTH}&date=${FIXTURE_DATE}`);
  return (await entryRow(actor).count()) > 0;
}

/** Opens the entry's detail screen for whoever can reach it. */
async function openEntryDetail(actor: JourneyActor): Promise<void> {
  await actor.goto(`/schedule/${entryId}?month=${FIXTURE_MONTH}`);
}

void test('an owner creates a time-bounded entry and it appears on their own My Calendar', async () => {
  await owner.goto(`/schedule/new?date=${FIXTURE_DATE}`);
  await assertNoHorizontalOverflow(owner.page, 'the schedule create form');

  await owner.page.getByLabel('件名').fill(entryTitle);

  // Arriving with a `date` prefills an *all-day* entry
  // (resolveScheduleCreatePrefill), which is My Calendar's own selected-day
  // add contract - so switching to 時刻を指定 is a real step of this
  // journey, not setup noise. The radio itself is visually hidden, so this
  // clicks its label the way a user taps the segment.
  await owner.page.getByText('時刻を指定', { exact: true }).click();
  const startsAt = owner.page.getByLabel('開始日時');
  await startsAt.waitFor({ state: 'visible', timeout: 10_000 });
  await startsAt.fill(STARTS_AT_LOCAL);
  await owner.page.getByLabel('終了日時').fill(ENDS_AT_LOCAL);
  // `blocking` defaults to checked (ScheduleFields.tsx) - left as-is, since
  // this journey is specifically about a blocking entry propagating to a
  // recipient's availability.
  await owner.page.getByRole('button', { name: '予定を作成' }).click();
  // createScheduleEntryAction redirects to /calendar on success, so the URL
  // itself is the completion signal - and a rejected submission would stay
  // on /schedule/new with a StatePanel instead.
  await owner.page.waitForURL(/\/calendar/, { timeout: 30_000 });

  assert.ok(
    await canSeeEntryOnCalendar(owner),
    'expected the new entry on the owner’s own selected-day list',
  );
  assert.match(await dayCellLabel(owner), /自分の予定1件/);

  // The entry's own id, taken from the row's link rather than from the DB,
  // so every later navigation uses the same href a user would follow.
  await owner.goto(`/calendar?month=${FIXTURE_MONTH}&date=${FIXTURE_DATE}`);
  const href = await entryRow(owner).first().getAttribute('href');
  assert.ok(href !== null, 'expected the entry row to link to its detail screen');
  const [, id] = /\/schedule\/([0-9a-f-]+)/.exec(href) ?? [];
  assert.ok(id !== undefined, `could not read an entry id out of ${href}`);
  entryId = id;
});

void test('sharing by exact email puts the entry on the recipient’s calendar as a shared blocking entry', async () => {
  await openEntryDetail(owner);
  await assertNoHorizontalOverflow(owner.page, 'the schedule entry detail screen');
  // Nothing is shared yet, and that is stated rather than left blank.
  await assert.doesNotReject(
    owner.page
      .getByText('まだ誰とも共有していません')
      .waitFor({ state: 'visible', timeout: 10_000 }),
  );

  const sheet = owner.page.getByRole('dialog', { name: '共有相手を追加' });
  await clickWhenInteractive(
    owner.page.getByRole('button', { name: '+ 追加' }),
    sheet,
    'opening the share-add sheet',
  );
  await sheet.getByLabel('共有相手のメールアドレス').fill(recipient.email);
  await sheet.getByRole('button', { name: '共有相手を追加', exact: true }).click();
  await waitUntilGone(sheet, 30_000);

  // The owner's bounded recipient projection identifies the recipient by
  // the exact email they were added with (#55 / listScheduleShareRecipientEmails)
  // - never by a raw user id, and never as a general directory.
  await openEntryDetail(owner);
  await assert.doesNotReject(
    owner.page.getByText(recipient.email).waitFor({ state: 'visible', timeout: 10_000 }),
    'expected the recipient to be listed by their exact email',
  );

  // The recipient sees it on their own My Calendar, as a *shared* entry
  // that still blocks - `blocking` is the entry's own attribute and
  // propagates with the same meaning (product-rules.md: per-recipient
  // blocking overrides do not exist).
  assert.match(await dayCellLabel(recipient), /共有された予定1件/);
  assert.ok(
    await canSeeEntryOnCalendar(recipient),
    'expected the entry on the recipient’s day list',
  );
  await openEntryDetail(recipient);
  await assert.doesNotReject(
    recipient.page.getByText('共有されている予定').waitFor({ state: 'visible', timeout: 10_000 }),
  );
});

// --- Negative case: a shared recipient may read, never write ---
//
// The guard is ownership: only the entry's owner may update or delete it
// (personal_schedule_entries_update_own / _delete_own), and the recipient's
// wider *read* visibility must not turn into any of that. Two reachable
// surfaces carry it - the detail screen renders owner-only affordances
// inside its own `isOwner` branch, and the edit route answers a non-owner
// with an explicit permission denial rather than an editable form.
void test('a shared recipient gets no owner affordances and is refused the edit screen', async () => {
  await openEntryDetail(recipient);

  assert.equal(
    await recipient.page.getByRole('link', { name: '編集' }).count(),
    0,
    'expected no edit affordance for a shared recipient',
  );
  assert.equal(
    await recipient.page.getByRole('button', { name: '削除', exact: true }).count(),
    0,
    'expected no delete affordance for a shared recipient',
  );
  // ...and adding/removing other recipients is the owner's alone
  // (product-rules.md: "共有先 user は...他の共有相手を追加・削除できません").
  assert.equal(
    await recipient.page.getByRole('button', { name: '+ 追加' }).count(),
    0,
    'expected no recipient-management affordance for a shared recipient',
  );

  // Reaching the edit URL directly is refused with an explicit denial, not
  // an editable form and not a "not found" that would misreport the cause.
  await recipient.goto(`/schedule/${entryId}/edit?month=${FIXTURE_MONTH}`);
  await assert.doesNotReject(
    recipient.page
      .getByText('この予定を編集する権限がありません')
      .waitFor({ state: 'visible', timeout: 10_000 }),
  );
  assert.equal(
    await recipient.page.getByLabel('件名').count(),
    0,
    'expected no editable form behind the denial',
  );
});

void test('the recipient can leave the share on their own, which leaves the entry itself untouched', async () => {
  await openEntryDetail(recipient);
  await recipient.page.getByRole('button', { name: 'この予定の共有から外れる' }).click();
  await recipient.page.waitForURL(/\/calendar/, { timeout: 30_000 });

  assert.equal(
    await canSeeEntryOnCalendar(recipient),
    false,
    'expected the entry to be gone from the recipient’s calendar after leaving',
  );
  // Self-leave is not entry deletion (product-rules.md "Entry deletion
  // semantics"): the entry stays for its owner, and for any other
  // recipient.
  assert.ok(
    await canSeeEntryOnCalendar(owner),
    'expected the owner to still have the entry after a recipient left',
  );
});

void test('deleting the entry removes it for the owner and every recipient at once', async () => {
  // Re-share first, so the deletion below is genuinely observed from both
  // sides - and so leaving a share is shown not to be a permanent block on
  // being shared with again.
  await openEntryDetail(owner);
  const shareSheet = owner.page.getByRole('dialog', { name: '共有相手を追加' });
  await clickWhenInteractive(
    owner.page.getByRole('button', { name: '+ 追加' }),
    shareSheet,
    'reopening the share-add sheet',
  );
  await shareSheet.getByLabel('共有相手のメールアドレス').fill(recipient.email);
  await shareSheet.getByRole('button', { name: '共有相手を追加', exact: true }).click();
  await waitUntilGone(shareSheet, 30_000);
  assert.ok(
    await canSeeEntryOnCalendar(recipient),
    'expected the recipient to be shared with again',
  );

  await openEntryDetail(owner);
  const deleteSheet = owner.page.getByRole('dialog', { name: '削除' });
  await clickWhenInteractive(
    owner.page.getByRole('button', { name: '削除', exact: true }),
    deleteSheet,
    'opening the delete confirmation sheet',
  );
  // Irreversible, so it is confirmed rather than immediate - and the
  // confirmation says so, including the part recipients are affected by.
  await assert.doesNotReject(
    deleteSheet.getByText('共有相手からもこの予定が見えなくなります').waitFor({
      state: 'visible',
      timeout: 10_000,
    }),
  );
  await deleteSheet.getByRole('button', { name: '削除', exact: true }).click();
  await owner.page.waitForURL(/\/calendar/, { timeout: 30_000 });

  assert.equal(
    await canSeeEntryOnCalendar(owner),
    false,
    'expected the deleted entry to be gone for its owner',
  );
  assert.equal(
    await canSeeEntryOnCalendar(recipient),
    false,
    'expected the deleted entry to be gone for the recipient too',
  );
});
