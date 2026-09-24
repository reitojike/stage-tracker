import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';

const status = readLocalSupabaseStatus();

void test('held-page commit is owner-only, atomic, and readable only by creators', async () => {
  const client = new pg.Client({ connectionString: status.dbUrl });
  await client.connect();
  const runId = randomUUID();
  const secondRunId = randomUUID();
  const heldPages = JSON.stringify([
    {
      canonical_url: 'https://www.kabuki-bito.jp/theaters/other/play/1000',
      official_external_id: '1000',
      title: '保留公演',
      starts_on: '2026-10-01',
      ends_on: '2026-10-02',
      reason_code: 'source_parse',
    },
  ]);
  try {
    await client.query('begin');
    const { rows: privileges } = await client.query<{
      reader: boolean;
      writer: boolean;
      caller: boolean;
    }>(`select
      has_table_privilege('authenticated', 'public.official_import_held_pages', 'SELECT') as reader,
      has_table_privilege('authenticated', 'public.official_import_held_pages', 'INSERT') as writer,
      has_function_privilege(
        'authenticated',
        'public.commit_owned_official_import_partial_batch(uuid,text,text,jsonb,jsonb)',
        'EXECUTE'
      ) as caller`);
    assert.deepEqual(privileges[0], { reader: true, writer: false, caller: false });

    await client.query('set local role service_role');
    const claim = await client.query<{ result: string }>(
      `select public.claim_official_import_run_attempt($1, $2, $3, 300) as result`,
      [runId, 'event.kabuki-bito.schedule', 'owner'],
    );
    assert.equal(claim.rows[0]?.result, 'claimed');
    const commit = await client.query<{ count: number }>(
      `select public.commit_owned_official_import_partial_batch(
        $1, $2, $3, '[]'::jsonb, $4::jsonb
      ) as count`,
      [runId, 'event.kabuki-bito.schedule', 'owner', heldPages],
    );
    assert.equal(commit.rows[0]?.count, 0);
    const committed = await client.query<{ status: string; held_count: string }>(
      `select run.status,
        (select count(*) from public.official_import_held_pages held where held.run_id = run.id) as held_count
       from public.official_import_runs run where run.id = $1`,
      [runId],
    );
    assert.deepEqual(committed.rows[0], { status: 'completed', held_count: '1' });

    const replay = await client.query<{ count: number }>(
      `select public.commit_owned_official_import_partial_batch(
        $1, $2, $3, '[]'::jsonb, $4::jsonb
      ) as count`,
      [runId, 'event.kabuki-bito.schedule', 'owner', heldPages],
    );
    assert.equal(replay.rows[0]?.count, 0);

    await client.query(`select public.claim_official_import_run_attempt($1, $2, $3, 300)`, [
      secondRunId,
      'event.kabuki-bito.schedule',
      'second-owner',
    ]);
    await client.query('savepoint stale_owner');
    await assert.rejects(
      client.query(
        `select public.commit_owned_official_import_partial_batch(
          $1, $2, $3, '[]'::jsonb, $4::jsonb
        )`,
        [secondRunId, 'event.kabuki-bito.schedule', 'stale-owner', heldPages],
      ),
      { code: '55000' },
    );
    await client.query('rollback to savepoint stale_owner');
    await client.query('savepoint invalid_batch');
    await assert.rejects(
      client.query(
        `select public.commit_owned_official_import_partial_batch(
          $1, $2, $3, '{}'::jsonb, $4::jsonb
        )`,
        [secondRunId, 'event.kabuki-bito.schedule', 'second-owner', heldPages],
      ),
      { code: '22023' },
    );
    await client.query('rollback to savepoint invalid_batch');
    const { rows: leaked } = await client.query<{ count: string }>(
      `select count(*) from public.official_import_held_pages where run_id = $1`,
      [secondRunId],
    );
    assert.equal(leaked[0]?.count, '0');
  } finally {
    await client.query('rollback');
    await client.end();
  }
});
