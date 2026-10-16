import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import pg from 'pg';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';

// #829: prove both commit orders at the new catalog equality lock. Fixtures
// reconstruct pre-ordinal rejections locally; no production data or operations.
const status = readLocalSupabaseStatus();
const source = 'event.kabuki-bito.schedule';
const errors = new WeakMap<pg.Client, Error[]>();

async function connect() {
  const client = new pg.Client({
    connectionString: status.dbUrl,
    connectionTimeoutMillis: 5000,
    query_timeout: 20_000,
  });
  const recorded: Error[] = [];
  errors.set(client, recorded);
  client.on('error', (error: Error) => recorded.push(error));
  try {
    await client.connect();
    await client.query("set statement_timeout='15s'");
    await client.query("set idle_in_transaction_session_timeout='20s'");
    return client;
  } catch (error) {
    await client.end();
    throw error;
  }
}

async function blockedBy(observer: pg.Client, waiter: pg.Client, blocker: pg.Client) {
  const waiterPid = (await waiter.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]!
    .pid;
  const blockerPid = (await blocker.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]!
    .pid;
  return async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const result = await observer.query<{ blocked: boolean }>(
        'select $2::integer=any(pg_blocking_pids($1::integer)) blocked',
        [waiterPid, blockerPid],
      );
      if (result.rows[0]?.blocked) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail('expected catalog lock wait was not observed');
  };
}

// Other files exercise the same real source lease concurrently. Retry only an
// explicit 'busy' claim, before this transaction has made any fixture changes.
async function claim(client: pg.Client, run: string, token: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const result = (
      await client.query<{ result: string }>(
        'select public.claim_official_import_run_attempt($1,$2,$3,300) result',
        [run, source, token],
      )
    ).rows[0]!.result;
    if (result === 'claimed') return;
    assert.equal(result, 'busy');
    await client.query('rollback');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await client.query('begin');
  }
  assert.fail('source lease remained busy during fixture setup');
}

async function fixture(admin: pg.Client, savedPending = false) {
  const owner = randomUUID();
  const event = randomUUID();
  const identity = randomUUID().replaceAll(/[^0-9]/g, '');
  const url = `https://www.kabuki-bito.jp/theaters/kabukiza/play/${identity}`;
  const runs: string[] = [];
  const payload = [
    {
      candidate_kind: 'event',
      canonical_url: url,
      official_external_id: identity,
      observed_at: '2027-01-01T00:00:00Z',
      content_hash: 'b'.repeat(64),
      proposal_version: 'event.v1',
      evidence_locator: {},
      deterministic_match_status: 'matched',
      semantic_match_status: 'not_used',
      resolved_event_id: event,
      review_status: 'pending',
      plan_fingerprint: `noop-${identity}`,
      proposal: {
        sourceKey: `kabuki-bito:kabukiza:play:${identity}`,
        sourceUrl: url,
        title: 'Fixture',
        venue: 'Hall',
        memo: null,
        startsOn: '2027-01-01',
        endsOn: '2027-01-02',
        occurrences: [
          { startsAt: '2027-01-01T12:00:00+09:00', endsAt: '2027-01-01T15:00:00+09:00' },
        ],
      },
      plan_summary: {
        version: 'event_plan.v1',
        action: 'unchanged',
        detailsChanged: false,
        rangeChanged: false,
        newOccurrenceCount: 0,
        endsAtFixCount: 0,
        doorsAtFixCount: 0,
        keptOccurrenceCount: 0,
        genreChanged: false,
        groupsChanged: false,
      },
    },
  ];
  async function publish(client: pg.Client, input = payload) {
    const run = randomUUID();
    runs.push(run);
    await claim(client, run, 'fixture');
    const result = await client.query<{ count: number }>(
      "select public.commit_owned_official_import_candidate_batch($1,$2,'fixture',$3::jsonb) count",
      [run, source, JSON.stringify(input)],
    );
    return { run, count: result.rows[0]!.count };
  }
  await admin.query('begin');
  try {
    const run = randomUUID();
    runs.push(run);
    await claim(admin, run, 'legacy');
    await admin.query('insert into auth.users(id) values($1)', [owner]);
    await admin.query('insert into public.catalog_creators(user_id) values($1)', [owner]);
    await admin.query(
      `insert into public.events(id,owner_id,source_key,source_url,title,venue,starts_on,ends_on)
      values($1,$2,$3,$4,'Fixture','Hall','2027-01-01','2027-01-02')`,
      [event, owner, payload[0]!.proposal.sourceKey, url],
    );
    await admin.query(
      `insert into public.event_occurrences(event_id,starts_at,ends_at)
      values($1,'2027-01-01T12:00:00+09:00','2027-01-01T15:00:00+09:00')`,
      [event],
    );
    const legacy = structuredClone(payload);
    legacy[0]!.plan_summary.action = 'create';
    legacy[0]!.plan_summary.detailsChanged = true;
    await admin.query(
      "select public.commit_owned_official_import_candidate_batch($1,$2,'legacy',$3::jsonb)",
      [run, source, JSON.stringify(legacy)],
    );
    await admin.query('set local session_replication_role=replica');
    await admin.query(
      'update public.official_import_runs set publication_ordinal=null where id=$1',
      [run],
    );
    await admin.query(
      `update public.official_import_candidates set review_status='rejected',reviewer=$2,
      reviewed_at=clock_timestamp() where run_id=$1`,
      [run, owner],
    );
    await admin.query('set local session_replication_role=origin');
    if (savedPending) {
      const changed = structuredClone(payload);
      changed[0]!.plan_summary.detailsChanged = true;
      const saved = await publish(admin, changed);
      assert.equal(saved.count, 1);
      await admin.query('set local session_replication_role=replica');
      await admin.query(
        'update public.official_import_candidates set plan_summary=$2::jsonb where run_id=$1',
        [saved.run, JSON.stringify(payload[0]!.plan_summary)],
      );
      await admin.query('set local session_replication_role=origin');
    }
    await admin.query('commit');
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
  async function cleanup() {
    await admin.query('begin');
    try {
      // Test-only teardown of this UUID-isolated history, not a runtime path.
      await admin.query('set local session_replication_role=replica');
      await admin.query(
        'delete from public.official_import_candidates where run_id=any($1::uuid[])',
        [runs],
      );
      await admin.query('delete from public.official_import_runs where id=any($1::uuid[])', [runs]);
      await admin.query('delete from public.event_occurrences where event_id=$1', [event]);
      await admin.query('delete from public.events where id=$1', [event]);
      await admin.query('delete from public.catalog_creators where user_id=$1', [owner]);
      await admin.query('delete from auth.users where id=$1', [owner]);
      await admin.query('commit');
    } catch (error) {
      await admin.query('rollback');
      throw error;
    }
  }
  return { event, owner, runs, publish, cleanup };
}

test('real migration repairs saved pending metadata and preserves all reviewed and uncertain history', async () => {
  const admin = await connect();
  const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
  try {
    for (let i = 0; i < 7; i++) fixtures.push(await fixture(admin, true));
    await admin.query('begin');
    // Reconstruct pre-existing states only within a rollback-scoped fixture.
    await admin.query('set local session_replication_role=replica');
    for (const [index, data] of fixtures.entries()) {
      const currentRun = data.runs[1]!;
      if (index >= 1 && index <= 3) {
        await admin.query(
          `update public.official_import_candidates set review_status='approved',
          reviewer=$2,reviewed_at=clock_timestamp() where run_id=$1`,
          [currentRun, data.owner],
        );
      }
      if (index === 2)
        await admin.query(
          `update public.official_import_candidates set apply_status='queued',
        active_apply_attempt_token='fixture',active_apply_lease_expires_at=clock_timestamp()+interval '5 minutes' where run_id=$1`,
          [currentRun],
        );
      if (index === 3)
        await admin.query(
          `update public.official_import_candidates set apply_status='applied',
        applied_at=clock_timestamp() where run_id=$1`,
          [currentRun],
        );
      if (index === 4)
        await admin.query(
          `update public.official_import_candidates set review_status='pending',
        reviewer=null,reviewed_at=null where run_id=$1`,
          [data.runs[0]],
        );
      if (index === 5)
        await admin.query(
          `update public.official_import_candidates set plan_summary=
        jsonb_set(plan_summary,'{groupsChanged}','true') where run_id=$1`,
          [currentRun],
        );
      if (index === 6)
        await admin.query(
          `update public.official_import_candidates set proposal=
        jsonb_set(proposal,'{title}','"Other rejected facts"') where run_id=$1`,
          [data.runs[0]],
        );
    }
    await admin.query('set local session_replication_role=origin');
    const runs = fixtures.flatMap((data) => data.runs);
    const events = fixtures.map((data) => data.event);
    async function snapshot() {
      return (
        await admin.query<{
          snapshot: {
            candidates: Record<string, unknown>[];
            events: unknown[];
            occurrences: unknown[];
            guard: string;
          };
        }>(
          `select jsonb_build_object(
        'candidates',(select jsonb_agg(to_jsonb(c) order by id) from public.official_import_candidates c where run_id=any($1::uuid[])),
        'events',(select jsonb_agg(to_jsonb(e) order by id) from public.events e where id=any($2::uuid[])),
        'occurrences',(select jsonb_agg(to_jsonb(o) order by id) from public.event_occurrences o where event_id=any($2::uuid[])),
        'guard',pg_get_functiondef('public.enforce_official_import_candidate_state()'::regprocedure)) snapshot`,
          [runs, events],
        )
      ).rows[0]!.snapshot;
    }
    const before = await snapshot();
    await admin.query(
      readFileSync(
        'supabase/migrations/20261016034523_829_legacy_rejected_noop_recovery.sql',
        'utf8',
      ),
    );
    const after = await snapshot();
    const repaired = after.candidates.filter(
      (candidate, index) =>
        candidate.recovery_review_required !== before.candidates[index]!.recovery_review_required,
    );
    assert.equal(repaired.length, 1);
    assert.equal(repaired[0]!.run_id, fixtures[0]!.runs[1]);
    assert.equal(repaired[0]!.recovery_review_required, false);
    const expected = structuredClone(before);
    const prior = expected.candidates.find((candidate) => candidate.id === repaired[0]!.id)!;
    prior.recovery_review_required = false;
    prior.updated_at = repaired[0]!.updated_at;
    assert.deepEqual(after, expected);
    await admin.query('rollback');
  } finally {
    await admin.query('rollback');
    try {
      for (const data of fixtures) await data.cleanup();
    } finally {
      await admin.end();
    }
    assert.deepEqual(errors.get(admin), []);
  }
});

for (const target of ['event', 'occurrence'] as const) {
  test(`legacy no-op proof waits for a concurrent ${target} edit and preserves review`, async () => {
    const clients: pg.Client[] = [];
    let data: Awaited<ReturnType<typeof fixture>> | undefined;
    let publication: Promise<{ run: string; count: number }> | undefined;
    try {
      const observer = await connect();
      clients.push(observer);
      const editor = await connect();
      clients.push(editor);
      const publisher = await connect();
      clients.push(publisher);
      data = await fixture(observer);
      const wait = await blockedBy(observer, publisher, editor);
      await editor.query('begin');
      await editor.query(
        target === 'event'
          ? "update public.events set title='Owner edit' where id=$1"
          : "update public.event_occurrences set ends_at=ends_at+interval '1 minute' where event_id=$1",
        [data.event],
      );
      await publisher.query('begin');
      publication = data.publish(publisher);
      void publication.catch(() => {});
      await wait();
      await editor.query('commit');
      const result = await publication;
      await publisher.query('commit');
      assert.equal(result.count, 1);
      const candidate = (
        await observer.query<{
          recovery_review_required: boolean;
          review_status: string;
          apply_status: string;
        }>(
          'select recovery_review_required,review_status,apply_status from public.official_import_candidates where run_id=$1',
          [result.run],
        )
      ).rows[0];
      assert.deepEqual(candidate, {
        recovery_review_required: true,
        review_status: 'pending',
        apply_status: 'not_started',
      });
    } finally {
      await Promise.allSettled(clients.map((client) => client.query('rollback')));
      if (publication) await Promise.allSettled([publication]);
      try {
        if (data) await data.cleanup();
      } finally {
        await Promise.allSettled(clients.map((client) => client.end()));
      }
      for (const client of clients) assert.deepEqual(errors.get(client), []);
    }
  });
}

test('a catalog edit waits until the no-op proof commits; a later observation requires review', async () => {
  const clients: pg.Client[] = [];
  let data: Awaited<ReturnType<typeof fixture>> | undefined;
  let edit: Promise<pg.QueryResult> | undefined;
  try {
    const observer = await connect();
    clients.push(observer);
    const editor = await connect();
    clients.push(editor);
    const publisher = await connect();
    clients.push(publisher);
    data = await fixture(observer);
    const wait = await blockedBy(observer, editor, publisher);
    await publisher.query('begin');
    assert.equal((await data.publish(publisher)).count, 0);
    await editor.query('begin');
    edit = editor.query("update public.events set title='Later owner edit' where id=$1", [
      data.event,
    ]);
    void edit.catch(() => {});
    await wait();
    await publisher.query('commit');
    await edit;
    await editor.query('commit');
    await publisher.query('begin');
    const next = await data.publish(publisher);
    await publisher.query('commit');
    assert.equal(next.count, 1);
    assert.equal(
      (
        await observer.query<{ recovery_review_required: boolean }>(
          'select recovery_review_required from public.official_import_candidates where run_id=$1',
          [next.run],
        )
      ).rows[0]?.recovery_review_required,
      true,
    );
  } finally {
    await Promise.allSettled(clients.map((client) => client.query('rollback')));
    if (edit) await Promise.allSettled([edit]);
    try {
      if (data) await data.cleanup();
    } finally {
      await Promise.allSettled(clients.map((client) => client.end()));
    }
    for (const client of clients) assert.deepEqual(errors.get(client), []);
  }
});

for (const operation of ['review', 'claim'] as const) {
  test(`reconciled no-op ${operation} waits before candidate lock while owner deletes Event`, async () => {
    const clients: pg.Client[] = [];
    let data: Awaited<ReturnType<typeof fixture>> | undefined;
    let pending: Promise<{ error: unknown }> | undefined;
    try {
      const observer = await connect();
      clients.push(observer);
      const reviewer = await connect();
      clients.push(reviewer);
      const deleter = await connect();
      clients.push(deleter);
      data = await fixture(observer, true);
      await observer.query('begin');
      await observer.query('set local session_replication_role=replica');
      await observer.query(
        'update public.official_import_candidates set recovery_review_required=false where run_id=$1',
        [data.runs[1]],
      );
      await observer.query('commit');
      const candidate = (
        await observer.query<{ id: string }>(
          'select id from public.official_import_candidates where run_id=$1',
          [data.runs[1]],
        )
      ).rows[0]!.id;
      // Claim begins from a real owner-approved candidate, without claiming or
      // applying it. Review begins from the pending post-reconciliation state.
      if (operation === 'claim') {
        await observer.query('begin');
        await observer.query('set local role authenticated');
        await observer.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: data.owner, role: 'authenticated' }),
        ]);
        await observer.query("select public.review_official_import_candidate($1,'approved')", [
          candidate,
        ]);
        await observer.query('commit');
      }
      const wait = await blockedBy(observer, reviewer, deleter);
      await reviewer.query('begin');
      await reviewer.query(
        operation === 'claim' ? 'set local role service_role' : 'set local role authenticated',
      );
      await reviewer.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: data.owner, role: 'authenticated' }),
      ]);
      await deleter.query('begin');
      // Pause deletion after its first Event lock, before the FK update.
      await deleter.query('select id from public.events where id=$1 for update', [data.event]);
      await deleter.query('set local role authenticated');
      await deleter.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: data.owner, role: 'authenticated' }),
      ]);
      pending = reviewer
        .query(
          operation === 'claim'
            ? "select public.claim_official_import_candidate_apply($1,'delete-proof',300)"
            : "select public.review_official_import_candidate($1,'approved')",
          [candidate],
        )
        .then(
          () => ({ error: null }),
          (error: unknown) => ({ error }),
        );
      await wait();
      // The waiting RPC must not own the candidate FK target yet. Owner deletion
      // can finish, after which the RPC must refuse the now-missing catalog.
      await deleter.query('select public.delete_event($1)', [data.event]);
      await deleter.query('commit');
      const outcome = await pending;
      assert.ok(outcome.error && typeof outcome.error === 'object');
      assert.equal(Reflect.get(outcome.error, 'code'), '40001');
      assert.equal(
        Reflect.get(outcome.error, 'detail'),
        'stage_tracker.kabuki_freshness_refused.v1',
      );
      await reviewer.query('rollback');
      assert.deepEqual(
        (
          await observer.query<{
            review_status: string;
            apply_status: string;
            resolved_event_id: string | null;
          }>(
            'select review_status,apply_status,resolved_event_id from public.official_import_candidates where id=$1',
            [candidate],
          )
        ).rows[0],
        {
          review_status: operation === 'claim' ? 'approved' : 'pending',
          apply_status: 'not_started',
          resolved_event_id: null,
        },
      );
    } finally {
      await Promise.allSettled(clients.map((client) => client.query('rollback')));
      if (pending) await Promise.allSettled([pending]);
      try {
        if (data) await data.cleanup();
      } finally {
        await Promise.allSettled(clients.map((client) => client.end()));
      }
      for (const client of clients) assert.deepEqual(errors.get(client), []);
    }
  });
}
