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

const status = readLocalSupabaseStatus();

async function withPgClient<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: status.dbUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const RESIDUAL_PRIVILEGES = ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] as const;
const CLIENT_ROLES = ['anon', 'authenticated'] as const;

void test('no current public table grants anon or authenticated TRUNCATE/REFERENCES/TRIGGER/MAINTAIN', async () => {
  // One batched query (cross join over the role/privilege arrays, joined
  // against every current public table) rather than a per-(table, role,
  // privilege) round trip - the schema keeps growing new tables, and this
  // test is meant to run unconditionally on every verify pass.
  const { residual, tableCount } = await withPgClient(async (client) => {
    const { rows: tables } = await client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public'`,
    );
    const { rows } = await client.query<{ tablename: string; role: string; privilege: string }>(
      `select t.tablename, r.role, p.privilege
       from pg_tables t
       cross join unnest($1::text[]) as r(role)
       cross join unnest($2::text[]) as p(privilege)
       where t.schemaname = 'public'
         and has_table_privilege(r.role, 'public.' || t.tablename, p.privilege)
       order by t.tablename, r.role, p.privilege`,
      [CLIENT_ROLES, RESIDUAL_PRIVILEGES],
    );
    return { residual: rows, tableCount: tables.length };
  });

  assert.ok(tableCount > 0, 'expected at least one table in the public schema to inventory');

  assert.deepEqual(
    residual.map((row) => `${row.role} -> ${row.tablename}: ${row.privilege}`),
    [],
    `expected no residual TRUNCATE/REFERENCES/TRIGGER/MAINTAIN for anon/authenticated on any ` +
      `public table, found:\n${residual.map((row) => `${row.role} -> ${row.tablename}: ${row.privilege}`).join('\n')}`,
  );
});

interface ExactGrantExpectation {
  table: string;
  grantee: 'anon' | 'authenticated';
  // Every privilege_type this grantee should hold on this table, whether
  // table-level (SELECT, DELETE here) or column-level (INSERT, UPDATE
  // here) - information_schema.role_table_grants and role_column_grants
  // are unioned below, so both kinds land in the same set.
  privileges: string[];
  // For column-scoped privileges (INSERT/UPDATE on these four tables),
  // the exact column list that privilege_type set alone cannot express.
  // Without this, a future edit that widened e.g. `grant update (...)` to
  // include owner_id - reopening the system-managed-field boundary these
  // tables' own creating migrations deliberately withhold it from - would
  // still pass a privilege_type-only check, since UPDATE would already be
  // in the expected set regardless of which column carries it.
  columns?: Partial<Record<'INSERT' | 'UPDATE', string[]>>;
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
  {
    table: 'events',
    grantee: 'authenticated',
    privileges: ['SELECT', 'UPDATE'],
    columns: {
      UPDATE: ['title', 'venue', 'source_url', 'memo', 'starts_on', 'ends_on', 'canceled_at'],
    },
  },
  { table: 'event_occurrences', grantee: 'anon', privileges: [] },
  {
    table: 'event_occurrences',
    grantee: 'authenticated',
    privileges: ['SELECT', 'INSERT', 'UPDATE'],
    columns: {
      INSERT: ['event_id', 'starts_at', 'ends_at', 'doors_at'],
      UPDATE: ['starts_at', 'ends_at', 'doors_at', 'canceled_at'],
    },
  },
  { table: 'personal_schedule_entries', grantee: 'anon', privileges: [] },
  {
    table: 'personal_schedule_entries',
    grantee: 'authenticated',
    privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    columns: {
      INSERT: [
        'owner_id',
        'memo',
        'is_all_day',
        'starts_on',
        'ends_on',
        'starts_at',
        'ends_at',
        'title',
        'blocking',
      ],
      UPDATE: [
        'memo',
        'is_all_day',
        'starts_on',
        'ends_on',
        'starts_at',
        'ends_at',
        'title',
        'blocking',
      ],
    },
  },
  { table: 'personal_schedule_shares', grantee: 'anon', privileges: [] },
  {
    table: 'personal_schedule_shares',
    grantee: 'authenticated',
    privileges: ['SELECT', 'INSERT', 'DELETE'],
    columns: { INSERT: ['schedule_entry_id', 'shared_with_user_id'] },
  },
];

for (const expectation of EXACT_GRANTS) {
  void test(`${expectation.grantee} holds exactly [${expectation.privileges.join(', ')}] on ${expectation.table}`, async () => {
    await withPgClient(async (client) => {
      const { rows: privilegeRows } = await client.query<{ privilege_type: string }>(
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
        privilegeRows.map((row) => row.privilege_type).sort(),
        [...expectation.privileges].sort(),
        `expected ${expectation.grantee} to hold exactly [${expectation.privileges.join(', ')}] on ${expectation.table}`,
      );

      for (const privilege of ['INSERT', 'UPDATE'] as const) {
        const expectedColumns = expectation.columns?.[privilege];
        if (expectedColumns === undefined) {
          continue;
        }
        const { rows: columnRows } = await client.query<{ column_name: string }>(
          `select column_name
           from information_schema.role_column_grants
           where table_schema = 'public'
             and table_name = $1
             and grantee = $2
             and privilege_type = $3`,
          [expectation.table, expectation.grantee, privilege],
        );
        assert.deepEqual(
          columnRows.map((row) => row.column_name).sort(),
          [...expectedColumns].sort(),
          `expected ${expectation.grantee} to hold ${privilege} on exactly [${expectedColumns.join(', ')}] on ${expectation.table}`,
        );
      }
    });
  });
}
