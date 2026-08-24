import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createEventWithOccurrence, eventFixtureTitle } from '../rls/support/eventFixtures.ts';
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

// --- Band rendering / rest day / badge double-counting / multiple bands ---

void test('a long-running event renders as a band; rest days and badge double-counting are handled end-to-end', async () => {
  const owner = await fixtureActor();

  const { event: kabuki } = await createEventWithOccurrence(owner, {
    title: eventFixtureTitle(),
    startsAt: '2097-07-10T02:00:00.000Z', // 07-10 JST
    // Event range (Issue #88): must cover every occurrence this fixture
    // inserts below, including the 07-12 rest day inside the run.
    startsOn: '2097-07-10',
    endsOn: '2097-07-13',
  });
  await insertOccurrence(owner, kabuki.id, '2097-07-11T02:00:00.000Z'); // 07-11 JST
  // 07-12 intentionally has no occurrence for this event (rest day).
  await insertOccurrence(owner, kabuki.id, '2097-07-13T02:00:00.000Z'); // 07-13 JST

  const { event: live } = await createEventWithOccurrence(owner, {
    title: eventFixtureTitle(),
    startsAt: '2097-07-10T10:00:00.000Z', // standalone, same day as the run's first day
  });

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

  // Both runs render as bands - multiple bands can coexist on one month page.
  assert.match(monthHtml, new RegExp(`data-band-event-id="${kabuki.id}"`, 'u'));
  assert.match(monthHtml, new RegExp(`data-band-event-id="${secondRun.id}"`, 'u'));

  // Badge counting: only the standalone occurrence counts; the band's own
  // occurrences (including the day it shares with the standalone one) do
  // not, per the PO decision (product-rules.md "Month calendar").
  assert.equal(badgeCountOf(monthHtml, '2097-07-10'), 1);
  assert.equal(badgeCountOf(monthHtml, '2097-07-11'), 0);
  assert.equal(badgeCountOf(monthHtml, '2097-07-13'), 0);
  // The rest day has no occurrence for anything, so its badge is also 0.
  assert.equal(badgeCountOf(monthHtml, '2097-07-12'), 0);

  // Rest day: the day list must be empty, never a fabricated performance.
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

  // A day mixing a band occurrence with a standalone one shows both
  // individually in the day list, matching the PO's own worked example.
  const mixedDayResponse = await fetch(`${app.baseUrl}/catalog?month=2097-07&date=2097-07-10`, {
    headers: { cookie },
    redirect: 'manual',
  });
  const mixedDayHtml = await mixedDayResponse.text();
  assert.ok(mixedDayHtml.includes(kabuki.title));
  assert.ok(mixedDayHtml.includes(live.title));
});
