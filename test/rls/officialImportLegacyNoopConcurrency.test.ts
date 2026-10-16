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
      await reserveSource(admin);
      await admin.query('lock table public.events,public.event_occurrences in row exclusive mode');
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
  return { event, owner, runs, payload, publish, cleanup };
}

type LegacyFixture = Awaited<ReturnType<typeof fixture>>;

async function snapshot(client: pg.Client, data: LegacyFixture) {
  return (
    await client.query<{ value: unknown }>(
      `select jsonb_build_object(
    'event',(select to_jsonb(e) from public.events e where id=$1),
    'occurrences',(select coalesce(jsonb_agg(to_jsonb(o) order by id),'[]') from public.event_occurrences o where event_id=$1),
    'candidates',(select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from public.official_import_candidates c where run_id=any($2::uuid[])),
    'runs',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from public.official_import_runs r where id=any($2::uuid[]))) value`,
      [data.event, data.runs],
    )
  ).rows[0]!.value;
}

async function prepareCandidate(admin: pg.Client, data: LegacyFixture, approved = false) {
  await admin.query('begin');
  try {
    await admin.query(
      "select pg_advisory_xact_lock(hashtextextended('official-import-candidates:'||$1,0))",
      [source],
    );
    await admin.query('set local session_replication_role=replica');
    await admin.query(
      'update public.official_import_candidates set recovery_review_required=false where run_id=$1',
      [data.runs[1]],
    );
    await admin.query('set local session_replication_role=origin');
    const id = (
      await admin.query<{ id: string }>(
        'select id from public.official_import_candidates where run_id=$1',
        [data.runs[1]],
      )
    ).rows[0]!.id;
    if (approved) {
      await admin.query('set local role authenticated');
      await admin.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: data.owner, role: 'authenticated' }),
      ]);
      await admin.query("select public.review_official_import_candidate($1,'approved')", [id]);
    }
    await admin.query('commit');
    return id;
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
}

async function asActor(client: pg.Client, owner: string, service = false) {
  await client.query(service ? 'set local role service_role' : 'set local role authenticated');
  await client.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: owner, role: service ? 'service_role' : 'authenticated' }),
  ]);
}

async function reserveSource(client: pg.Client) {
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended('official-import-candidates:'||$1,0))",
    [source],
  );
}

async function closeFixture(
  clients: pg.Client[],
  data?: LegacyFixture,
  pending?: Promise<unknown>,
) {
  await Promise.allSettled(clients.map((client) => client.query('rollback')));
  if (pending) await Promise.allSettled([pending]);
  try {
    if (data) await data.cleanup();
  } finally {
    await Promise.allSettled(clients.map((client) => client.end()));
  }
  for (const client of clients) assert.deepEqual(errors.get(client), []);
}

type Operation = 'publish' | 'insert' | 'review' | 'claim';

// The direct insert case reaches the owned guard without the batch's earlier
// boundary. All authority is local, synthetic and rollback-scoped.
async function operation(
  client: pg.Client,
  data: LegacyFixture,
  kind: Operation,
  candidate: string,
) {
  if (kind === 'publish') return data.publish(client);
  if (kind === 'insert') {
    const run = randomUUID();
    data.runs.push(run);
    await claim(client, run, 'fixture');
    await client.query(
      "select set_config('stage_tracker.official_import_attempt_run_id',$1,true),set_config('stage_tracker.official_import_attempt_token','fixture',true),set_config('stage_tracker.official_import_publication_ordinal',nextval('public.official_import_kabuki_publication_ordinal_seq')::text,true)",
      [run],
    );
    const result = await client.query(
      `insert into public.official_import_candidates
      (run_id,source_id,candidate_kind,canonical_url,official_external_id,observed_at,
      content_hash,proposal_version,proposal,evidence_locator,deterministic_match_status,
      semantic_match_status,resolved_event_id,plan_summary,plan_fingerprint)
      select $1,$2,candidate_kind,canonical_url,official_external_id,observed_at,
      content_hash,proposal_version,proposal,evidence_locator,deterministic_match_status,
      semantic_match_status,resolved_event_id,plan_summary,plan_fingerprint
      from jsonb_to_recordset($3::jsonb) as incoming(candidate_kind text,canonical_url text,
      official_external_id text,observed_at timestamptz,content_hash text,proposal_version text,
      proposal jsonb,evidence_locator jsonb,deterministic_match_status text,
      semantic_match_status text,resolved_event_id uuid,plan_summary jsonb,plan_fingerprint text)
      returning recovery_review_required`,
      [run, source, JSON.stringify(data.payload)],
    );
    // Finish the synthetic owned run through the real wrapper, releasing the
    // source lease before the test's later independent observation.
    await client.query(
      "select public.commit_owned_official_import_candidate_batch($1,$2,'fixture',$3::jsonb)",
      [run, source, JSON.stringify(data.payload)],
    );
    return result;
  }
  return client.query(
    kind === 'review'
      ? "select public.review_official_import_candidate($1,'approved')"
      : "select public.claim_official_import_candidate_apply($1,'boundary-proof',300)",
    [candidate],
  );
}

async function insertOccurrence(client: pg.Client, event: string) {
  return client.query(
    `insert into public.event_occurrences(event_id,starts_at,ends_at)
    values($1,'2027-01-02T12:00:00+09:00','2027-01-02T15:00:00+09:00')`,
    [event],
  );
}

for (const kind of ['publish', 'insert', 'review', 'claim'] as const) {
  test(`${kind} observes a phantom occurrence committed before its catalog boundary`, async () => {
    const clients: pg.Client[] = [];
    let data: LegacyFixture | undefined;
    let pending: Promise<unknown> | undefined;
    try {
      const observer = await connect();
      clients.push(observer);
      const worker = await connect();
      clients.push(worker);
      const editor = await connect();
      clients.push(editor);
      data = await fixture(observer, true);
      const candidate = await prepareCandidate(observer, data, kind === 'claim');
      const before = (
        await observer.query(
          'select to_jsonb(c) value from public.official_import_candidates c where id=$1',
          [candidate],
        )
      ).rows[0].value;
      const wait = await blockedBy(observer, worker, editor);
      await worker.query('begin');
      await reserveSource(worker);
      await asActor(worker, data.owner, kind !== 'review');
      await editor.query('begin');
      await asActor(editor, data.owner);
      await insertOccurrence(editor, data.event);
      pending = operation(worker, data, kind, candidate).then(
        (value) => ({ value, error: null }),
        (error) => ({ value: null, error }),
      );
      await wait();
      await editor.query('commit');
      const result = (await pending) as { value: unknown; error: unknown };
      if (kind === 'review' || kind === 'claim') {
        assert.ok(result.error && typeof result.error === 'object');
        assert.equal(Reflect.get(result.error, 'code'), '40001');
        assert.equal(
          Reflect.get(result.error, 'detail'),
          'stage_tracker.kabuki_freshness_refused.v1',
        );
        await worker.query('rollback');
        assert.deepEqual(
          (
            await observer.query(
              'select to_jsonb(c) value from public.official_import_candidates c where id=$1',
              [candidate],
            )
          ).rows[0].value,
          before,
        );
      } else {
        assert.equal(result.error, null);
        if (kind === 'publish') assert.equal((result.value as { count: number }).count, 1);
        await worker.query('commit');
        const latest = data.runs.at(-1)!;
        assert.equal(
          (
            await observer.query(
              'select recovery_review_required from public.official_import_candidates where run_id=$1',
              [latest],
            )
          ).rows[0].recovery_review_required,
          true,
        );
      }
    } finally {
      await closeFixture(clients, data, pending);
    }
  });

  test(`${kind} keeps phantom occurrence INSERT behind its transaction boundary`, async () => {
    const clients: pg.Client[] = [];
    let data: LegacyFixture | undefined;
    let pending: Promise<unknown> | undefined;
    try {
      const observer = await connect();
      clients.push(observer);
      const worker = await connect();
      clients.push(worker);
      const editor = await connect();
      clients.push(editor);
      data = await fixture(observer, true);
      const candidate = await prepareCandidate(observer, data, kind === 'claim');
      const wait = await blockedBy(observer, editor, worker);
      await worker.query('begin');
      await reserveSource(worker);
      await asActor(worker, data.owner, kind !== 'review');
      const result = await operation(worker, data, kind, candidate);
      if (kind === 'publish') assert.equal((result as { count: number }).count, 0);
      await editor.query('begin');
      await asActor(editor, data.owner);
      pending = insertOccurrence(editor, data.event);
      void pending.catch(() => {});
      await wait();
      await worker.query('commit');
      await pending;
      await editor.query('commit');
      if (kind === 'review' || kind === 'claim') {
        assert.equal(
          (
            await observer.query(
              'select private.official_import_kabuki_candidate_fresh_internal($1) result',
              [candidate],
            )
          ).rows[0].result,
          false,
        );
      } else {
        // The next observation must not reuse a cached false marker.
        await worker.query('begin');
        const next = await data.publish(worker);
        await worker.query('commit');
        assert.equal(next.count, 1);
        assert.equal(
          (
            await observer.query(
              'select recovery_review_required from public.official_import_candidates where run_id=$1',
              [next.run],
            )
          ).rows[0].recovery_review_required,
          true,
        );
      }
    } finally {
      await closeFixture(clients, data, pending);
    }
  });
}

test('a cached false marker is derived only after an in-flight occurrence edit commits', async () => {
  const clients: pg.Client[] = [];
  let data: LegacyFixture | undefined;
  let pending: Promise<unknown> | undefined;
  try {
    const observer = await connect();
    clients.push(observer);
    const worker = await connect();
    clients.push(worker);
    const editor = await connect();
    clients.push(editor);
    data = await fixture(observer, true);
    await prepareCandidate(observer, data);
    const wait = await blockedBy(observer, worker, editor);
    await worker.query('begin');
    await reserveSource(worker);
    await editor.query('begin');
    await asActor(editor, data.owner);
    await editor.query(
      "update public.event_occurrences set ends_at=ends_at+interval '1 minute' where event_id=$1",
      [data.event],
    );
    pending = data.publish(worker);
    void pending.catch(() => {});
    await wait();
    await editor.query('commit');
    const result = (await pending) as { run: string; count: number };
    await worker.query('commit');
    assert.equal(result.count, 1);
    assert.equal(
      (
        await observer.query(
          'select recovery_review_required from public.official_import_candidates where run_id=$1',
          [result.run],
        )
      ).rows[0].recovery_review_required,
      true,
    );
  } finally {
    await closeFixture(clients, data, pending);
  }
});

for (const kind of ['publish', 'insert', 'review', 'claim'] as const) {
  for (const table of ['events', 'event_occurrences'] as const) {
    test(`${kind} timeout at ${table} restores GUC, locks and full staging snapshot`, async () => {
      const clients: pg.Client[] = [];
      let data: LegacyFixture | undefined;
      try {
        const observer = await connect();
        clients.push(observer);
        const worker = await connect();
        clients.push(worker);
        const holder = await connect();
        clients.push(holder);
        data = await fixture(observer, true);
        const candidate = await prepareCandidate(observer, data, kind === 'claim');
        await worker.query('begin');
        await reserveSource(worker);
        await asActor(worker, data.owner, kind !== 'review');
        // An unrelated row-independent writer proves this is a table boundary,
        // not merely a lock on the fixture's already observed rows.
        await holder.query('begin');
        await holder.query(`lock table public.${table} in row exclusive mode`);
        const timeout = kind === 'publish' && table === 'events' ? '0' : '250ms';
        await worker.query("select set_config('lock_timeout',$1,true)", [timeout]);
        const before = await snapshot(observer, data);
        await worker.query('savepoint boundary_attempt');
        const started = Date.now();
        await assert.rejects(operation(worker, data, kind, candidate), (error: unknown) => {
          assert.ok(error && typeof error === 'object');
          assert.equal(Reflect.get(error, 'code'), '55P03');
          assert.notEqual(
            Reflect.get(error, 'detail'),
            'stage_tracker.kabuki_freshness_refused.v1',
          );
          return true;
        });
        const elapsed = Date.now() - started;
        assert.ok(elapsed < (timeout === '0' ? 5000 : 1800), `bounded wait: ${elapsed}ms`);
        if (timeout === '0') assert.ok(elapsed >= 1500, `default cap: ${elapsed}ms`);
        await worker.query('rollback to savepoint boundary_attempt');
        assert.equal((await worker.query('show lock_timeout')).rows[0].lock_timeout, timeout);
        assert.deepEqual(await snapshot(observer, data), before);
        await observer.query('begin');
        // A failed second lock must also release the first table SHARE lock.
        await observer.query(
          'lock table public.events,public.event_occurrences in row exclusive mode nowait',
        );
        await observer.query('rollback');
        await worker.query('rollback');
        await holder.query('rollback');
      } finally {
        await closeFixture(clients, data);
      }
    });
  }
}

test('successful approval/claim restore a longer caller timeout; applied replay remains inert under catalog writers', async () => {
  const clients: pg.Client[] = [];
  let data: LegacyFixture | undefined;
  try {
    const observer = await connect();
    clients.push(observer);
    const worker = await connect();
    clients.push(worker);
    const holder = await connect();
    clients.push(holder);
    data = await fixture(observer, true);
    const candidate = await prepareCandidate(observer, data);
    const helpers = readFileSync(
      'supabase/tests/helpers/kabuki-compat-expand.psql',
      'utf8',
    ).replaceAll('\r\n', '\n');
    for (const name of ['kb_snapshot', 'kb_apply_sql', 'kb_apply']) {
      const from = helpers.indexOf(`create function pg_temp.${name}(`);
      assert.ok(from >= 0);
      const to = helpers.indexOf('\n$$;', from) + 4;
      await observer.query(helpers.slice(from, to));
    }
    await observer.query('begin');
    await reserveSource(observer);
    await observer.query("set local lock_timeout='7s'");
    await asActor(observer, data.owner);
    await operation(observer, data, 'review', candidate);
    assert.equal((await observer.query('show lock_timeout')).rows[0].lock_timeout, '7s');
    await asActor(observer, data.owner, true);
    await operation(observer, data, 'claim', candidate);
    assert.equal((await observer.query('show lock_timeout')).rows[0].lock_timeout, '7s');
    assert.equal(
      (
        await observer.query("select pg_temp.kb_apply($1,'boundary-proof',$2) result", [
          candidate,
          data.owner,
        ])
      ).rows[0].result,
      'applied',
    );
    await observer.query('commit');
    const before = await snapshot(observer, data);
    await worker.query('begin');
    await reserveSource(worker);
    await asActor(worker, data.owner, true);
    await holder.query('begin');
    await holder.query("update public.events set title='Uncommitted later edit' where id=$1", [
      data.event,
    ]);
    await insertOccurrence(holder, data.event);
    await worker.query("set local statement_timeout='1s'");
    assert.equal(
      (
        await worker.query(
          "select public.claim_official_import_candidate_apply($1,'ignored-replay-token',300) result",
          [candidate],
        )
      ).rows[0].result,
      'applied',
    );
    await worker.query('commit');
    await holder.query('rollback');
    assert.deepEqual(await snapshot(observer, data), before);
  } finally {
    await closeFixture(clients, data);
  }
});

for (const kind of ['publish', 'insert'] as const) {
  test(`${kind} restores the caller's longer timeout after successful no-op suppression`, async () => {
    const clients: pg.Client[] = [];
    let data: LegacyFixture | undefined;
    try {
      const worker = await connect();
      clients.push(worker);
      data = await fixture(worker);
      await worker.query('begin');
      await reserveSource(worker);
      await worker.query("set local lock_timeout='7s'");
      await operation(worker, data, kind, '');
      assert.equal((await worker.query('show lock_timeout')).rows[0].lock_timeout, '7s');
      await worker.query('rollback');
    } finally {
      await closeFixture(clients, data);
    }
  });
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

for (const target of ['event', 'occurrence', 'occurrence-start'] as const) {
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
      await publisher.query('begin');
      await reserveSource(publisher);
      await editor.query('begin');
      await editor.query(
        target === 'event'
          ? "update public.events set title='Owner edit' where id=$1"
          : target === 'occurrence-start'
            ? "update public.event_occurrences set starts_at=starts_at+interval '1 minute' where event_id=$1"
            : "update public.event_occurrences set ends_at=ends_at+interval '1 minute' where event_id=$1",
        [data.event],
      );
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
      await reserveSource(reviewer);
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

for (const operation of ['review', 'claim'] as const) {
  test(`reconciled no-op ${operation} is compatible with starts_at containment checks`, async () => {
    const clients: pg.Client[] = [];
    let data: Awaited<ReturnType<typeof fixture>> | undefined;
    let pending: Promise<{ error: unknown }> | undefined;
    try {
      const observer = await connect();
      clients.push(observer);
      const worker = await connect();
      clients.push(worker);
      const editor = await connect();
      clients.push(editor);
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
      const wait = await blockedBy(observer, worker, editor);
      await worker.query('begin');
      await reserveSource(worker);
      await editor.query('begin');
      // Pause a normal UPDATE after its child row lock but before containment.
      await editor.query('select id from public.event_occurrences where event_id=$1 for update', [
        data.event,
      ]);
      await editor.query('set local role authenticated');
      await editor.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: data.owner, role: 'authenticated' }),
      ]);
      await worker.query(
        operation === 'claim' ? 'set local role service_role' : 'set local role authenticated',
      );
      await worker.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: data.owner, role: 'authenticated' }),
      ]);
      pending = worker
        .query(
          operation === 'claim'
            ? "select public.claim_official_import_candidate_apply($1,'containment-proof',300)"
            : "select public.review_official_import_candidate($1,'approved')",
          [candidate],
        )
        .then(
          () => ({ error: null }),
          (error: unknown) => ({ error }),
        );
      await wait();
      await editor.query(
        "update public.event_occurrences set starts_at=starts_at+interval '1 minute' where event_id=$1",
        [data.event],
      );
      await editor.query('commit');
      const outcome = await pending;
      assert.ok(outcome.error && typeof outcome.error === 'object');
      assert.equal(Reflect.get(outcome.error, 'code'), '40001');
      assert.equal(
        Reflect.get(outcome.error, 'detail'),
        'stage_tracker.kabuki_freshness_refused.v1',
      );
      await worker.query('rollback');
      assert.deepEqual(
        (
          await observer.query<{ review_status: string; apply_status: string }>(
            'select review_status,apply_status from public.official_import_candidates where id=$1',
            [candidate],
          )
        ).rows[0],
        {
          review_status: operation === 'claim' ? 'approved' : 'pending',
          apply_status: 'not_started',
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

test('freshness proof does not add child locks under an atomic-style exclusive parent lock', async () => {
  const clients: pg.Client[] = [];
  let data: Awaited<ReturnType<typeof fixture>> | undefined;
  let edit: Promise<pg.QueryResult> | undefined;
  try {
    const observer = await connect();
    clients.push(observer);
    const worker = await connect();
    clients.push(worker);
    const editor = await connect();
    clients.push(editor);
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
    await observer.query('begin');
    await observer.query('set local role authenticated');
    await observer.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: data.owner, role: 'authenticated' }),
    ]);
    await observer.query("select public.review_official_import_candidate($1,'approved')", [
      candidate,
    ]);
    await observer.query('commit');
    await observer.query('begin');
    await observer.query('set local role service_role');
    assert.equal(
      (
        await observer.query<{ result: string }>(
          "select public.claim_official_import_candidate_apply($1,'atomic-child-proof',300) result",
          [candidate],
        )
      ).rows[0]!.result,
      'claimed',
    );
    await observer.query('commit');
    const wait = await blockedBy(observer, editor, worker);
    await editor.query('begin');
    await editor.query('select id from public.event_occurrences where event_id=$1 for update', [
      data.event,
    ]);
    await editor.query('set local role authenticated');
    await editor.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: data.owner, role: 'authenticated' }),
    ]);
    await worker.query('begin');
    await worker.query('set local role service_role');
    await worker.query(
      "select pg_advisory_xact_lock(hashtextextended('official-import-candidates:'||$1,0))",
      [source],
    );
    await worker.query('select id from public.events where id=$1 for update', [data.event]);
    await worker.query('select id from public.official_import_candidates where id=$1 for update', [
      candidate,
    ]);
    await worker.query("set local statement_timeout='5s'");
    const result = await worker.query<{ result: boolean }>(
      'select private.official_import_kabuki_candidate_fresh_internal($1) result',
      [candidate],
    );
    assert.equal(result.rows[0]!.result, true);
    edit = editor.query(
      "update public.event_occurrences set starts_at=starts_at+interval '1 minute' where event_id=$1",
      [data.event],
    );
    void edit.catch(() => {});
    await wait();
    await worker.query('commit');
    await edit;
    await editor.query('commit');
    assert.equal(
      (
        await observer.query<{ apply_status: string }>(
          'select apply_status from public.official_import_candidates where id=$1',
          [candidate],
        )
      ).rows[0]!.apply_status,
      'queued',
    );
    assert.equal(
      (
        await observer.query<{ result: boolean }>(
          'select private.official_import_kabuki_candidate_fresh_internal($1) result',
          [candidate],
        )
      ).rows[0]!.result,
      false,
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
