// Deterministic proof that 20260825000000_add_event_range.sql's backfill
// derives the correct starts_on/ends_on for an existing event from its
// occurrences' Tokyo calendar dates, and fails closed (aborts, leaving the
// schema unchanged) rather than silently leaving a NOT NULL column null for
// an event with zero occurrences (Issue #88).
//
// Same replay-the-real-migration-SQL-against-a-scratch-schema technique as
// migrationDataPreservation.test.ts (Issue #17) - see that file's header
// comment for the rationale. This replays the pre-#88 baseline chain
// (create events -> create event_occurrences -> backfill/drop events'
// original starts_at/ends_at into occurrences) to reach the exact shape
// 20260825000000_add_event_range.sql runs against on a real database,
// inserts fixture rows directly under that shape, then runs the migration
// under test.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { createTestActor, deleteTestActor, type TestActor } from './support/testActors.ts';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';
import { withDeadlockRetry } from './support/deadlockRetry.ts';

const status = readLocalSupabaseStatus();

const MIGRATIONS_DIR = path.resolve('supabase/migrations');
const BASELINE_MIGRATION = '20260820000000_create_events.sql';
const CREATE_OCCURRENCES_MIGRATION = '20260821000000_create_event_occurrences.sql';
const BACKFILL_AND_DROP_MIGRATION = '20260821000100_backfill_and_drop_event_temporal_columns.sql';
const ADD_EVENT_RANGE_MIGRATION = '20260825000000_add_event_range.sql';

function readMigration(filename: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
}

function scopedToTestSchema(sql: string, schema: string): string {
  return sql.split('public.').join(`${schema}.`);
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

// The whole replay (drop/create schema through every migration statement)
// is one retryable unit: dropping and recreating the schema at the start of
// each attempt clears any partial state a prior attempt left behind, so
// retrying from scratch is always safe here. See support/deadlockRetry.ts
// for why this can transiently deadlock at all.
async function replayToPreIssue88Baseline(client: pg.Client, schema: string): Promise<void> {
  await withDeadlockRetry(client, async () => {
    await client.query(`drop schema if exists ${schema} cascade`);
    await client.query(`create schema ${schema}`);
    await client.query(scopedToTestSchema(readMigration(BASELINE_MIGRATION), schema));
    await client.query(scopedToTestSchema(readMigration(CREATE_OCCURRENCES_MIGRATION), schema));
    await client.query(scopedToTestSchema(readMigration(BACKFILL_AND_DROP_MIGRATION), schema));
  });
}

let owner: TestActor;

before(async () => {
  owner = await createTestActor('event-range-backfill-owner', 'Str0ng-Test-Passw0rd!');
});

after(async () => {
  await withPgClient((client) =>
    client.query(`
      drop schema if exists issue88_event_range_backfill_test cascade;
      drop schema if exists issue88_event_range_backfill_zero_test cascade;
    `),
  );
  await deleteTestActor(owner);
});

void test('backfill derives starts_on/ends_on from an event’s occurrences’ Tokyo calendar dates', async () => {
  const SCHEMA = 'issue88_event_range_backfill_test';
  await withPgClient(async (client) => {
    await replayToPreIssue88Baseline(client, SCHEMA);

    const event = await client.query<{ id: string }>(
      `insert into ${SCHEMA}.events (owner_id, title) values ($1, $2) returning id`,
      [owner.user.id, 'backfill fixture event'],
    );
    const eventId = event.rows[0]?.id;
    assert.ok(eventId);

    // Three occurrences spanning three distinct Tokyo calendar days. One
    // instant (2026-03-10T20:00:00Z) is deliberately past-midnight in UTC
    // but still 2026-03-11 in Asia/Tokyo (+9h), to prove the backfill uses
    // the Tokyo date, not the raw UTC date, for both bounds.
    await client.query(
      `insert into ${SCHEMA}.event_occurrences (event_id, starts_at) values
         ($1, '2026-03-05T01:00:00Z'),
         ($1, '2026-03-10T20:00:00Z'),
         ($1, '2026-03-15T04:00:00Z')`,
      [eventId],
    );

    await withDeadlockRetry(client, () =>
      client.query(scopedToTestSchema(readMigration(ADD_EVENT_RANGE_MIGRATION), SCHEMA)),
    );

    // to_char, not a bare select: node-pg's default type parser returns
    // `date` columns as a JS Date constructed at local midnight, which
    // round-trips through this test runner's own timezone rather than the
    // Asia/Tokyo calendar date the column actually holds - exactly the kind
    // of implicit-local-timezone bug this product's own domain layer
    // (src/domain/eventCatalog.ts) goes out of its way to avoid. Reading
    // the column back as the "YYYY-MM-DD" text it stores sidesteps that
    // parser entirely.
    const row = await client.query<{ starts_on: string; ends_on: string }>(
      `select to_char(starts_on, 'YYYY-MM-DD') as starts_on,
              to_char(ends_on, 'YYYY-MM-DD') as ends_on
       from ${SCHEMA}.events where id = $1`,
      [eventId],
    );
    assert.equal(row.rows[0]?.starts_on, '2026-03-05');
    // 2026-03-15T04:00:00Z is 2026-03-15T13:00 Asia/Tokyo - still the 15th,
    // not pushed to the 16th; distinct from the deliberately UTC-midnight-
    // crossing middle fixture, which the assertion above already pins.
    assert.equal(row.rows[0].ends_on, '2026-03-15');

    const columns = await client.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable
       from information_schema.columns
       where table_schema = $1
         and table_name = 'events'
         and column_name in ('starts_on', 'ends_on')`,
      [SCHEMA],
    );
    for (const column of columns.rows) {
      assert.equal(column.is_nullable, 'NO', `expected ${column.column_name} to be NOT NULL`);
    }
  });
});

void test('backfill fails closed (aborts, no partial schema change) for an event with zero occurrences', async () => {
  const SCHEMA = 'issue88_event_range_backfill_zero_test';
  await withPgClient(async (client) => {
    await replayToPreIssue88Baseline(client, SCHEMA);

    // A zero-occurrence event could not exist on a real pre-#88 database
    // (the pre-#88 invariant this migration relaxes requires >=1
    // occurrence on every write path), but this migration must not assume
    // that in general (PO checkpoint feedback) - it has to detect and fail
    // closed on this row rather than silently leaving starts_on/ends_on
    // null, and rather than inventing a fabricated range.
    await client.query(`insert into ${SCHEMA}.events (owner_id, title) values ($1, $2)`, [
      owner.user.id,
      'zero-occurrence fixture event',
    ]);

    await assert.rejects(
      () =>
        withDeadlockRetry(client, () =>
          client.query(scopedToTestSchema(readMigration(ADD_EVENT_RANGE_MIGRATION), SCHEMA)),
        ),
      /left \d+ row\(s\) with a null starts_on\/ends_on/,
    );
    // The failed migration's explicit `begin` never reached a matching
    // `commit` (the raised exception aborted it first), so this connection
    // is left inside a failed transaction block - every statement on it
    // errors with "current transaction is aborted" until an explicit
    // rollback ends that block. A fresh `pg.Client` per test (withPgClient)
    // would sidestep this too, but reusing the same connection is what
    // proves the migration itself never reached its own `commit`.
    await client.query('rollback');

    // The migration's own `begin`/`commit` wraps every DDL/DML statement it
    // performs, so the failed `do $$ ... raise exception $$` block rolls
    // the whole attempt back - starts_on/ends_on must not exist at all
    // (not even as nullable columns) after the failure.
    const columns = await client.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = $1
         and table_name = 'events'
         and column_name in ('starts_on', 'ends_on')`,
      [SCHEMA],
    );
    assert.deepEqual(columns.rows, []);
  });
});
