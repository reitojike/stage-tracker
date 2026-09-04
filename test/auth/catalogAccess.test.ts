import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  createEventWithOccurrence,
  createEventWithoutOccurrence,
  eventFixtureTitle,
} from '../rls/support/eventFixtures.ts';
import {
  createAdminClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from '../rls/support/testActors.ts';
import { startAppServer, type AppServer } from './support/appServer.ts';
import { deleteUser } from './support/authActors.ts';
import { collectCleanupFailures } from './support/cleanupTasks.ts';
import { signInThroughApp } from './support/signInThroughApp.ts';
import { launchBrowser, type Browser, type BrowserPage } from './support/browserPage.ts';

// Real end-to-end acceptance evidence for the authenticated shared Event
// catalog vertical slice (Issue #20): a real Next.js app server, a real
// local Supabase/RLS instance, and a real signed-in session (never a
// Supabase-SDK shortcut - see signInThroughApp). Fine-grained band/badge
// layout correctness is proven deterministically in
// src/domain/__tests__/calendarMonth.test.ts; this file instead proves the
// *wiring*: that real data from #12's read layer, filtered by real RLS,
// actually reaches the authenticated Catalog UI (src/app/catalog).
//
// Fixture dates are chosen in far-future months (2096-2098) not used by any
// other test file's fixtures, so this file's badge/empty assertions cannot
// be polluted by unrelated fixtures already present in the shared local DB.
// Since Issue #301 that separation is no longer a convention that merely
// happens to hold: test:auth now runs its files concurrently, so a second
// file creating an Event in one of these months would overlap this file's
// own run instead of being torn down before it starts. RESERVED_MONTHS and
// assertReservedMonthIsExclusivelyOurs below turn that precondition into a
// checked one - see their comments.
//
// Issue #145: /catalog's calendar/list body is now a client-gated render
// (CatalogView.tsx's `readyToRenderBody`) whenever the range read is
// non-empty - deliberately, so a restored browser-local filter selection
// never gets overridden by a briefly-shown unfiltered flash (the Issue's
// canonical addendum). A plain `fetch()` never executes client JS, so it can
// only ever observe the pending state for a populated catalog - it can no
// longer prove real data reaches the rendered UI the way this file's own
// stated purpose requires. Tests that need the resolved calendar/list markup
// therefore drive a real headless Chrome via `renderedHtml` below instead;
// tests whose assertions are about synchronously-rendered content (auth
// redirects, the heading, a genuinely empty range) keep using plain fetch,
// since #145 does not gate those.

let app: AppServer;
let browser: Browser;
let page: BrowserPage;
const createdViewerIds: string[] = [];
const createdFixtureActors: TestActor[] = [];

// Populated incrementally, right after each resource is actually created -
// not derived from app/browser/page's own (always-non-optional) types -
// so after() below only ever attempts to close what before() actually
// initialized (Issue #259). If before() throws partway (e.g. launchBrowser()
// rejects after startAppServer() already succeeded), app/browser/page keep
// whatever partial values they had, but this list only contains app's
// cleanup - browser/page were never pushed, so after() cannot reach a
// secondary `undefined.close()` TypeError for them.
const initializedCleanups: Array<() => Promise<void>> = [];

before(async () => {
  app = await startAppServer();
  initializedCleanups.push(() => app.stop());
  browser = await launchBrowser();
  initializedCleanups.push(() => browser.close());
  page = await browser.newPage();
  initializedCleanups.push(() => page.close());
});

after(async () => {
  // Reverse of creation order (page, then browser, then app) - the same
  // dependency order the original unconditional close() sequence used.
  // collectCleanupFailures runs these serially (not concurrently):
  // browser.close() tears the browser down, and a concurrent page.close()
  // still in flight against it would fail spuriously instead of closing
  // cleanly (see cleanupTasks.ts).
  const resourceTasks = [...initializedCleanups].reverse();
  // Viewer/fixture cleanup has no such ordering dependency between entries
  // (each targets an independent user/fixture), so it keeps running
  // concurrently - the same shape every other test/auth and test/rls file
  // uses for this kind of cleanup - rather than being forced through
  // runCleanupTasks's serial ordering along with it.
  const fixtureTasks = [
    ...createdViewerIds.map((id) => () => deleteUser(id)),
    ...createdFixtureActors.map((actor) => () => deleteTestActor(actor)),
  ];

  // Both groups return/collect raw failure reasons (not an already-
  // formatted aggregate error) so they can be merged into a single
  // "cleanup failed:" message below without nesting one inside the other.
  const [resourceFailures, fixtureResults] = await Promise.all([
    collectCleanupFailures(resourceTasks),
    Promise.allSettled(fixtureTasks.map((task) => task())),
  ]);

  const failures: unknown[] = [...resourceFailures];
  for (const result of fixtureResults) {
    if (result.status === 'rejected') {
      failures.push(result.reason);
    }
  }
  if (failures.length > 0) {
    const messages = failures.map((failure) =>
      failure instanceof Error ? failure.message : String(failure),
    );
    throw new Error(`cleanup failed:\n${messages.join('\n')}`);
  }
});

interface RenderedPage {
  /** `outerHTML` - for regex/attribute-based assertions (data-band-event-id,
   * data-badge-count, aria-label) and for static UI copy, which is baked
   * into the client bundle's own code, never the hydration payload. */
  html: string;
  /** `document.body.innerText` - for "is this event's title actually shown
   * on screen" checks. `html` above is NOT safe for that: a client
   * component's serialized *props* (e.g. CatalogView's `events`) are
   * embedded in a `<script>` tag for hydration regardless of whether the
   * component's own render ever displays them (see browserPage.ts's own
   * content()/visibleText() doc comments) - Issue #109's 0-occurrence-event
   * title deliberately never renders on month landing, but is still present
   * in `html` via that payload. */
  visibleText: string;
}

/** Navigates the shared real browser page to a /catalog(-rooted) URL under
 * `cookie`'s session, waits for CatalogView's own `data-catalog-ready="true"`
 * marker (i.e. `readyToRenderBody`, see CatalogView.tsx), and returns both
 * the resulting live DOM and its visible text - the post-hydration
 * equivalent of the pre-#145 `(await fetch(url, {headers: {cookie}})).text()`
 * calls this file used to make directly. Only for routes CatalogView
 * actually renders; a route without that marker (e.g. event detail) would
 * hang here - those keep using plain fetch below. */
async function renderedPage(url: string, cookie: string): Promise<RenderedPage> {
  await page.navigate(url, cookie);
  await page.waitForSelector('[data-catalog-ready="true"]');
  const [html, visibleText] = await Promise.all([page.content(), page.visibleText()]);
  return { html, visibleText };
}

/** A real signed-in session's cookie, via the app's own magic-link flow.
 * The provisioned user is tracked for cleanup as soon as it exists (not
 * only after this resolves), so a transient failure partway through
 * sign-in still leaves it tracked. */
async function signedInCookie(): Promise<string> {
  const session = await signInThroughApp(app, {
    onUserProvisioned: (userId) => {
      createdViewerIds.push(userId);
    },
  });
  assert.notEqual(session.cookie, '', 'expected a real session cookie');
  return session.cookie;
}

/** Fixture events are created through create_event (Issue #88, renamed from
 * create_event_with_occurrence), which is restricted to designated catalog
 * creators (Issue #29), so the fixture
 * owner needs that membership. The signed-in *viewers* below deliberately
 * do not have it - this file's assertions are about what an ordinary
 * authenticated user can read. */
async function fixtureActor(): Promise<TestActor> {
  const actor = await createTestActor('catalog-fixture', 'Str0ng-Test-Passw0rd!', {
    designatedCatalogCreator: true,
  });
  createdFixtureActors.push(actor);
  return actor;
}

/** Inserts an additional occurrence directly - createEventWithOccurrence's
 * RPC only creates the first one per event. */
async function insertOccurrence(
  actor: TestActor,
  eventId: string,
  startsAt: string,
  endsAt: string | null = null,
): Promise<void> {
  const { error } = await actor.client
    .from('event_occurrences')
    .insert({ event_id: eventId, starts_at: startsAt, ends_at: endsAt });
  if (error !== null) {
    throw new Error(`failed to insert fixture occurrence: ${error.message}`);
  }
}

function locationOf(response: Response): string {
  const location = response.headers.get('location');
  assert.ok(location !== null, 'expected a Location header on a redirect');
  return location;
}

/** Reads the month view's data-badge-count for one day cell (see
 * src/app/catalog/_components/MonthCalendar.tsx), a stable hook independent
 * of hashed CSS-module class names. */
function badgeCountOf(html: string, date: string): number {
  const pattern = new RegExp(`data-date="${date}"[^>]*data-badge-count="(\\d+)"`, 'u');
  const match = pattern.exec(html);
  assert.ok(match, `no day cell found for ${date} in the rendered calendar`);
  const [, count] = match;
  assert.ok(count !== undefined);
  return Number(count);
}

/** The rendered aria-label for one day cell's link (see MonthCalendar.tsx),
 * which is emitted before data-date in prop order. */
function ariaLabelOf(html: string, date: string): string {
  const pattern = new RegExp(`aria-label="([^"]*)"[^>]*data-date="${date}"`, 'u');
  const match = pattern.exec(html);
  assert.ok(match, `no day cell found for ${date} in the rendered calendar`);
  const [, label] = match;
  assert.ok(label !== undefined);
  return label;
}

/**
 * The calendar months this file makes *exact* shared-catalog claims about:
 * badge counts (`badgeCountOf` above), the "no events this month" empty
 * state, and the absence of an Event-level fallback section. Those claims
 * are about the whole shared catalog, not about this file's own rows, so
 * every one of them silently depends on no other test file putting an Event
 * range over the same month.
 *
 * Until Issue #301 that dependency was free: `--test-concurrency=1` ran the
 * files one at a time and each file's after() removed its fixtures before
 * the next file started, so two files could even share a month. Raising the
 * concurrency is what makes it load-bearing, so it is checked here rather
 * than left as a comment for the next person who adds a test file.
 *
 * A month must be listed here before assertReservedMonthIsExclusivelyOurs
 * will accept it, so adding a month to this file also means declaring it.
 */
const RESERVED_MONTHS = new Set(['2096-05', '2097-07', '2097-08', '2098-01', '2098-04']);

/** Inclusive first/last Asia/Tokyo calendar date of `month` ("YYYY-MM").
 * `Date.UTC(year, month, 0)` is the last day of the 1-based `month`; these
 * are plain calendar dates (the same form events.starts_on/ends_on store),
 * never instants, so no offset applies. */
function monthBounds(month: string): { first: string; last: string } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/u.exec(month);
  assert.ok(match, `month must be YYYY-MM, got ${month}`);
  const [, year, monthOfYear] = match;
  assert.ok(year !== undefined && monthOfYear !== undefined);
  const lastDay = new Date(Date.UTC(Number(year), Number(monthOfYear), 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * Fails with a message that names the offending rows if the shared catalog
 * holds any Event this test did not create whose Event range overlaps
 * `month` - i.e. exactly the pollution that would otherwise reappear as an
 * unexplained "expected 1, got 2" badge count or a missing empty state.
 *
 * Querying `events` by range covers occurrence-driven counts too: an
 * occurrence's Asia/Tokyo date is DB-constrained to lie inside its event's
 * range (20260825000200_add_event_range_containment_triggers.sql), so an
 * Event whose range misses this month cannot contribute an occurrence to it
 * either. The read goes through the service-role client because a foreign
 * fixture's Event is shared-catalog data this file's deliberately
 * unprivileged viewer has no reason to be able to enumerate.
 *
 * Call this once the test's own fixtures exist and immediately before the
 * render whose counts depend on them. A foreign row created in the window
 * between this check and that render still escapes it, but a test file that
 * uses this month at all holds its fixtures across its whole run, not only
 * inside that window.
 */
async function assertReservedMonthIsExclusivelyOurs(
  month: string,
  ownEventIds: readonly string[],
): Promise<void> {
  assert.ok(
    RESERVED_MONTHS.has(month),
    `${month} makes exact shared-catalog assertions but is not listed in RESERVED_MONTHS`,
  );
  const { first, last } = monthBounds(month);
  const { data, error } = await createAdminClient()
    .from('events')
    .select('id, title, starts_on, ends_on')
    .lte('starts_on', last)
    .gte('ends_on', first);
  if (error !== null) {
    throw new Error(`failed to check ${month} for foreign fixture events: ${error.message}`);
  }
  const own = new Set(ownEventIds);
  const foreign = data.filter((event) => !own.has(event.id));
  assert.ok(
    foreign.length === 0,
    `${month} is reserved by test/auth/catalogAccess.test.ts, but the shared catalog also ` +
      `holds ${String(foreign.length)} Event(s) this test did not create: ` +
      `${foreign.map((event) => `${event.title} [${event.starts_on}..${event.ends_on}]`).join(', ')}. ` +
      `test:auth runs its files concurrently (package.json --test-concurrency), so those ` +
      `fixtures overlap this file's run and change the exact counts asserted below. Give the ` +
      `other file a month of its own - do not relax the expected count (Issue #301).`,
  );
}

// --- Reachability ---

void test('an authenticated user reaches the Catalog route and sees the month calendar', async () => {
  const cookie = await signedInCookie();
  const response = await fetch(`${app.baseUrl}/catalog`, {
    headers: { cookie },
    redirect: 'manual',
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /イベント/);
});

void test('an anonymous user cannot reach the Catalog route', async () => {
  const response = await fetch(`${app.baseUrl}/catalog`, { redirect: 'manual' });
  assert.equal(response.status, 307);
  assert.equal(new URL(locationOf(response), app.baseUrl).pathname, '/sign-in');
});

void test('an anonymous user cannot reach an event detail route', async () => {
  const response = await fetch(`${app.baseUrl}/catalog/events/${crypto.randomUUID()}`, {
    redirect: 'manual',
  });
  assert.equal(response.status, 307);
  assert.equal(new URL(locationOf(response), app.baseUrl).pathname, '/sign-in');
});

// --- Empty vs populated vs not-found ---

void test('a month with no occurrences shows the empty state, not fabricated data', async () => {
  await assertReservedMonthIsExclusivelyOurs('2098-01', []);
  const cookie = await signedInCookie();
  const response = await fetch(`${app.baseUrl}/catalog?month=2098-01`, {
    headers: { cookie },
    redirect: 'manual',
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /この月に登録されているイベントはありません/);
});

void test('a non-existent event id is a distinct not-found state, not an error', async () => {
  const cookie = await signedInCookie();
  const response = await fetch(`${app.baseUrl}/catalog/events/${crypto.randomUUID()}`, {
    headers: { cookie },
    redirect: 'manual',
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /指定された公演が見つかりません/);
  assert.doesNotMatch(html, /読み込めませんでした/);
});

// --- Populated: same-day multiple occurrences + nullable end ---

void test('same-day multiple occurrences are shown losslessly, and a null end time is never fabricated', async () => {
  const owner = await fixtureActor();
  const { event } = await createEventWithOccurrence(owner, {
    title: eventFixtureTitle(),
    startsAt: '2096-05-15T05:00:00.000Z', // 14:00 JST, no end (matinee)
  });
  await insertOccurrence(owner, event.id, '2096-05-15T09:00:00.000Z', '2096-05-15T11:00:00.000Z'); // 18:00-20:00 JST (evening)
  await assertReservedMonthIsExclusivelyOurs('2096-05', [event.id]);

  const cookie = await signedInCookie();
  const { html, visibleText } = await renderedPage(
    `${app.baseUrl}/catalog?month=2096-05&date=2096-05-15`,
    cookie,
  );

  assert.match(html, /14:00〜(?:（|\()終了時刻未定(?:）|\))/);
  assert.match(html, /18:00〜20:00/);
  const titleOccurrences = visibleText.split(event.title).length - 1;
  assert.ok(
    titleOccurrences >= 2,
    'expected the event title to appear once per occurrence, not collapsed',
  );
});

// --- Band rendering / single-day count / multi-day band (Issue #91 PO decision) ---

void test('a multi-day event bands by its Event range and never counts; a single-day event never bands and counts once per Event, not per occurrence', async () => {
  const owner = await fixtureActor();

  const { event: kabuki } = await createEventWithOccurrence(owner, {
    title: eventFixtureTitle(),
    startsAt: '2097-07-10T02:00:00.000Z', // 07-10 JST
    // Event range (Issue #88): must cover every occurrence this fixture
    // inserts below, including the 07-12 day with no occurrence.
    startsOn: '2097-07-10',
    endsOn: '2097-07-13',
  });
  await insertOccurrence(owner, kabuki.id, '2097-07-11T02:00:00.000Z'); // 07-11 JST
  // 07-12 intentionally has no occurrence for this event.
  await insertOccurrence(owner, kabuki.id, '2097-07-13T02:00:00.000Z'); // 07-13 JST

  // Single-day event with 2 occurrences (matinee + evening) - must still
  // count once on its own date, not once per occurrence.
  const { event: live } = await createEventWithOccurrence(owner, {
    title: eventFixtureTitle(),
    startsAt: '2097-07-10T10:00:00.000Z', // 19:00 JST, same day as kabuki's first day
  });
  await insertOccurrence(owner, live.id, '2097-07-10T12:00:00.000Z'); // 21:00 JST, still 07-10 JST

  const { event: secondRun } = await createEventWithOccurrence(owner, {
    title: eventFixtureTitle(),
    startsAt: '2097-07-20T02:00:00.000Z',
    startsOn: '2097-07-20',
    endsOn: '2097-07-21',
  });
  await insertOccurrence(owner, secondRun.id, '2097-07-21T02:00:00.000Z');
  await assertReservedMonthIsExclusivelyOurs('2097-07', [kabuki.id, live.id, secondRun.id]);

  const cookie = await signedInCookie();
  const { html: monthHtml } = await renderedPage(`${app.baseUrl}/catalog?month=2097-07`, cookie);

  // Multi-day events band; the single-day event never does (Issue #91 PO
  // decision).
  assert.match(monthHtml, new RegExp(`data-band-event-id="${kabuki.id}"`, 'u'));
  assert.match(monthHtml, new RegExp(`data-band-event-id="${secondRun.id}"`, 'u'));
  assert.doesNotMatch(monthHtml, new RegExp(`data-band-event-id="${live.id}"`, 'u'));

  // Count semantics: single-day Event count, not occurrence count. live's
  // 2 occurrences on 07-10 still count as 1; kabuki (multi-day) never
  // counts on any of its days, including 07-10 which it shares with live.
  assert.equal(badgeCountOf(monthHtml, '2097-07-10'), 1); // live only
  assert.equal(badgeCountOf(monthHtml, '2097-07-11'), 0); // kabuki's, multi-day never counts
  assert.equal(badgeCountOf(monthHtml, '2097-07-13'), 0); // kabuki's, multi-day never counts
  // No occurrence for anything on 07-12, and it is inside kabuki's
  // (multi-day) Event range regardless - either way its badge is 0.
  assert.equal(badgeCountOf(monthHtml, '2097-07-12'), 0);

  // 07-10 has both kabuki's band and live's count, so "ほか" ("besides
  // [kabuki, already named]") reads correctly there.
  assert.match(ariaLabelOf(monthHtml, '2097-07-10'), /ほか1件/);

  // 07-12 has no occurrence for anything: the day list must be empty, never
  // a fabricated performance, even though the month band covers this day.
  const { html: restDayHtml, visibleText: restDayText } = await renderedPage(
    `${app.baseUrl}/catalog?month=2097-07&date=2097-07-12`,
    cookie,
  );
  assert.match(restDayHtml, /この日に登録されている公演はありません/);
  // Issue #109 minimum regression case 6: kabuki has occurrences elsewhere
  // in its range (07-10, 07-13) but none on 07-12 - it must still surface
  // as an Event-level fallback for 07-12, since 07-12 is inside its range.
  assert.match(restDayHtml, /開催期間で該当するイベント/);
  assert.ok(restDayText.includes(kabuki.title));

  // An inner run day (only shown as part of the band in month view) still
  // reaches full detail through the selected-day list.
  const { html: innerDayHtml, visibleText: innerDayText } = await renderedPage(
    `${app.baseUrl}/catalog?month=2097-07&date=2097-07-11`,
    cookie,
  );
  assert.ok(innerDayText.includes(kabuki.title));
  // kabuki has an actual occurrence on 07-11, and no other event's range
  // covers 07-11 with no occurrence there: no Event-level fallback
  // candidate, so the fallback section must not render (no duplication).
  assert.doesNotMatch(innerDayHtml, /開催期間で該当するイベント/);

  // 07-10 mixes a banded (multi-day) event's occurrence with the
  // non-banded single-day event's 2 occurrences - the selected-day list
  // still shows every actual occurrence individually, regardless of band
  // status.
  const { html: mixedDayHtml, visibleText: mixedDayText } = await renderedPage(
    `${app.baseUrl}/catalog?month=2097-07&date=2097-07-10`,
    cookie,
  );
  assert.ok(mixedDayText.includes(kabuki.title));
  const liveOccurrencesShown = mixedDayText.split(live.title).length - 1;
  assert.ok(liveOccurrencesShown >= 2, "expected live's 2 occurrences to appear individually");
  // Both kabuki and live have an actual occurrence on 07-10: no fallback
  // candidate, so kabuki's title must come only from the actual-occurrence
  // list, never duplicated by the fallback section.
  assert.doesNotMatch(mixedDayHtml, /開催期間で該当するイベント/);
});

void test('a 0-occurrence single-day event never bands, counts once on its own date, has no title/link on month landing, and is reachable through Event-level fallback once its date is selected (Issue #109)', async () => {
  const owner = await fixtureActor();
  const { event } = await createEventWithoutOccurrence(owner, '2097-08-15', '2097-08-15', {
    title: eventFixtureTitle(),
  });
  await assertReservedMonthIsExclusivelyOurs('2097-08', [event.id]);

  const cookie = await signedInCookie();
  const { html: monthHtml, visibleText: monthText } = await renderedPage(
    `${app.baseUrl}/catalog?month=2097-08`,
    cookie,
  );

  assert.doesNotMatch(monthHtml, new RegExp(`data-band-event-id="${event.id}"`, 'u'));
  assert.equal(badgeCountOf(monthHtml, '2097-08-15'), 1);
  // Issue #109: month landing (no day selected) no longer renders an
  // Event-level fallback section at all - a 0-occurrence single-day event's
  // only landing-view presentation is the day-number count (badge is just a
  // number, no title/link anywhere on the grid).
  assert.ok(!monthText.includes(event.title));
  assert.doesNotMatch(monthHtml, /開催期間で該当するイベント/);

  // No band was named for this day, so its aria-label must stand on its
  // own ("イベント1件"), not "ほか1件" ("besides" what was never named).
  const label = ariaLabelOf(monthHtml, '2097-08-15');
  assert.match(label, /イベント1件/);
  assert.doesNotMatch(label, /ほか/);

  const { html: dayHtml, visibleText: dayText } = await renderedPage(
    `${app.baseUrl}/catalog?month=2097-08&date=2097-08-15`,
    cookie,
  );
  // No actual occurrence that day: the actual-occurrence list stays empty...
  assert.match(dayHtml, /この日に登録されている公演はありません/);
  // ...but selecting the event's own date reaches it through the
  // Event-level fallback section instead (selectEventLevelFallback).
  assert.match(dayHtml, /開催期間で該当するイベント/);
  assert.ok(dayText.includes(event.title));
});

// --- 0-occurrence event visibility (Issue #88, revised by #109) ---
//
// Regression test for the silent-blank-state bug: listEventCatalogInRange
// returns a range-only event (result.data.length > 0), but a purely
// occurrence-driven month view would render nowhere for it - no calendar
// marker, and (since the result wasn't empty) no
// "この月に登録されているイベントはありません" message either. Since Issue #91
// this is closed by MonthCalendar's own multi-day Event-range band, not by
// a separate fallback list (Issue #109 removes that list from month
// landing entirely) - this proves the real page HTML, not just the read
// layer, actually surfaces it via the band.
void test('a 0-occurrence event whose Event range covers the month is visible on the month landing view via its band (not a fallback list), the empty-state message is suppressed, and its Event-level fallback is reachable by selecting a day inside its range', async () => {
  const owner = await fixtureActor();
  const { event } = await createEventWithoutOccurrence(owner, '2098-04-05', '2098-04-25', {
    title: eventFixtureTitle(),
  });
  await assertReservedMonthIsExclusivelyOurs('2098-04', [event.id]);

  const cookie = await signedInCookie();
  const { html, visibleText } = await renderedPage(`${app.baseUrl}/catalog?month=2098-04`, cookie);

  assert.ok(
    visibleText.includes(event.title),
    'expected the 0-occurrence event to be visible on the month landing view via its Event-range band, without selecting a day',
  );
  assert.match(html, new RegExp(`data-band-event-id="${event.id}"`, 'u'));
  assert.doesNotMatch(
    html,
    /この月に登録されているイベントはありません/,
    'expected the empty-state message to be suppressed once a range-only event is present',
  );
  // Issue #109: month landing must not render the Event-level fallback
  // section at all - the band above is the only landing-view presentation.
  assert.doesNotMatch(html, /開催期間で該当するイベント/);

  // Selecting a day inside the event's range (which has no occurrence at
  // all) reaches it through the Event-level fallback section instead.
  const { html: dayHtml, visibleText: dayText } = await renderedPage(
    `${app.baseUrl}/catalog?month=2098-04&date=2098-04-10`,
    cookie,
  );
  assert.match(dayHtml, /開催期間で該当するイベント/);
  assert.ok(dayText.includes(event.title));
  assert.match(dayHtml, /この日に登録されている公演はありません/);
});
