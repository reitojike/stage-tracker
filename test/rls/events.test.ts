import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import pg from 'pg';
import {
  createAdminClient,
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';
import {
  callCreateEventRpcRaw,
  createEventWithOccurrence,
  eventFixtureTitle,
} from './support/eventFixtures.ts';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';

// Real local Supabase/Postgres RLS tests for public.events (Issue #3 / PR
// B, extended by Issue #17). Every assertion below runs as an anon-key
// client with no session (anonymous), or an anon-key client signed in as a
// real test user (authenticated) - never as service_role. service_role is
// used only in ./support/testActors.ts to create/delete the fixture users
// themselves.
//
// Since Issue #17, direct authenticated INSERT into events is revoked:
// create_event_with_occurrence (test/rls/support/eventFixtures.ts) is the
// only supported create path, and is what every fixture event below goes
// through.
//
// A denied UPDATE is not always a request error: when RLS's USING clause
// filters a row out of visibility for the caller, the UPDATE simply matches
// zero rows and returns successfully with empty data. A denied INSERT (RLS
// WITH CHECK failure) and a denied column mutation (missing column
// privilege) do surface as request errors. Each test below asserts the
// actual observed shape for its case, not just "an error happened".

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let actorA: TestActor;
let actorB: TestActor;
// Tracks only the actors setup actually finished creating, independent of
// actorA/actorB's declared (always-defined-by-test-time) type, so a partial
// `before()` failure doesn't make cleanup dereference an uncreated actor.
const createdActors: TestActor[] = [];

before(async () => {
  // actorA is a designated catalog creator because it produces every
  // fixture event below; actorB deliberately is not, so the non-owner and
  // non-creator denials it proves cannot pass for the wrong reason.
  actorA = await createTestActor('rls-owner', PASSWORD, { designatedCatalogCreator: true });
  createdActors.push(actorA);
  actorB = await createTestActor('rls-other', PASSWORD);
  createdActors.push(actorB);
});

after(async () => {
  // Attempt every actor's cleanup even if one fails, but still fail the run
  // overall if any cleanup failed - a silently-swallowed cleanup failure
  // would leave stale users/events behind while reporting success.
  const results = await Promise.allSettled(createdActors.map((actor) => deleteTestActor(actor)));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    const messages = failures.map((failure) =>
      failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
    );
    throw new Error(`test actor cleanup failed:\n${messages.join('\n')}`);
  }
});

// --- Positive: create RPC ---

void test('authenticated user creates an event with its initial occurrence via RPC', async () => {
  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { event, occurrence } = await createEventWithOccurrence(actorA, {
    startsAt,
    endsAt,
  });
  assert.equal(event.owner_id, actorA.user.id);
  assert.equal(occurrence.event_id, event.id);
  // Postgres/PostgREST render timestamptz as "+00:00", not "Z" - normalize
  // through Date before comparing, since both spellings mean the same
  // instant.
  assert.equal(new Date(occurrence.starts_at).toISOString(), startsAt);
  assert.ok(occurrence.ends_at);
  assert.equal(new Date(occurrence.ends_at).toISOString(), endsAt);
});

void test('initial occurrence ends_at may be left unset', async () => {
  const { occurrence } = await createEventWithOccurrence(actorA);
  assert.equal(occurrence.ends_at, null);
});

void test('authenticated user can read another user’s event', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const { data, error } = await actorB.client.from('events').select().eq('id', event.id);
  assert.equal(error, null);
  assert.equal(data.length, 1);
  const [row] = data;
  assert.ok(row);
  assert.equal(row.id, event.id);
});

void test('owner can update mutable event information', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const { data, error } = await actorA.client
    .from('events')
    .update({ title: 'updated title' })
    .eq('id', event.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.title, 'updated title');
});

// --- Negative: create boundary ---

// Sends only owner_id + title - the same narrow column subset the original
// (pre-Issue #17) migration granted INSERT on - and sets owner_id to the
// caller's own id, which events_insert_own's WITH CHECK (owner_id =
// auth.uid()) would happily allow. If any column-level INSERT grant for
// authenticated had survived the revokes in
// 20260821000200_create_event_with_occurrence_rpc.sql, this exact request
// would succeed (RLS would not be the thing stopping it). It doesn't, so
// this isolates the grant layer specifically, not just "some error
// occurred".
void test('authenticated client cannot directly INSERT into events, even with only the old granted columns', async () => {
  const { error } = await actorA.client.from('events').insert({
    owner_id: actorA.user.id,
    title: eventFixtureTitle(),
    // starts_on/ends_on are NOT NULL (Issue #88), so they have to be
    // present for this to type-check at all - but the point of this test is
    // the INSERT grant, not these columns, so any valid range works.
    starts_on: '2026-01-01',
    ends_on: '2026-01-10',
  });
  assert.ok(error, 'expected direct authenticated INSERT into events to be unsupported');
});

// Direct privilege inspection (not a PostgREST-level behavioral probe like
// the test above) proving the actual root cause: no column-level INSERT
// grant survives for authenticated on any column of events, including the
// ones the original migration granted (owner_id, title, venue, source_url,
// memo) and not just the temporal columns dropped in
// 20260821000100_backfill_and_drop_event_temporal_columns.sql. Connects as
// the DB superuser (like guardrail-proof.mjs's admin path) since this
// reads catalog metadata, not RLS-governed application data.
void test('no column-level INSERT grant survives for authenticated on events', async () => {
  const status = readLocalSupabaseStatus();
  const client = new pg.Client({ connectionString: status.dbUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select column_name
       from information_schema.role_column_grants
       where table_schema = 'public'
         and table_name = 'events'
         and grantee = 'authenticated'
         and privilege_type = 'INSERT'`,
    );
    assert.deepEqual(
      rows,
      [],
      'expected zero column-level INSERT grants for authenticated on events',
    );
  } finally {
    await client.end();
  }
});

void test('anonymous cannot directly INSERT into events', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.from('events').insert({
    owner_id: actorA.user.id,
    title: eventFixtureTitle(),
    starts_on: '2026-01-01',
    ends_on: '2026-01-10',
  });
  assert.ok(error, 'expected a permission error for anonymous insert');
});

void test('anonymous cannot execute the create_event RPC', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.rpc('create_event', {
    p_title: eventFixtureTitle(),
    p_starts_on: '2026-01-01',
    p_ends_on: '2026-01-10',
  });
  assert.ok(error, 'expected a permission error for anonymous RPC execution');
});

void test('create RPC has no input surface for owner spoofing', async () => {
  const { error } = await actorA.client.rpc('create_event', {
    p_title: eventFixtureTitle(),
    p_starts_on: '2026-01-01',
    p_ends_on: '2026-01-10',
    // owner_id is not a parameter of this function at all - passing it
    // must be rejected outright, not silently ignored.
    owner_id: actorB.user.id,
  });
  assert.ok(error, 'expected an unknown-parameter error, not a silently-ignored owner_id');
});

// The typed actor.client.rpc(...) call cannot even express a request
// missing the required p_starts_on/p_ends_on (the generated Args type has
// no `?` for them) - which is itself useful evidence that a real TypeScript
// caller can't accidentally omit them. To prove the *server* also rejects
// it (not just the generated types), this goes around the typed client with
// a raw HTTP call. This is a PostgREST function-resolution rejection (no
// matching overload) - the function body never runs, so this does not
// exercise rollback; see the next test for that.
void test('a request omitting starts_on is rejected before the function even runs', async () => {
  const title = eventFixtureTitle();
  const response = await callCreateEventRpcRaw(actorA, { p_title: title, p_ends_on: '2026-01-10' });
  assert.equal(response.ok, false, 'expected the RPC call to be rejected without p_starts_on');

  const { data, error: selectError } = await actorA.client
    .from('events')
    .select()
    .eq('title', title);
  assert.equal(selectError, null);
  assert.deepEqual(
    data,
    [],
    'expected no event row to survive a request missing the required starts_on',
  );
});

// p_starts_at is optional (Issue #87/#88: an event may have zero
// occurrences), so omitting/nulling it must succeed with no occurrence
// created - the opposite of the old required-occurrence contract this RPC
// used to have under its previous name.
void test('create RPC creates a 0-occurrence event when no initial occurrence is supplied', async () => {
  const title = eventFixtureTitle();
  const { data, error } = await actorA.client.rpc('create_event', {
    p_title: title,
    p_starts_on: '2026-02-01',
    p_ends_on: '2026-02-10',
  });
  assert.equal(error, null);
  assert.ok(data);
  assert.equal(data.starts_on, '2026-02-01');
  assert.equal(data.ends_on, '2026-02-10');

  const { data: occurrences, error: occurrencesError } = await actorA.client
    .from('event_occurrences')
    .select()
    .eq('event_id', data.id);
  assert.equal(occurrencesError, null);
  assert.deepEqual(occurrences, [], 'expected zero occurrences for the newly created event');
});

// An initial occurrence outside the supplied Event range makes the whole
// call fail (event_occurrences_within_event_range,
// 20260825000200_add_event_range_containment_triggers.sql), which proves
// the event insert and the occurrence insert roll back together, not just
// that the occurrence insert itself is rejected.
void test('RPC create is atomic: an initial occurrence outside the Event range rolls back the whole event', async () => {
  const title = eventFixtureTitle();
  const { error } = await actorA.client.rpc('create_event', {
    p_title: title,
    p_starts_on: '2026-03-01',
    p_ends_on: '2026-03-10',
    p_starts_at: '2026-04-01T10:00:00+09:00',
  });
  assert.ok(error, 'expected the containment trigger to reject an out-of-range initial occurrence');

  const { data, error: selectError } = await actorA.client
    .from('events')
    .select()
    .eq('title', title);
  assert.equal(selectError, null);
  assert.deepEqual(data, [], 'expected no event row to survive a failed initial occurrence insert');
});

// --- Negative: ownership ---

void test('user B cannot update user A’s event, and the row stays unchanged', async () => {
  const { event } = await createEventWithOccurrence(actorA);

  const { data: updateData, error: updateError } = await actorB.client
    .from('events')
    .update({ title: 'hijacked title' })
    .eq('id', event.id)
    .select();
  assert.equal(updateError, null);
  assert.deepEqual(updateData, []);

  const { data: refetched, error: refetchError } = await actorA.client
    .from('events')
    .select()
    .eq('id', event.id)
    .single();
  assert.equal(refetchError, null);
  assert.equal(refetched.title, event.title);
});

void test('owner cannot transfer ownership to another user', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const { error } = await actorA.client
    .from('events')
    .update({ owner_id: actorB.user.id })
    .eq('id', event.id);
  assert.ok(error, 'expected a permission error for changing owner_id');

  const { data: refetched } = await actorA.client
    .from('events')
    .select()
    .eq('id', event.id)
    .single();
  assert.equal(refetched?.owner_id, actorA.user.id);
});

// --- Negative: system-managed fields ---

void test('normal client cannot mutate id', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const { error } = await actorA.client
    .from('events')
    .update({ id: crypto.randomUUID() })
    .eq('id', event.id);
  assert.ok(error, 'expected a permission error for changing id');
});

void test('normal client cannot mutate created_at', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const { error } = await actorA.client
    .from('events')
    .update({ created_at: new Date(0).toISOString() })
    .eq('id', event.id);
  assert.ok(error, 'expected a permission error for changing created_at');
});

void test('updated_at is DB-managed on a real update', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const { data, error } = await actorA.client
    .from('events')
    .update({ title: 'trigger updated_at' })
    .eq('id', event.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.ok(data);
  assert.notEqual(data.updated_at, event.updated_at);
  assert.ok(new Date(data.updated_at).getTime() > new Date(event.updated_at).getTime());
});

void test('normal client cannot set updated_at directly', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const { error } = await actorA.client
    .from('events')
    .update({ updated_at: new Date(0).toISOString() })
    .eq('id', event.id);
  assert.ok(error, 'expected a permission error for setting updated_at directly');
});

// --- Negative: DELETE unsupported ---

void test('owner cannot delete an event', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const { error } = await actorA.client.from('events').delete().eq('id', event.id);
  assert.ok(error, 'expected DELETE to be unsupported for a normal authenticated client');
});

// --- Negative: anonymous read ---

void test('anonymous cannot read events', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.from('events').select();
  assert.ok(error, 'expected a permission error for anonymous select');
});

void test('anonymous cannot update events', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const anon = createAnonymousClient();
  const { error } = await anon.from('events').update({ title: 'anon edit' }).eq('id', event.id);
  assert.ok(error, 'expected a permission error for anonymous update');
});

void test('anonymous cannot delete events', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const anon = createAnonymousClient();
  const { error } = await anon.from('events').delete().eq('id', event.id);
  assert.ok(error, 'expected a permission error for anonymous delete');
});

// --- source_key: imported-entry identity (Issue #73) ---
//
// source_key exists so an operator import can recognise what it already
// created; events has no DELETE path, so an import that could not do that
// would produce permanently un-removable duplicates. These tests pin the
// two properties the import relies on: a normal client cannot write the
// column (it is operator/system-managed, like created_at), and the value
// is unique among imported events while staying absent for manual ones.

void test('normal client cannot set source_key', async () => {
  const { event } = await createEventWithOccurrence(actorA);
  const { error } = await actorA.client
    .from('events')
    .update({ source_key: 'takarazuka:2026:forged:takarazuka' })
    .eq('id', event.id);
  assert.ok(error, 'expected a permission error for setting source_key');
});

void test('an event created through the supported UI path has no source_key', async () => {
  // create_event_with_occurrence takes no source_key parameter, so events
  // created by hand are manual by construction - "imported" is exactly
  // "source_key is not null", with no second mechanism to keep in sync.
  const { event } = await createEventWithOccurrence(actorA);
  const { data, error } = await actorA.client
    .from('events')
    .select('source_key')
    .eq('id', event.id)
    .single();
  assert.equal(error, null);
  assert.equal(data.source_key, null);
});

void test('source_key is readable by an authenticated non-owner', async () => {
  // The shared catalog is readable by every authenticated user and
  // source_key is derived from public production pages, so it rides along
  // with the existing table-level SELECT grant rather than being hidden.
  const { event } = await createEventWithOccurrence(actorA);
  const { data, error } = await actorB.client
    .from('events')
    .select('id, source_key')
    .eq('id', event.id)
    .single();
  assert.equal(error, null);
  assert.equal(data.id, event.id);
});

void test('source_key is unique among imported events but repeatable as null', async () => {
  const status = readLocalSupabaseStatus();
  const client = new pg.Client({ connectionString: status.dbUrl });
  await client.connect();
  try {
    const key = `test:unique:${crypto.randomUUID()}`;
    const insert = (sourceKey: string | null) =>
      client.query(
        `insert into public.events (owner_id, title, source_key, starts_on, ends_on)
         values ($1, $2, $3, '2026-01-01', '2026-01-10') returning id`,
        [actorA.user.id, eventFixtureTitle(), sourceKey],
      );

    const first = await insert(key);
    assert.equal(first.rows.length, 1);
    await assert.rejects(
      () => insert(key),
      /duplicate key value|unique constraint/i,
      'expected a second event with the same source_key to be rejected',
    );

    // Manual events all share the absent value, so the index has to be
    // partial rather than treating "no source" as a colliding value.
    await insert(null);
    await insert(null);
  } finally {
    await client.end();
  }
});

// --- import_event_with_occurrences: atomic operator create path (Issue #73) ---
//
// The operator import writes an event and its occurrences in one call so a
// half-finished create cannot leave a zero-occurrence event in the shared
// catalog (product-rules.md D4). These tests pin the two things that makes
// depend on: only service_role can reach it, and any failure inside it takes
// the event row with it.

const IMPORT_RPC = 'import_event_with_occurrences';

// See test/rls/catalogCreators.test.ts's identical helper for why this is
// derived from "now" rather than a wide static range: a wide range would
// make every fixture event created below match listEventCatalogInRange's
// Event-range-overlap query (Issue #88) for nearly any period another test
// file queries against this same, not-reset-between-files local database.
const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;
function todayTokyoDate(): string {
  const tokyo = new Date(Date.now() + TOKYO_OFFSET_MS);
  const year = String(tokyo.getUTCFullYear()).padStart(4, '0');
  const month = String(tokyo.getUTCMonth() + 1).padStart(2, '0');
  const day = String(tokyo.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function importArgs(ownerId: string, overrides: Record<string, unknown> = {}) {
  return {
    p_owner_id: ownerId,
    p_source_key: `test:import:${crypto.randomUUID()}`,
    p_title: eventFixtureTitle(),
    p_starts_on: todayTokyoDate(),
    p_ends_on: todayTokyoDate(),
    p_occurrences: [{ startsAt: new Date().toISOString(), endsAt: null }],
    ...overrides,
  };
}

void test('anonymous cannot execute import_event_with_occurrences', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.rpc(IMPORT_RPC, importArgs(actorA.user.id));
  assert.ok(error, 'expected a permission error for anonymous execute');
});

void test('an authenticated catalog creator cannot execute import_event_with_occurrences', async () => {
  // actorA *is* a designated catalog creator, so a failure here is about the
  // EXECUTE grant and nothing else - the operator path stays operator-only
  // even for the account allowed to create events through the UI.
  const { error } = await actorA.client.rpc(IMPORT_RPC, importArgs(actorA.user.id));
  assert.ok(error, 'expected a permission error for authenticated execute');
});

void test('service_role can create an event and its occurrences in one call', async () => {
  const admin = createAdminClient();
  const startsAt = new Date().toISOString();
  const { data, error } = await admin.rpc(
    IMPORT_RPC,
    importArgs(actorA.user.id, {
      p_occurrences: [
        { startsAt, endsAt: null },
        { startsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString(), endsAt: null },
      ],
    }),
  );
  assert.equal(error, null);
  assert.ok(data);
  assert.equal(data.owner_id, actorA.user.id);

  const { data: occurrences } = await admin
    .from('event_occurrences')
    .select('id')
    .eq('event_id', data.id);
  assert.equal(occurrences?.length, 2);
});

void test('import_event_with_occurrences rejects an owner who is not a catalog creator', async () => {
  // Defence in depth: service_role bypasses RLS and the designated-creator
  // check inside create_event_with_occurrence, so without this the boundary
  // would rest on the calling script alone.
  const admin = createAdminClient();
  const { error } = await admin.rpc(IMPORT_RPC, importArgs(actorB.user.id));
  assert.ok(error, 'expected a permission error for a non-creator owner');
});

// Issue #87/#88: an imported event may have zero occurrences (an
// open-catalog / date-not-yet-published event), same as the UI create path.
void test('import_event_with_occurrences accepts an empty occurrence list and creates a 0-occurrence event', async () => {
  const admin = createAdminClient();
  const sourceKey = `test:import:${crypto.randomUUID()}`;
  const { data, error } = await admin.rpc(
    IMPORT_RPC,
    importArgs(actorA.user.id, { p_source_key: sourceKey, p_occurrences: [] }),
  );
  assert.equal(error, null);
  assert.ok(data);

  const { data: occurrences, error: occurrencesError } = await admin
    .from('event_occurrences')
    .select('id')
    .eq('event_id', data.id);
  assert.equal(occurrencesError, null);
  assert.deepEqual(occurrences, [], 'expected zero occurrences for the imported event');
});

void test('import_event_with_occurrences rejects an occurrence outside the supplied Event range', async () => {
  const admin = createAdminClient();
  const sourceKey = `test:import:${crypto.randomUUID()}`;
  const { error } = await admin.rpc(
    IMPORT_RPC,
    importArgs(actorA.user.id, {
      p_source_key: sourceKey,
      p_starts_on: '2026-05-01',
      p_ends_on: '2026-05-10',
      p_occurrences: [{ startsAt: '2026-06-01T10:00:00+09:00', endsAt: null }],
    }),
  );
  assert.ok(error, 'expected the containment trigger to reject an out-of-range occurrence');

  const { data } = await admin.from('events').select('id').eq('source_key', sourceKey);
  assert.deepEqual(data, [], 'expected no event row to have been created');
});

void test('a failure while inserting occurrences rolls the event row back', async () => {
  // The whole reason this function exists: the event and its occurrences
  // must not be separable. A malformed timestamp makes the occurrence INSERT
  // raise *after* the event row has been inserted within the same call, so
  // this proves the rollback comes from the transaction rather than from any
  // client-side compensation.
  const admin = createAdminClient();
  const sourceKey = `test:import:${crypto.randomUUID()}`;
  const { error } = await admin.rpc(
    IMPORT_RPC,
    importArgs(actorA.user.id, {
      p_source_key: sourceKey,
      p_occurrences: [
        { startsAt: new Date().toISOString(), endsAt: null },
        { startsAt: 'not-a-timestamp', endsAt: null },
      ],
    }),
  );
  assert.ok(error, 'expected the malformed occurrence to fail the call');

  const { data } = await admin.from('events').select('id').eq('source_key', sourceKey);
  assert.deepEqual(data, [], 'expected no zero-occurrence event to survive the failure');
});

// --- import_update_event: atomic operator-import update path (Issue #88) ---
//
// The update-side counterpart to import_event_with_occurrences' create
// path: a re-imported seed can correct an already-persisted event's
// details, Event range, and occurrence times in one call, one transaction.

const IMPORT_UPDATE_RPC = 'import_update_event';

async function createImportedFixtureEvent(
  startsOn: string,
  endsOn: string,
  occurrences: { startsAt: string; endsAt?: string | null; doorsAt?: string | null }[] = [],
) {
  const admin = createAdminClient();
  const sourceKey = `test:import-update:${crypto.randomUUID()}`;
  const { data, error } = await admin.rpc('import_event_with_occurrences', {
    p_owner_id: actorA.user.id,
    p_source_key: sourceKey,
    p_title: eventFixtureTitle(),
    p_starts_on: startsOn,
    p_ends_on: endsOn,
    p_occurrences: occurrences,
  });
  if (error) {
    throw new Error(`fixture import_event_with_occurrences failed: ${error.message}`);
  }
  return { admin, event: data };
}

function importUpdateArgs(eventId: string, overrides: Record<string, unknown> = {}) {
  return {
    p_event_id: eventId,
    p_title: eventFixtureTitle(),
    p_venue: undefined,
    p_source_url: undefined,
    p_memo: undefined,
    p_starts_on: '2029-01-01',
    p_ends_on: '2029-01-10',
    p_new_occurrences: [],
    p_occurrence_fixes: [],
    ...overrides,
  };
}

void test('anonymous cannot execute import_update_event', async () => {
  const { event } = await createImportedFixtureEvent('2029-01-01', '2029-01-10');
  const anon = createAnonymousClient();
  const { error } = await anon.rpc(IMPORT_UPDATE_RPC, importUpdateArgs(event.id));
  assert.ok(error, 'expected a permission error for anonymous execute');
});

void test('an authenticated catalog creator cannot execute import_update_event', async () => {
  const { event } = await createImportedFixtureEvent('2029-01-01', '2029-01-10');
  const { error } = await actorA.client.rpc(IMPORT_UPDATE_RPC, importUpdateArgs(event.id));
  assert.ok(error, 'expected a permission error for authenticated execute');
});

void test('service_role corrects an event’s Event range', async () => {
  const { admin, event } = await createImportedFixtureEvent('2029-02-01', '2029-02-10', [
    { startsAt: '2029-02-05T01:00:00Z', endsAt: null },
  ]);
  const { error } = await admin.rpc(
    IMPORT_UPDATE_RPC,
    importUpdateArgs(event.id, {
      p_title: event.title,
      p_starts_on: '2029-01-28',
      p_ends_on: '2029-02-12',
    }),
  );
  assert.equal(error, null);

  const { data } = await admin
    .from('events')
    .select('starts_on, ends_on')
    .eq('id', event.id)
    .single();
  assert.equal(data?.starts_on, '2029-01-28');
  assert.equal(data.ends_on, '2029-02-12');
});

void test('service_role adds new occurrences to an already-imported event', async () => {
  const { admin, event } = await createImportedFixtureEvent('2029-03-01', '2029-03-10', [
    { startsAt: '2029-03-05T01:00:00Z', endsAt: null },
  ]);
  const { error } = await admin.rpc(
    IMPORT_UPDATE_RPC,
    importUpdateArgs(event.id, {
      p_title: event.title,
      p_starts_on: '2029-03-01',
      p_ends_on: '2029-03-10',
      p_new_occurrences: [{ startsAt: '2029-03-08T01:00:00Z', endsAt: null, doorsAt: null }],
    }),
  );
  assert.equal(error, null);

  const { data } = await admin
    .from('event_occurrences')
    .select('starts_at')
    .eq('event_id', event.id);
  assert.equal(data?.length, 2);
});

// Direct proof for the accepted finding this RPC's conditional events
// UPDATE exists to close: an occurrence-only re-import (new occurrences
// and/or end/doors-time fixes, with every descriptive field and the Event
// range passed back unchanged) must not touch events.updated_at at all -
// not "no other test happens to notice a bump", but events.updated_at
// itself observed identical before and after.
void test('service_role: an occurrence-only update (no details/range change) leaves events.updated_at unchanged', async () => {
  const { admin, event } = await createImportedFixtureEvent('2029-10-01', '2029-10-10', [
    { startsAt: '2029-10-05T01:00:00Z', endsAt: null, doorsAt: null },
  ]);
  const { data: before } = await admin
    .from('events')
    .select('updated_at')
    .eq('id', event.id)
    .single();
  assert.ok(before);

  // A real (but wrongly-triggered) updated_at bump must be observably
  // different from `before` - without this pause, a millisecond-identical
  // now() on both sides could accidentally mask a real regression.
  await new Promise((resolve) => setTimeout(resolve, 20));

  const { data: occurrenceRows } = await admin
    .from('event_occurrences')
    .select('id')
    .eq('event_id', event.id);
  const occurrence = occurrenceRows?.[0];
  assert.ok(occurrence);

  const { error } = await admin.rpc(
    IMPORT_UPDATE_RPC,
    importUpdateArgs(event.id, {
      // Every descriptive field and the Event range are passed back
      // exactly as they already are - only occurrence-level writes below
      // are a real change.
      p_title: event.title,
      p_venue: event.venue,
      p_source_url: event.source_url,
      p_memo: event.memo,
      p_starts_on: '2029-10-01',
      p_ends_on: '2029-10-10',
      p_new_occurrences: [{ startsAt: '2029-10-08T01:00:00Z', endsAt: null, doorsAt: null }],
      p_occurrence_fixes: [{ id: occurrence.id, doorsAt: '2029-10-05T00:30:00Z' }],
    }),
  );
  assert.equal(error, null);

  const { data: after } = await admin
    .from('events')
    .select('updated_at')
    .eq('id', event.id)
    .single();
  assert.ok(after);
  assert.equal(
    after.updated_at,
    before.updated_at,
    'expected events.updated_at to be unchanged by an occurrence-only update',
  );
});

void test('service_role applies a 0-new-occurrences update (range/details-only correction)', async () => {
  const { admin, event } = await createImportedFixtureEvent('2029-04-01', '2029-04-10', []);
  const { error } = await admin.rpc(
    IMPORT_UPDATE_RPC,
    importUpdateArgs(event.id, {
      p_title: event.title,
      p_starts_on: '2029-04-01',
      p_ends_on: '2029-04-20',
      p_new_occurrences: [],
    }),
  );
  assert.equal(error, null);

  const { data } = await admin.from('events').select('ends_on').eq('id', event.id).single();
  assert.equal(data?.ends_on, '2029-04-20');
});

void test('service_role fills doors_at/ends_at on an existing occurrence without clearing a value it does not name', async () => {
  const { admin, event } = await createImportedFixtureEvent('2029-05-01', '2029-05-10', [
    { startsAt: '2029-05-05T01:00:00Z', endsAt: '2029-05-05T04:00:00Z', doorsAt: null },
  ]);
  const { data: occurrenceRows } = await admin
    .from('event_occurrences')
    .select('id, ends_at')
    .eq('event_id', event.id);
  const occurrence = occurrenceRows?.[0];
  assert.ok(occurrence);

  const { error } = await admin.rpc(
    IMPORT_UPDATE_RPC,
    importUpdateArgs(event.id, {
      p_title: event.title,
      p_starts_on: '2029-05-01',
      p_ends_on: '2029-05-10',
      p_occurrence_fixes: [{ id: occurrence.id, doorsAt: '2029-05-05T00:30:00Z', endsAt: null }],
    }),
  );
  assert.equal(error, null);

  const { data: refetched } = await admin
    .from('event_occurrences')
    .select('doors_at, ends_at')
    .eq('id', occurrence.id)
    .single();
  assert.ok(refetched);
  assert.ok(refetched.doors_at, 'expected doors_at to be filled in');
  assert.ok(refetched.ends_at);
  assert.equal(
    new Date(refetched.ends_at).toISOString(),
    '2029-05-05T04:00:00.000Z',
    'expected the existing ends_at to survive a fix element that named it as null',
  );
});

void test('an invalid Event range on import_update_event rolls back the whole call, including occurrence fixes', async () => {
  const { admin, event } = await createImportedFixtureEvent('2029-06-01', '2029-06-10', [
    { startsAt: '2029-06-05T01:00:00Z', endsAt: null, doorsAt: null },
  ]);
  const { data: occurrenceRows } = await admin
    .from('event_occurrences')
    .select('id')
    .eq('event_id', event.id);
  const occurrence = occurrenceRows?.[0];
  assert.ok(occurrence);

  const { error } = await admin.rpc(
    IMPORT_UPDATE_RPC,
    importUpdateArgs(event.id, {
      p_title: event.title,
      // starts_on > ends_on: violates events_starts_on_le_ends_on.
      p_starts_on: '2029-06-20',
      p_ends_on: '2029-06-10',
      p_occurrence_fixes: [{ id: occurrence.id, doorsAt: '2029-06-05T00:30:00Z' }],
    }),
  );
  assert.ok(error, 'expected the invalid range to reject the whole call');

  const { data: refetched } = await admin
    .from('event_occurrences')
    .select('doors_at')
    .eq('id', occurrence.id)
    .single();
  assert.equal(
    refetched?.doors_at,
    null,
    'expected the occurrence fix to have rolled back along with the invalid range',
  );
});

void test('an out-of-range new occurrence on import_update_event rolls back the whole call', async () => {
  const { admin, event } = await createImportedFixtureEvent('2029-07-01', '2029-07-10', []);
  const { error } = await admin.rpc(
    IMPORT_UPDATE_RPC,
    importUpdateArgs(event.id, {
      p_title: event.title,
      p_starts_on: '2029-07-01',
      p_ends_on: '2029-07-10',
      p_new_occurrences: [{ startsAt: '2029-08-01T01:00:00Z', endsAt: null, doorsAt: null }],
    }),
  );
  assert.ok(error, 'expected the out-of-range occurrence to reject the whole call');

  const { data } = await admin.from('event_occurrences').select('id').eq('event_id', event.id);
  assert.deepEqual(data, [], 'expected no occurrence to have been inserted');
});

void test('import_update_event rejects an occurrence fix id that belongs to a different event', async () => {
  const { admin, event: eventA } = await createImportedFixtureEvent('2029-09-01', '2029-09-10', []);
  const { event: eventB } = await createImportedFixtureEvent('2029-09-01', '2029-09-10', [
    { startsAt: '2029-09-05T01:00:00Z', endsAt: null, doorsAt: null },
  ]);
  const { data: eventBOccurrences } = await admin
    .from('event_occurrences')
    .select('id')
    .eq('event_id', eventB.id);
  const foreignOccurrence = eventBOccurrences?.[0];
  assert.ok(foreignOccurrence);

  const { error } = await admin.rpc(
    IMPORT_UPDATE_RPC,
    importUpdateArgs(eventA.id, {
      p_title: eventA.title,
      p_starts_on: '2029-09-01',
      p_ends_on: '2029-09-10',
      p_occurrence_fixes: [{ id: foreignOccurrence.id, doorsAt: '2029-09-05T00:30:00Z' }],
    }),
  );
  assert.ok(error, 'expected a mismatched-count error for a foreign occurrence id');

  const { data: refetched } = await admin
    .from('event_occurrences')
    .select('doors_at')
    .eq('id', foreignOccurrence.id)
    .single();
  assert.equal(refetched?.doors_at, null, "expected event B's occurrence to be untouched");
});
