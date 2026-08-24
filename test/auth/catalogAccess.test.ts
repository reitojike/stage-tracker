import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  createEventWithOccurrence,
  createEventWithoutOccurrence,
  eventFixtureTitle,
} from '../rls/support/eventFixtures.ts';
import { createTestActor, deleteTestActor, type TestActor } from '../rls/support/testActors.ts';
import { startAppServer, type AppServer } from './support/appServer.ts';
import { deleteUser } from './support/authActors.ts';
import { signInThroughApp } from './support/signInThroughApp.ts';

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

let app: AppServer;
const createdViewerIds: string[] = [];
const createdFixtureActors: TestActor[] = [];

before(async () => {
  app = await startAppServer();
});

after(async () => {
  await app.stop();
  const results = await Promise.allSettled([
    ...createdViewerIds.map((id) => deleteUser(id)),
    ...createdFixtureActors.map((actor) => deleteTestActor(actor)),
  ]);
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    const messages = failures.map((failure) =>
      failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
    );
    throw new Error(`cleanup failed:\n${messages.join('\n')}`);
  }
});

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

// --- Reachability ---

void test('an authenticated user reaches the Catalog route and sees the month calendar', async () => {
  const cookie = await signedInCookie();
  const response = await fetch(`${app.baseUrl}/catalog`, {
    headers: { cookie },
    redirect: 'manual',
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Event Catalog/);
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
  const cookie = await signedInCookie();
  const response = await fetch(`${app.baseUrl}/catalog?month=2098-01`, {
    headers: { cookie },
    redirect: 'manual',
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /この月に登録されている公演はありません/);
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

  const cookie = await signedInCookie();
  const response = await fetch(`${app.baseUrl}/catalog?month=2096-05&date=2096-05-15`, {
    headers: { cookie },
    redirect: 'manual',
  });
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /14:00〜(?:（|\()終了時刻未定(?:）|\))/);
  assert.match(html, /18:00〜20:00/);
  const titleOccurrences = html.split(event.title).length - 1;
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

  const cookie = await signedInCookie();
  const monthResponse = await fetch(`${app.baseUrl}/catalog?month=2097-07`, {
    headers: { cookie },
    redirect: 'manual',
  });
  assert.equal(monthResponse.status, 200);
  const monthHtml = await monthResponse.text();

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
  const restDayResponse = await fetch(`${app.baseUrl}/catalog?month=2097-07&date=2097-07-12`, {
    headers: { cookie },
    redirect: 'manual',
  });
  const restDayHtml = await restDayResponse.text();
  assert.match(restDayHtml, /この日に登録されている公演はありません/);

  // An inner run day (only shown as part of the band in month view) still
  // reaches full detail through the selected-day list.
  const innerDayResponse = await fetch(`${app.baseUrl}/catalog?month=2097-07&date=2097-07-11`, {
    headers: { cookie },
    redirect: 'manual',
  });
  const innerDayHtml = await innerDayResponse.text();
  assert.ok(innerDayHtml.includes(kabuki.title));

  // 07-10 mixes a banded (multi-day) event's occurrence with the
  // non-banded single-day event's 2 occurrences - the selected-day list
  // still shows every actual occurrence individually, regardless of band
  // status.
  const mixedDayResponse = await fetch(`${app.baseUrl}/catalog?month=2097-07&date=2097-07-10`, {
    headers: { cookie },
    redirect: 'manual',
  });
  const mixedDayHtml = await mixedDayResponse.text();
  assert.ok(mixedDayHtml.includes(kabuki.title));
  const liveOccurrencesShown = mixedDayHtml.split(live.title).length - 1;
  assert.ok(liveOccurrencesShown >= 2, "expected live's 2 occurrences to appear individually");
});

void test('a 0-occurrence single-day event never bands, counts once on its own date, has no selected-day occurrence, and is still reachable through the range-only list', async () => {
  const owner = await fixtureActor();
  const { event } = await createEventWithoutOccurrence(owner, '2097-08-15', '2097-08-15', {
    title: eventFixtureTitle(),
  });

  const cookie = await signedInCookie();
  const monthResponse = await fetch(`${app.baseUrl}/catalog?month=2097-08`, {
    headers: { cookie },
    redirect: 'manual',
  });
  assert.equal(monthResponse.status, 200);
  const monthHtml = await monthResponse.text();

  assert.doesNotMatch(monthHtml, new RegExp(`data-band-event-id="${event.id}"`, 'u'));
  assert.equal(badgeCountOf(monthHtml, '2097-08-15'), 1);
  // No title/link elsewhere on the grid for a 0-occurrence single-day event
  // (the badge is just a number) - RangeOnlyEventList is what keeps it
  // reachable.
  assert.ok(monthHtml.includes(event.title));

  // No band was named for this day, so its aria-label must stand on its
  // own ("イベント1件"), not "ほか1件" ("besides" what was never named).
  const label = ariaLabelOf(monthHtml, '2097-08-15');
  assert.match(label, /イベント1件/);
  assert.doesNotMatch(label, /ほか/);

  const dayResponse = await fetch(`${app.baseUrl}/catalog?month=2097-08&date=2097-08-15`, {
    headers: { cookie },
    redirect: 'manual',
  });
  const dayHtml = await dayResponse.text();
  assert.match(dayHtml, /この日に登録されている公演はありません/);
});

// --- 0-occurrence event visibility (Issue #88) ---
//
// Regression test for the silent-blank-state bug: listEventCatalogInRange
// returns a range-only event (result.data.length > 0), but
// MonthCalendar/SelectedDayList are both entirely occurrence-driven, so
// without RangeOnlyEventList such an event rendered nowhere on the page -
// no calendar marker, and (since the result wasn't empty) no
// "この月に登録されている公演はありません" message either. This proves the
// real page HTML, not just the read layer, actually surfaces it.
void test('a 0-occurrence event whose Event range covers the month is visible on the month landing view, and the empty-state message is suppressed', async () => {
  const owner = await fixtureActor();
  const { event } = await createEventWithoutOccurrence(owner, '2098-04-05', '2098-04-25', {
    title: eventFixtureTitle(),
  });

  const cookie = await signedInCookie();
  const response = await fetch(`${app.baseUrl}/catalog?month=2098-04`, {
    headers: { cookie },
    redirect: 'manual',
  });
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.ok(
    html.includes(event.title),
    'expected the 0-occurrence event to be visible on the month landing view, without selecting a day',
  );
  assert.doesNotMatch(
    html,
    /この月に登録されている公演はありません/,
    'expected the empty-state message to be suppressed once a range-only event is present',
  );
});
