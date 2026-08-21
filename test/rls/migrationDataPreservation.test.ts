// Deterministic proof that Issue #17's migration preserves existing
// events.starts_at/ends_at data as occurrence rows, rather than relying on
// "local reset currently has 0 rows, so it must be safe".
//
// This replays the actual committed migration SQL - not a hand-written
// approximation of it - against an isolated scratch schema inside the same
// local Postgres instance, with a real fixture row inserted under the
// *pre-migration* shape (only the baseline events migration applied)
// before the occurrence-table and backfill/drop migrations run. That lets
// this test observe the exact transition the real migration performs
// without touching the shared local Supabase stack's actual `public`
// schema.
//
// Schema-qualification is rewritten from `public.` to the scratch schema
// for isolation; `auth.users`/`auth.uid()` references are left untouched
// (auth.users is a real, shared table - the fixture owner below is a real
// provisioned test user, not a fabricated id). Grants/RLS/trigger DDL in
// the replayed files execute harmlessly under the superuser connection
// used here; they are not what this test is verifying (see
// events.test.ts / eventOccurrences.test.ts for RLS itself).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { createTestActor, deleteTestActor, type TestActor } from './support/testActors.ts';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';

const status = readLocalSupabaseStatus();
const SCHEMA = 'issue17_migration_preservation_test';

const MIGRATIONS_DIR = path.resolve('supabase/migrations');
const BASELINE_MIGRATION = '20260820000000_create_events.sql';
const CREATE_OCCURRENCES_MIGRATION = '20260821000000_create_event_occurrences.sql';
const BACKFILL_AND_DROP_MIGRATION = '20260821000100_backfill_and_drop_event_temporal_columns.sql';

function readMigration(filename: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
}

// Schema-qualification isolation only - every occurrence of `public.` in
// the committed migrations is a schema qualifier (table/function
// references), never part of an identifier or string literal, so a plain
// substring replace is exact here.
function scopedToTestSchema(sql: string): string {
  return sql.split('public.').join(`${SCHEMA}.`);
}

async function withPgClient<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: status.dbUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

let owner: TestActor;

before(async () => {
  owner = await createTestActor('migration-preservation-owner', 'Str0ng-Test-Passw0rd!');
  await withPgClient(async (client) => {
    await client.query(`drop schema if exists ${SCHEMA} cascade`);
    await client.query(`create schema ${SCHEMA}`);
  });
});

after(async () => {
  await withPgClient((client) => client.query(`drop schema if exists ${SCHEMA} cascade`));
  await deleteTestActor(owner);
});

void test('existing events.starts_at/ends_at survive migration as exactly one occurrence each, and the columns are dropped afterward', async () => {
  await withPgClient(async (client) => {
    // 1. Pre-migration baseline only: events with flat starts_at/ends_at,
    // no occurrence table yet - this is the real shape the migration must
    // handle existing rows under.
    await client.query(scopedToTestSchema(readMigration(BASELINE_MIGRATION)));

    // 2. Insert fixture rows directly under that pre-migration shape,
    // simulating data that already existed before this Task's migrations
    // ever ran. One with a non-null ends_at, one with ends_at left unset,
    // to prove both the value and the nullability survive.
    const withEnd = await client.query<{
      id: string;
      owner_id: string;
      title: string;
      venue: string | null;
      starts_at: string;
      ends_at: string | null;
      source_url: string | null;
      memo: string | null;
      created_at: string;
    }>(
      `insert into ${SCHEMA}.events (owner_id, title, venue, starts_at, ends_at, source_url, memo)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [
        owner.user.id,
        'pre-migration fixture event with end',
        'Fixture Hall',
        '2026-01-10T10:00:00.000Z',
        '2026-01-10T12:30:00.000Z',
        'https://example.test/fixture-with-end',
        'fixture memo',
      ],
    );
    const withoutEnd = await client.query<{
      id: string;
      starts_at: string;
      ends_at: string | null;
    }>(
      `insert into ${SCHEMA}.events (owner_id, title, starts_at)
       values ($1, $2, $3)
       returning *`,
      [owner.user.id, 'pre-migration fixture event without end', '2026-02-01T09:00:00.000Z'],
    );

    const fixtureWithEnd = withEnd.rows[0];
    const fixtureWithoutEnd = withoutEnd.rows[0];
    assert.ok(fixtureWithEnd);
    assert.ok(fixtureWithoutEnd);

    // 3. Run this Task's migrations, in the same order supabase applies
    // them: create occurrence persistence, then backfill + drop.
    await client.query(scopedToTestSchema(readMigration(CREATE_OCCURRENCES_MIGRATION)));
    await client.query(scopedToTestSchema(readMigration(BACKFILL_AND_DROP_MIGRATION)));

    // 4. The event rows themselves survive with identity/descriptive
    // fields intact.
    interface SurvivingEventRow {
      id: string;
      owner_id: string;
      title: string;
      venue: string | null;
      source_url: string | null;
      memo: string | null;
      created_at: string;
    }
    const survivingEvents = await client.query<SurvivingEventRow>(
      `select id, owner_id, title, venue, source_url, memo, created_at
       from ${SCHEMA}.events
       where id = any($1)
       order by title`,
      [[fixtureWithEnd.id, fixtureWithoutEnd.id]],
    );
    assert.equal(survivingEvents.rows.length, 2);
    const [survivingWithEnd, survivingWithoutEnd] = survivingEvents.rows;
    assert.ok(survivingWithEnd);
    assert.ok(survivingWithoutEnd);
    assert.equal(survivingWithEnd.id, fixtureWithEnd.id);
    assert.equal(survivingWithEnd.owner_id, owner.user.id);
    assert.equal(survivingWithEnd.title, 'pre-migration fixture event with end');
    assert.equal(survivingWithEnd.venue, 'Fixture Hall');
    assert.equal(survivingWithEnd.source_url, 'https://example.test/fixture-with-end');
    assert.equal(survivingWithEnd.memo, 'fixture memo');
    assert.equal(survivingWithoutEnd.id, fixtureWithoutEnd.id);
    assert.equal(survivingWithoutEnd.title, 'pre-migration fixture event without end');

    // 5. events no longer has starts_at/ends_at columns - no dual source
    // of truth remains.
    const remainingTemporalColumns = await client.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = $1
         and table_name = 'events'
         and column_name in ('starts_at', 'ends_at')`,
      [SCHEMA],
    );
    assert.deepEqual(remainingTemporalColumns.rows, []);

    // 6. Exactly one occurrence per event, with the original starts_at/
    // ends_at values (and nullability) preserved exactly.
    interface OccurrenceRow {
      event_id: string;
      starts_at: string;
      ends_at: string | null;
    }
    const occurrencesWithEnd = await client.query<OccurrenceRow>(
      `select event_id, starts_at, ends_at from ${SCHEMA}.event_occurrences where event_id = $1`,
      [fixtureWithEnd.id],
    );
    assert.equal(occurrencesWithEnd.rows.length, 1);
    const [occurrenceWithEnd] = occurrencesWithEnd.rows;
    assert.ok(occurrenceWithEnd);
    assert.equal(new Date(occurrenceWithEnd.starts_at).toISOString(), '2026-01-10T10:00:00.000Z');
    assert.ok(occurrenceWithEnd.ends_at);
    assert.equal(new Date(occurrenceWithEnd.ends_at).toISOString(), '2026-01-10T12:30:00.000Z');

    const occurrencesWithoutEnd = await client.query<OccurrenceRow>(
      `select event_id, starts_at, ends_at from ${SCHEMA}.event_occurrences where event_id = $1`,
      [fixtureWithoutEnd.id],
    );
    assert.equal(occurrencesWithoutEnd.rows.length, 1);
    const [occurrenceWithoutEnd] = occurrencesWithoutEnd.rows;
    assert.ok(occurrenceWithoutEnd);
    assert.equal(
      new Date(occurrenceWithoutEnd.starts_at).toISOString(),
      '2026-02-01T09:00:00.000Z',
    );
    assert.equal(occurrenceWithoutEnd.ends_at, null);

    // 7. The occurrence schema itself still requires starts_at and allows
    // a null ends_at going forward, not just for the backfilled rows.
    const columnNullability = await client.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable
       from information_schema.columns
       where table_schema = $1
         and table_name = 'event_occurrences'
         and column_name in ('starts_at', 'ends_at')`,
      [SCHEMA],
    );
    const nullabilityByColumn = new Map(
      columnNullability.rows.map((row) => [row.column_name, row.is_nullable]),
    );
    assert.equal(nullabilityByColumn.get('starts_at'), 'NO');
    assert.equal(nullabilityByColumn.get('ends_at'), 'YES');
  });
});
