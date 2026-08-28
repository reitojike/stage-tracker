import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  createAdminClient,
  createAnonymousClient,
  createTestActor,
  deleteTestActorsSequentially,
  type TestActor,
} from './support/testActors.ts';
import { createEventWithoutOccurrence, eventFixtureTitle } from './support/eventFixtures.ts';
import {
  getEventClassificationsByIds,
  listCatalogGenres,
  listCatalogGroupOptions,
  listCatalogVenueOptions,
} from '../../src/infrastructure/supabase/eventCatalogRead.ts';

// Real local Supabase/Postgres RLS + typed-read-boundary tests for Event
// genre/group classification (Issue #167, PO decision #158):
// supabase/migrations/20260828000400_create_event_classification.sql,
// 20260828000500_add_events_genre.sql,
// 20260828000600_create_import_event_classification_rpc.sql, and the new
// read functions in src/infrastructure/supabase/eventCatalogRead.ts.
//
// import_event_classification is service_role-only (mirrors
// import_ticket_opportunity's own test file), so every write in this file
// runs through the admin client, standing in for the operator-assisted
// import path (scripts/import-catalog-events.mjs) - never through an
// authenticated actor's own client, which has no write grant on any of
// these tables/columns at all (that absence is itself asserted below).

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let owner: TestActor;
let otherUser: TestActor;
const createdActors: TestActor[] = [];
const admin = createAdminClient();

before(async () => {
  owner = await createTestActor('classification-owner', PASSWORD, {
    designatedCatalogCreator: true,
  });
  createdActors.push(owner);
  otherUser = await createTestActor('classification-other', PASSWORD);
  createdActors.push(otherUser);
});

after(async () => {
  await deleteTestActorsSequentially(createdActors);
});

interface FixtureEventOverrides {
  title?: string;
  venue?: string;
  sourceUrl?: string;
  memo?: string;
  startsOn?: string;
  endsOn?: string;
}

async function fixtureEvent(overrides: FixtureEventOverrides = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const { startsOn, endsOn, ...rest } = overrides;
  return createEventWithoutOccurrence(owner, startsOn ?? today, endsOn ?? today, rest);
}

async function genreId(key: string): Promise<string> {
  const { data, error } = await admin.from('genres').select('id').eq('key', key).single();
  assert.equal(error, null, `failed to look up genre "${key}"`);
  return data.id;
}

/** Unwraps an EventCatalogReadResult, matching test/rls/eventCatalogRead.test.ts's
 * own requireOk convention - asserts ok:true (assert.ok's `asserts` signature
 * narrows the type, so every caller works with `data` directly with no
 * leftover optional chaining/re-checking of `.ok`). */
function requireOk<T>(result: { ok: true; data: T } | { ok: false; error: unknown }): T {
  assert.ok(
    result.ok,
    `expected ok:true, got error: ${JSON.stringify('error' in result ? result.error : null)}`,
  );
  return result.data;
}

/** Asserts `array` has exactly one element and returns it - avoids both a
 * noUncheckedIndexedAccess-driven `array[0]` possibly-undefined type and a
 * forbidden non-null assertion (`!`) to work around it. */
function theOnly<T>(array: readonly T[]): T {
  assert.equal(array.length, 1, `expected exactly one element, got ${String(array.length)}`);
  const [only] = array;
  assert.ok(only !== undefined);
  return only;
}

// --- Gate A canonical genre seed ---

void test('the 3 Gate A genres are seeded with the expected keys/display names/order', async () => {
  const genres = requireOk(await listCatalogGenres(owner.client));
  assert.deepEqual(
    genres.map((genre) => [genre.key, genre.displayName]),
    [
      ['takarazuka', '宝塚'],
      ['kabuki', '歌舞伎'],
      ['idol', 'アイドル'],
    ],
  );
});

// --- Persistence / genre 0..1 ---

void test('a new Event has no genre by default (unclassified is valid)', async () => {
  const { event } = await fixtureEvent({ title: eventFixtureTitle() });
  const classifications = requireOk(await getEventClassificationsByIds(owner.client, [event.id]));
  assert.deepEqual(classifications, [{ eventId: event.id, genre: null, groups: [] }]);
});

void test('import_event_classification sets a single genre', async () => {
  const { event } = await fixtureEvent({ title: eventFixtureTitle() });
  const takarazukaId = await genreId('takarazuka');

  const { error } = await admin.rpc('import_event_classification', {
    p_event_id: event.id,
    p_set_genre: true,
    p_genre_key: 'takarazuka',
  });
  assert.equal(error, null);

  const classification = theOnly(
    requireOk(await getEventClassificationsByIds(owner.client, [event.id])),
  );
  assert.equal(classification.genre?.id, takarazukaId);
  assert.equal(classification.genre.key, 'takarazuka');
});

void test('import_event_classification with p_set_genre=false leaves an existing genre untouched (backward-compatible re-import)', async () => {
  const { event } = await fixtureEvent({ title: eventFixtureTitle() });
  await admin.rpc('import_event_classification', {
    p_event_id: event.id,
    p_set_genre: true,
    p_genre_key: 'kabuki',
  });

  const { error } = await admin.rpc('import_event_classification', {
    p_event_id: event.id,
    p_set_genre: false,
  });
  assert.equal(error, null);

  const classification = theOnly(
    requireOk(await getEventClassificationsByIds(owner.client, [event.id])),
  );
  assert.equal(classification.genre?.key, 'kabuki');
});

void test('import_event_classification with p_set_genre=true and no p_genre_key clears the genre (genre解除)', async () => {
  const { event } = await fixtureEvent({ title: eventFixtureTitle() });
  await admin.rpc('import_event_classification', {
    p_event_id: event.id,
    p_set_genre: true,
    p_genre_key: 'idol',
  });

  // p_genre_key deliberately omitted, not passed as an explicit `null`: its
  // SQL default is `null` (see the migration), so omitting it and sending
  // an explicit null produce the identical clear. The generated Args type
  // (`p_genre_key?: string`, no `| null`) cannot express an explicit null
  // literal anyway - the real caller (scripts/import-catalog-events.mjs) is
  // plain JS and is not subject to that generated-type gap.
  const { error } = await admin.rpc('import_event_classification', {
    p_event_id: event.id,
    p_set_genre: true,
  });
  assert.equal(error, null);

  const classification = theOnly(
    requireOk(await getEventClassificationsByIds(owner.client, [event.id])),
  );
  assert.equal(classification.genre, null);
});

void test('import_event_classification rejects an unknown genre key', async () => {
  const { event } = await fixtureEvent({ title: eventFixtureTitle() });
  const { error } = await admin.rpc('import_event_classification', {
    p_event_id: event.id,
    p_set_genre: true,
    p_genre_key: 'not-a-real-genre',
  });
  assert.notEqual(error, null);
});

void test('genre correction: re-classifying an Event replaces the previous genre, never accumulates a second one', async () => {
  const { event } = await fixtureEvent({ title: eventFixtureTitle() });
  await admin.rpc('import_event_classification', {
    p_event_id: event.id,
    p_set_genre: true,
    p_genre_key: 'takarazuka',
  });
  await admin.rpc('import_event_classification', {
    p_event_id: event.id,
    p_set_genre: true,
    p_genre_key: 'kabuki',
  });

  const { data: row, error } = await admin
    .from('events')
    .select('genre_id')
    .eq('id', event.id)
    .single();
  assert.equal(error, null);
  assert.equal(row.genre_id, await genreId('kabuki'));
});

// --- Persistence / group 0..N ---

void test('import_event_classification associates multiple groups with one Event (joint/festival Event)', async () => {
  const { event } = await fixtureEvent({ title: eventFixtureTitle() });
  const { error } = await admin.rpc('import_event_classification', {
    p_event_id: event.id,
    p_set_groups: true,
    p_groups: [
      { key: `tsuki-${event.id}`, displayName: '月組' },
      { key: `hoshi-${event.id}`, displayName: '星組' },
    ],
  });
  assert.equal(error, null);

  const classification = theOnly(
    requireOk(await getEventClassificationsByIds(owner.client, [event.id])),
  );
  assert.deepEqual(classification.groups.map((group) => group.displayName).sort(), [
    '星組',
    '月組',
  ]);
});

void test('the same canonical group key is reused (resolved, not duplicated) across two different Events', async () => {
  const key = `shared-group-${String(Date.now())}`;
  const { event: eventA } = await fixtureEvent({ title: eventFixtureTitle() });
  const { event: eventB } = await fixtureEvent({ title: eventFixtureTitle() });

  await admin.rpc('import_event_classification', {
    p_event_id: eventA.id,
    p_set_groups: true,
    p_groups: [{ key, displayName: 'Shared Group' }],
  });
  await admin.rpc('import_event_classification', {
    p_event_id: eventB.id,
    p_set_groups: true,
    p_groups: [{ key, displayName: 'Shared Group' }],
  });

  const { data: groupRows, error } = await admin.from('groups').select('id').eq('key', key);
  assert.equal(error, null);
  assert.equal(groupRows.length, 1);
});

void test('re-importing the same group key with a corrected displayName updates the canonical row in place', async () => {
  const key = `renamed-group-${String(Date.now())}`;
  const { event } = await fixtureEvent({ title: eventFixtureTitle() });
  await admin.rpc('import_event_classification', {
    p_event_id: event.id,
    p_set_groups: true,
    p_groups: [{ key, displayName: 'Old Name' }],
  });
  await admin.rpc('import_event_classification', {
    p_event_id: event.id,
    p_set_groups: true,
    p_groups: [{ key, displayName: 'New Name' }],
  });

  const { data: groupRows, error } = await admin
    .from('groups')
    .select('id, display_name')
    .eq('key', key);
  assert.equal(error, null);
  const groupRow = theOnly(groupRows);
  assert.equal(groupRow.display_name, 'New Name');
});

void test('group correction: replace-style semantics add and remove associations idempotently', async () => {
  const { event } = await fixtureEvent({ title: eventFixtureTitle() });
  const suffix = event.id;
  await admin.rpc('import_event_classification', {
    p_event_id: event.id,
    p_set_groups: true,
    p_groups: [
      { key: `a-${suffix}`, displayName: 'A' },
      { key: `b-${suffix}`, displayName: 'B' },
    ],
  });

  // Second import: drop B, add C.
  await admin.rpc('import_event_classification', {
    p_event_id: event.id,
    p_set_groups: true,
    p_groups: [
      { key: `a-${suffix}`, displayName: 'A' },
      { key: `c-${suffix}`, displayName: 'C' },
    ],
  });

  const classification = theOnly(
    requireOk(await getEventClassificationsByIds(owner.client, [event.id])),
  );
  assert.deepEqual(classification.groups.map((group) => group.displayName).sort(), ['A', 'C']);
});

void test('group解除: p_set_groups=true with an empty array removes every association', async () => {
  const { event } = await fixtureEvent({ title: eventFixtureTitle() });
  await admin.rpc('import_event_classification', {
    p_event_id: event.id,
    p_set_groups: true,
    p_groups: [{ key: `solo-${event.id}`, displayName: 'Solo Group' }],
  });
  const { error } = await admin.rpc('import_event_classification', {
    p_event_id: event.id,
    p_set_groups: true,
    p_groups: [],
  });
  assert.equal(error, null);

  const classification = theOnly(
    requireOk(await getEventClassificationsByIds(owner.client, [event.id])),
  );
  assert.deepEqual(classification.groups, []);
});

void test('p_set_groups=false leaves existing group associations untouched', async () => {
  const { event } = await fixtureEvent({ title: eventFixtureTitle() });
  await admin.rpc('import_event_classification', {
    p_event_id: event.id,
    p_set_groups: true,
    p_groups: [{ key: `kept-${event.id}`, displayName: 'Kept Group' }],
  });
  const { error } = await admin.rpc('import_event_classification', {
    p_event_id: event.id,
    p_set_groups: false,
  });
  assert.equal(error, null);

  const classification = theOnly(
    requireOk(await getEventClassificationsByIds(owner.client, [event.id])),
  );
  const group = theOnly(classification.groups);
  assert.equal(group.displayName, 'Kept Group');
});

void test('duplicate Event-group association is structurally prevented (repeated import is idempotent, not additive)', async () => {
  const { event } = await fixtureEvent({ title: eventFixtureTitle() });
  const key = `idempotent-${event.id}`;
  for (let i = 0; i < 2; i += 1) {
    const { error } = await admin.rpc('import_event_classification', {
      p_event_id: event.id,
      p_set_groups: true,
      p_groups: [{ key, displayName: 'Idempotent Group' }],
    });
    assert.equal(error, null);
  }

  const { data: rows, error } = await admin
    .from('event_groups')
    .select('group_id')
    .eq('event_id', event.id);
  assert.equal(error, null);
  assert.equal(rows.length, 1);
});

// --- RLS: authenticated shared read, anonymous deny, unauthorized write deny ---

void test('any authenticated user can read genres/groups/event_groups (shared catalog data)', async () => {
  const { event } = await fixtureEvent({ title: eventFixtureTitle() });
  await admin.rpc('import_event_classification', {
    p_event_id: event.id,
    p_set_genre: true,
    p_genre_key: 'idol',
    p_set_groups: true,
    p_groups: [{ key: `readable-${event.id}`, displayName: 'Readable Group' }],
  });

  // otherUser is not the event owner and not a catalog creator - shared
  // catalog read must not depend on either.
  const classification = theOnly(
    requireOk(await getEventClassificationsByIds(otherUser.client, [event.id])),
  );
  assert.equal(classification.genre?.key, 'idol');
  const group = theOnly(classification.groups);
  assert.equal(group.displayName, 'Readable Group');
});

void test('anonymous access to genres/groups/event_groups is denied, consistent with the existing catalog deny boundary', async () => {
  const anon = createAnonymousClient();

  const genres = await anon.from('genres').select('*');
  assert.notEqual(genres.error, null);

  const groups = await anon.from('groups').select('*');
  assert.notEqual(groups.error, null);

  const eventGroups = await anon.from('event_groups').select('*');
  assert.notEqual(eventGroups.error, null);
});

void test('an authenticated user - including the Event owner - cannot write genres/groups/event_groups directly', async () => {
  const { event } = await fixtureEvent({ title: eventFixtureTitle() });
  const takarazukaId = await genreId('takarazuka');

  // No column-level UPDATE grant on events.genre_id at all (Issue #167 -
  // classification write authority is import-RPC-only, not extended to
  // owner-authenticated events_update_own). The generated Database type
  // still types genre_id as updatable (grants are a runtime/DB privilege
  // concern, not something the type generator encodes), so this is
  // rejected at request time, not by the type system - proving the server-
  // side grant boundary rather than a client-side type-checked one.
  const updateGenre = await owner.client
    .from('events')
    .update({ genre_id: takarazukaId })
    .eq('id', event.id);
  assert.notEqual(updateGenre.error, null);

  const insertGroup = await owner.client
    .from('groups')
    .insert({ key: `denied-${event.id}`, display_name: 'Denied' });
  assert.notEqual(insertGroup.error, null);

  const insertEventGroup = await owner.client
    .from('event_groups')
    .insert({ event_id: event.id, group_id: takarazukaId });
  assert.notEqual(insertEventGroup.error, null);

  // Confirm nothing actually landed despite the attempt.
  const { data: row, error } = await admin
    .from('events')
    .select('genre_id')
    .eq('id', event.id)
    .single();
  assert.equal(error, null);
  assert.equal(row.genre_id, null);
});

void test('classification does not weaken existing Event ownership/write regression: owner can still update title/venue, non-owner still cannot', async () => {
  const { event } = await fixtureEvent({ title: eventFixtureTitle() });

  const ownerUpdate = await owner.client
    .from('events')
    .update({ venue: 'Regression Venue' })
    .eq('id', event.id)
    .select();
  assert.equal(ownerUpdate.error, null);
  assert.equal(ownerUpdate.data.length, 1);

  const otherUpdate = await otherUser.client
    .from('events')
    .update({ venue: 'Should Not Apply' })
    .eq('id', event.id)
    .select();
  assert.equal(otherUpdate.error, null);
  assert.equal(otherUpdate.data.length, 0);
});

// --- Catalog-wide filter option discovery ---

void test('listCatalogGroupOptions/listCatalogVenueOptions are catalog-wide, not scoped to any particular Event range', async () => {
  const takarazukaId = await genreId('takarazuka');
  const kabukiId = await genreId('kabuki');

  const { event: farPastEvent } = await fixtureEvent({
    title: eventFixtureTitle(),
    startsOn: '2020-01-01',
    endsOn: '2020-01-01',
  });
  const { event: farFutureEvent } = await fixtureEvent({
    title: eventFixtureTitle(),
    startsOn: '2031-01-01',
    endsOn: '2031-01-01',
  });
  await admin.rpc('import_event_classification', {
    p_event_id: farPastEvent.id,
    p_set_genre: true,
    p_genre_key: 'takarazuka',
    p_set_groups: true,
    p_groups: [{ key: `far-past-${farPastEvent.id}`, displayName: 'Far Past Group' }],
  });
  await admin
    .from('events')
    .update({ venue: `Far Future Venue ${farFutureEvent.id}` })
    .eq('id', farFutureEvent.id);
  await admin.rpc('import_event_classification', {
    p_event_id: farFutureEvent.id,
    p_set_genre: true,
    p_genre_key: 'kabuki',
  });

  const groupOptions = requireOk(await listCatalogGroupOptions(owner.client, takarazukaId));
  assert.ok(groupOptions.some((group) => group.displayName === 'Far Past Group'));

  const venueOptions = requireOk(await listCatalogVenueOptions(owner.client, kabukiId));
  assert.ok(venueOptions.includes(`Far Future Venue ${farFutureEvent.id}`));
});

void test('listCatalogGroupOptions succeeds for a genre id with no associated groups (empty is not an error)', async () => {
  const idolId = await genreId('idol');
  // idol genre may have groups from other tests in this file, so this only
  // asserts the call itself succeeds - the "empty is valid, not an error"
  // shape is already exercised by every ok:true read in this file.
  requireOk(await listCatalogGroupOptions(owner.client, idolId));
});

void test('getEventClassificationsByIds omits a nonexistent event id rather than fabricating an unclassified entry for it', async () => {
  const classifications = requireOk(
    await getEventClassificationsByIds(owner.client, ['00000000-0000-0000-0000-000000000000']),
  );
  assert.deepEqual(classifications, []);
});

void test('getEventClassificationsByIds returns [] for an empty id list without a request', async () => {
  const result = await getEventClassificationsByIds(owner.client, []);
  assert.deepEqual(result, { ok: true, data: [] });
});
