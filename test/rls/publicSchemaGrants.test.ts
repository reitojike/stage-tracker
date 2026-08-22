import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';

// Direct privilege inspection for the whole public schema (Issue #42), not a
// PostgREST behavioral probe like the RLS tests elsewhere in this
// directory: TRUNCATE bypasses row level security entirely, so a
// policy-only reading of "is this table safe" cannot see it. This mirrors
// the single-table version of this test already established in
// catalogCreators.test.ts, generalized to run against every current
// public table rather than one.
//
// Root cause (see 20260822120000_harden_public_schema_client_grants.sql):
// this stack's default privileges give every new public table
// anon/authenticated = TRUNCATE + REFERENCES + TRIGGER + MAINTAIN, entirely
// independent of whatever a migration's own GRANT statements say. A
// migration that only ever adds grants never touches that residual ACL. The
// first test below is schema-wide and unconditional, so it also catches a
// future table that forgets the "revoke all ... from public, anon,
// authenticated" step this migration and #29/#30/#32 established, not just
// a regression on the four tables fixed here.

const RESIDUAL_PRIVILEGES = ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] as const;
const CLIENT_ROLES = ['anon', 'authenticated'] as const;

void test('no current public table grants anon or authenticated TRUNCATE/REFERENCES/TRIGGER/MAINTAIN', async () => {
  const status = readLocalSupabaseStatus();
  const client = new pg.Client({ connectionString: status.dbUrl });
  await client.connect();
  try {
    const { rows: tables } = await client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    assert.ok(tables.length > 0, 'expected at least one table in the public schema to inventory');

    const residual: string[] = [];
    for (const { tablename } of tables) {
      for (const role of CLIENT_ROLES) {
        for (const privilege of RESIDUAL_PRIVILEGES) {
          const { rows } = await client.query<{ has: boolean }>(
            `select has_table_privilege($1, $2, $3) as has`,
            [role, `public.${tablename}`, privilege],
          );
          if (rows[0]?.has) {
            residual.push(`${role} -> ${tablename}: ${privilege}`);
          }
        }
      }
    }

    assert.deepEqual(
      residual,
      [],
      `expected no residual TRUNCATE/REFERENCES/TRIGGER/MAINTAIN for anon/authenticated on any ` +
        `public table, found:\n${residual.join('\n')}`,
    );
  } finally {
    await client.end();
  }
});

interface ExactGrantExpectation {
  table: string;
  grantee: 'anon' | 'authenticated';
  privileges: string[];
}

// Exact-set assertions for the four tables 20260822120000 hardens
// (events, event_occurrences, personal_schedule_entries,
// personal_schedule_shares). Asserted as an exact set, not "at least
// SELECT" / "no INSERT", for the same reason as catalogCreators.test.ts:
// anything unexpected appearing here - including a residual privilege the
// first test above would also catch, or a product-intended grant silently
// lost by a future migration - is a real regression in this table's
// posture, not a passing "still has SELECT" check that would miss it.
//
// anon holds nothing on any of these four tables today - shared catalog
// reads and personal-data reads alike require authentication - so anon's
// expected set is always empty.
const EXACT_GRANTS: ExactGrantExpectation[] = [
  { table: 'events', grantee: 'anon', privileges: [] },
  { table: 'events', grantee: 'authenticated', privileges: ['SELECT', 'UPDATE'] },
  { table: 'event_occurrences', grantee: 'anon', privileges: [] },
  {
    table: 'event_occurrences',
    grantee: 'authenticated',
    privileges: ['SELECT', 'INSERT', 'UPDATE'],
  },
  { table: 'personal_schedule_entries', grantee: 'anon', privileges: [] },
  {
    table: 'personal_schedule_entries',
    grantee: 'authenticated',
    privileges: ['SELECT', 'INSERT', 'UPDATE'],
  },
  { table: 'personal_schedule_shares', grantee: 'anon', privileges: [] },
  {
    table: 'personal_schedule_shares',
    grantee: 'authenticated',
    privileges: ['SELECT', 'INSERT', 'DELETE'],
  },
];

for (const expectation of EXACT_GRANTS) {
  void test(`${expectation.grantee} holds exactly [${expectation.privileges.join(', ')}] on ${expectation.table}`, async () => {
    const status = readLocalSupabaseStatus();
    const client = new pg.Client({ connectionString: status.dbUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ privilege_type: string }>(
        `select distinct privilege_type
         from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = $1
           and grantee = $2
         union
         select distinct privilege_type
         from information_schema.role_column_grants
         where table_schema = 'public'
           and table_name = $1
           and grantee = $2`,
        [expectation.table, expectation.grantee],
      );
      assert.deepEqual(
        rows.map((row) => row.privilege_type).sort(),
        [...expectation.privileges].sort(),
        `expected ${expectation.grantee} to hold exactly [${expectation.privileges.join(', ')}] on ${expectation.table}`,
      );
    } finally {
      await client.end();
    }
  });
}
