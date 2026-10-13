import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';

// Issue #780, bounded multi-session proofs: completed-parent candidate review
// and replacement, plus atomic Kabuki apply vs. owner Event deletion. This
// deliberately does not assert freshness, recovery or legacy-route closure.
const status = readLocalSupabaseStatus();
const clientErrors = new WeakMap<pg.Client, Error[]>();

interface PublisherFixture {
  runId: string;
  sourceId: string;
  token: string;
  startedAt: string;
}

interface Fixture {
  ownerId: string;
  eventId: string;
  runId: string;
  candidateId: string;
  sourceId: string;
  sourceKey: string;
  sourceUrl: string;
  officialId: string;
  token: string;
  replacementRunId?: string;
}

async function connect(): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString: status.dbUrl,
    connectionTimeoutMillis: 5000,
    query_timeout: 15_000,
  });
  const errors: Error[] = [];
  clientErrors.set(client, errors);
  // Idle disconnects emit 'error' outside the query promises. Record them
  // here and report them in teardown so they cannot crash or silently pass.
  client.on('error', (error: Error) => errors.push(error));
  try {
    await client.connect();
    await client.query("set statement_timeout = '10s'");
    await client.query("set idle_in_transaction_session_timeout = '15s'");
    return client;
  } catch (error) {
    await Promise.allSettled([client.end()]);
    throw error;
  }
}

async function connectClients(): Promise<{
  admin: pg.Client;
  owner: pg.Client;
  worker: pg.Client;
}> {
  const connected: pg.Client[] = [];
  try {
    const admin = await connect();
    connected.push(admin);
    const owner = await connect();
    connected.push(owner);
    const worker = await connect();
    connected.push(worker);
    return { admin, owner, worker };
  } catch (error) {
    await Promise.allSettled(connected.map((client) => client.end()));
    throw error;
  }
}

async function createFixture(
  admin: pg.Client,
  options: { prepareForApply?: boolean; sourceId?: string } = {},
): Promise<Fixture> {
  const identity = randomUUID().replaceAll(/[^0-9]/g, '');
  const sourceId = options.sourceId ?? 'event.kabuki-bito.schedule';
  const isKabuki = sourceId === 'event.kabuki-bito.schedule';
  const fixture: Fixture = {
    ownerId: randomUUID(),
    eventId: randomUUID(),
    runId: randomUUID(),
    candidateId: '',
    sourceId,
    sourceKey: `${isKabuki ? 'kabuki-bito:kabukiza:play' : 'secondary-feed:event'}:${identity}`,
    sourceUrl: isKabuki
      ? `https://www.kabuki-bito.jp/theaters/kabukiza/play/${identity}`
      : `https://example.test/events/${identity}`,
    officialId: identity,
    token: `apply-${randomUUID()}`,
  };
  const proposal = {
    sourceKey: fixture.sourceKey,
    sourceUrl: fixture.sourceUrl,
    title: 'Reviewed concurrency fixture',
    startsOn: '2027-01-01',
    endsOn: '2027-01-02',
    venue: 'Hall',
    memo: null,
    occurrences: [],
  };
  const payload = [
    {
      candidate_kind: 'event',
      canonical_url: fixture.sourceUrl,
      official_external_id: identity,
      observed_at: '2027-01-01T00:00:00Z',
      content_hash: 'a'.repeat(64),
      proposal_version: 'event.v1',
      proposal,
      evidence_locator: {},
      deterministic_match_status: 'matched',
      semantic_match_status: 'not_used',
      resolved_event_id: fixture.eventId,
      plan_summary: {
        version: 'event_plan.v1',
        action: 'update',
        detailsChanged: true,
        rangeChanged: false,
        newOccurrenceCount: 0,
        endsAtFixCount: 0,
        doorsAtFixCount: 0,
        keptOccurrenceCount: 0,
        genreChanged: false,
        groupsChanged: false,
      },
      plan_fingerprint: `lock-proof-${identity}`,
      review_status: 'pending',
    },
  ];
  await admin.query('begin');
  try {
    // UUID-only synthetic users require no password, token or provider setup.
    await admin.query('insert into auth.users(id) values ($1)', [fixture.ownerId]);
    await admin.query('insert into public.catalog_creators(user_id) values ($1)', [
      fixture.ownerId,
    ]);
    await admin.query(
      `insert into public.events(id,owner_id,source_key,title,starts_on,ends_on,venue,source_url)
      values ($1,$2,$3,'Before review','2027-01-01','2027-01-02','Hall',$4)`,
      [fixture.eventId, fixture.ownerId, fixture.sourceKey, fixture.sourceUrl],
    );
    await admin.query('set local role service_role');
    const claim = await admin.query<{ result: string }>(
      "select public.claim_official_import_run_attempt($1,$2,'publication',300) as result",
      [fixture.runId, fixture.sourceId],
    );
    assert.equal(claim.rows[0]?.result, 'claimed');
    await admin.query(
      "select public.commit_owned_official_import_candidate_batch($1,$2,'publication',$3::jsonb)",
      [fixture.runId, fixture.sourceId, JSON.stringify(payload)],
    );
    const candidates = await admin.query<{ id: string }>(
      'select id from public.official_import_candidates where run_id=$1',
      [fixture.runId],
    );
    assert.equal(candidates.rows.length, 1);
    const candidate = candidates.rows[0];
    assert.ok(candidate);
    fixture.candidateId = candidate.id;
    if (options.prepareForApply ?? true) {
      await admin.query('reset role');
      await admin.query('set local role authenticated');
      await admin.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: fixture.ownerId, role: 'authenticated' }),
      ]);
      await admin.query("select public.review_official_import_candidate($1,'approved')", [
        fixture.candidateId,
      ]);
      await admin.query('reset role');
      await admin.query('set local role service_role');
      const applyClaim = await admin.query<{ result: string }>(
        'select public.claim_official_import_candidate_apply($1,$2,300) as result',
        [fixture.candidateId, fixture.token],
      );
      assert.equal(applyClaim.rows[0]?.result, 'claimed');
    }
    await admin.query('commit');
    return fixture;
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
}

async function createRunningFixture(admin: pg.Client): Promise<Fixture> {
  const identity = randomUUID().replaceAll(/[^0-9]/g, '');
  const fixture: Fixture = {
    ownerId: randomUUID(),
    eventId: randomUUID(),
    runId: randomUUID(),
    candidateId: '',
    sourceId: 'event.kabuki-bito.schedule',
    sourceKey: `kabuki-bito:kabukiza:play:${identity}`,
    sourceUrl: `https://www.kabuki-bito.jp/theaters/kabukiza/play/${identity}`,
    officialId: identity,
    token: `apply-${randomUUID()}`,
  };
  await admin.query('begin');
  try {
    await admin.query('set local role service_role');
    await admin.query('insert into public.official_import_runs(id,source_id) values ($1,$2)', [
      fixture.runId,
      fixture.sourceId,
    ]);
    const inserted = await admin.query<{ id: string }>(
      `insert into public.official_import_candidates(
        run_id,source_id,candidate_kind,canonical_url,content_hash,proposal_version,proposal,plan_fingerprint
      ) values ($1,$2,'event',$3,$4,'event.v1','{}'::jsonb,$5) returning id`,
      [
        fixture.runId,
        fixture.sourceId,
        fixture.sourceUrl,
        'b'.repeat(64),
        `running-lock-${identity}`,
      ],
    );
    assert.equal(inserted.rows.length, 1);
    const candidate = inserted.rows[0];
    assert.ok(candidate);
    fixture.candidateId = candidate.id;
    await admin.query('commit');
    return fixture;
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
}

async function createPublisherFixture(
  admin: pg.Client,
  startedAt: string,
): Promise<PublisherFixture> {
  const fixture: PublisherFixture = {
    runId: randomUUID(),
    sourceId: 'event.kabuki-bito.schedule',
    token: 'publisher-' + randomUUID(),
    startedAt,
  };
  await admin.query('begin');
  try {
    await admin.query('set local role service_role');
    await admin.query(
      'insert into public.official_import_runs(id,source_id,started_at) values ($1,$2,$3)',
      [fixture.runId, fixture.sourceId, fixture.startedAt],
    );
    const claim = await admin.query<{ result: string }>(
      'select public.claim_official_import_run_attempt($1,$2,$3,300) as result',
      [fixture.runId, fixture.sourceId, fixture.token],
    );
    assert.equal(claim.rows[0]?.result, 'claimed');
    await admin.query('commit');
    return fixture;
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
}

async function shortenPublisherLease(admin: pg.Client, fixture: PublisherFixture): Promise<void> {
  await admin.query('begin');
  try {
    await admin.query('set local role service_role');
    await admin.query("select set_config('stage_tracker.official_import_attempt_run_id',$1,true)", [
      fixture.runId,
    ]);
    await admin.query("select set_config('stage_tracker.official_import_attempt_token',$1,true)", [
      fixture.token,
    ]);
    await admin.query(
      "update public.official_import_runs set active_attempt_lease_expires_at=clock_timestamp()+interval '300 milliseconds' where id=$1",
      [fixture.runId],
    );
    await admin.query("select set_config('stage_tracker.official_import_attempt_token','',true)");
    await admin.query("select set_config('stage_tracker.official_import_attempt_run_id','',true)");
    await admin.query('commit');
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
}

async function cleanupPublisherFixtures(
  admin: pg.Client,
  fixtures: PublisherFixture[],
): Promise<void> {
  await admin.query('begin');
  try {
    await admin.query('set local session_replication_role = replica');
    for (const fixture of fixtures) {
      await admin.query('delete from public.official_import_runs where id=$1', [fixture.runId]);
    }
    await admin.query('commit');
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
}

async function teardownPublisherTest(
  admin: pg.Client,
  first: pg.Client,
  second: pg.Client,
  fixtures: PublisherFixture[],
  pending: Promise<unknown> | undefined,
  failure: unknown,
): Promise<void> {
  const errors: Error[] = [];
  const rollback = async (client: pg.Client, label: string) => {
    try {
      await client.query('rollback');
    } catch (error) {
      errors.push(new Error(label + ' rollback', { cause: error }));
    }
  };
  await Promise.all([
    rollback(admin, 'admin'),
    rollback(first, 'first'),
    rollback(second, 'second'),
  ]);
  if (pending) {
    try {
      await pending;
    } catch (error) {
      errors.push(new Error('pending query settlement', { cause: error }));
    }
  }
  try {
    await cleanupPublisherFixtures(admin, fixtures);
  } catch (error) {
    errors.push(new Error('publisher fixture cleanup', { cause: error }));
  }
  await Promise.all(
    [
      ['admin', admin],
      ['first', first],
      ['second', second],
    ].map(async ([label, client]) => {
      try {
        await (client as pg.Client).end();
      } catch (error) {
        errors.push(new Error(String(label) + ' close', { cause: error }));
      }
    }),
  );
  if (errors.length > 0) {
    throw new AggregateError(
      failure === null ? errors : [failure, ...errors],
      'Kabuki publication ordinal test teardown failed',
      { cause: failure },
    );
  }
}
async function createReplacementRun(admin: pg.Client, fixture: Fixture): Promise<void> {
  fixture.replacementRunId = randomUUID();
  await admin.query('begin');
  try {
    await admin.query('set local role service_role');
    await admin.query('insert into public.official_import_runs(id,source_id) values ($1,$2)', [
      fixture.replacementRunId,
      fixture.sourceId,
    ]);
    await admin.query(
      `insert into public.official_import_candidates(
        run_id,source_id,candidate_kind,canonical_url,official_external_id,
        content_hash,proposal_version,proposal,plan_fingerprint
      ) values ($1,$2,'event',$3,$4,$5,'event.v1','{}'::jsonb,$6)`,
      [
        fixture.replacementRunId,
        fixture.sourceId,
        fixture.sourceUrl,
        fixture.officialId,
        'c'.repeat(64),
        `replacement-lock-${fixture.officialId}`,
      ],
    );
    await admin.query('commit');
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
}

async function cleanup(admin: pg.Client, fixture: Fixture): Promise<void> {
  await admin.query('begin');
  try {
    // Terminal staging rows intentionally cannot be deleted through product
    // routes. Bypass triggers only for these exact synthetic fixture IDs, in
    // this admin cleanup transaction; never truncate shared test tables.
    await admin.query('set local session_replication_role = replica');
    await admin.query('delete from public.event_occurrences where event_id=$1', [fixture.eventId]);
    await admin.query('delete from public.event_groups where event_id=$1', [fixture.eventId]);
    await admin.query('delete from public.official_import_candidates where id=$1', [
      fixture.candidateId,
    ]);
    if (fixture.replacementRunId) {
      await admin.query('delete from public.official_import_candidates where run_id=$1', [
        fixture.replacementRunId,
      ]);
      await admin.query('delete from public.official_import_runs where id=$1', [
        fixture.replacementRunId,
      ]);
    }
    await admin.query('delete from public.official_import_runs where id=$1', [fixture.runId]);
    await admin.query('delete from public.events where id=$1', [fixture.eventId]);
    await admin.query('delete from public.catalog_creators where user_id=$1', [fixture.ownerId]);
    await admin.query('delete from auth.users where id=$1', [fixture.ownerId]);
    await admin.query('commit');
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
}

async function pid(client: pg.Client): Promise<number> {
  const result = await client.query<{ pid: number }>('select pg_backend_pid() as pid');
  const row = result.rows[0];
  assert.ok(row);
  return row.pid;
}

async function waitForBlock(admin: pg.Client, blocked: number, blocker: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await admin.query<{ blocked: boolean }>(
      'select $2::integer = any(pg_blocking_pids($1)) as blocked',
      [blocked, blocker],
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('expected the second transaction to wait for the first transaction');
}

async function beginOwner(client: pg.Client, fixture: Fixture): Promise<void> {
  await client.query('begin');
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: fixture.ownerId, role: 'authenticated' }),
  ]);
}

async function apply(client: pg.Client, fixture: Fixture): Promise<string> {
  const result = await client.query<{ result: string }>(
    `select public.apply_official_import_kabuki_event_candidate(
    $1,$2,'update',$3,$4,$5,'Reviewed concurrency fixture','2027-01-01','2027-01-02',
    '[]','[]','Hall',$6,null,false,null,false,'[]',
    jsonb_build_object('event',to_jsonb(e),'occurrences','[]'::jsonb,'groups','[]'::jsonb,'genreKey',null),'[]') as result
    from public.events e where e.id=$4`,
    [
      fixture.candidateId,
      fixture.token,
      fixture.ownerId,
      fixture.eventId,
      fixture.sourceKey,
      fixture.sourceUrl,
    ],
  );
  assert.equal(result.rows.length, 1, 'the atomic RPC must actually execute');
  const row = result.rows[0];
  assert.ok(row);
  return row.result;
}

async function snapshot(
  admin: pg.Client,
  fixture: Fixture,
): Promise<{
  candidate: Record<string, unknown>;
  run: Record<string, unknown>;
  events: unknown[];
}> {
  const result = await admin.query<{
    candidate: Record<string, unknown>;
    run: Record<string, unknown>;
    events: unknown[];
  }>(
    `select
    (select to_jsonb(c) from public.official_import_candidates c where c.id=$1) as candidate,
    (select to_jsonb(r) from public.official_import_runs r where r.id=$2) as run,
    (select coalesce(jsonb_agg(to_jsonb(e)),'[]') from public.events e where e.id=$3) as events`,
    [fixture.candidateId, fixture.runId, fixture.eventId],
  );
  const row = result.rows[0];
  assert.ok(row);
  return row;
}

async function teardown(
  admin: pg.Client,
  owner: pg.Client,
  worker: pg.Client,
  fixture: Fixture | Fixture[] | undefined,
  pending: Promise<unknown> | undefined,
  failure: { error: unknown } | null,
): Promise<void> {
  const errors: Error[] = [];
  const clients = [
    ['admin', admin],
    ['owner', owner],
    ['worker', worker],
  ] as const;
  const attempt = async (label: string, action: () => Promise<unknown>): Promise<void> => {
    try {
      await action();
    } catch (error) {
      errors.push(new Error(label, { cause: error }));
    }
  };
  // Start every rollback independently: a disconnected client must not
  // prevent healthy peers from releasing their transactions and locks.
  await Promise.all(
    clients.map(([label, client]) => attempt(`${label} rollback`, () => client.query('rollback'))),
  );
  if (pending) await attempt('pending query settlement', () => pending);
  const fixtures = fixture ? (Array.isArray(fixture) ? fixture : [fixture]) : [];
  for (const item of fixtures) {
    await attempt('fixture cleanup', () => cleanup(admin, item));
  }
  await Promise.all(
    clients.map(([label, client]) => attempt(`${label} close`, () => client.end())),
  );
  for (const [label, client] of clients) {
    for (const error of clientErrors.get(client) ?? []) {
      errors.push(new Error(`${label} idle client error`, { cause: error }));
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(
      failure === null ? errors : [failure.error, ...errors],
      'Kabuki concurrency test teardown failed',
      { cause: failure?.error },
    );
  }
}

void test('completed Kabuki parent lock is not reacquired for review or supersession delete', async () => {
  const { admin, owner, worker } = await connectClients();
  let fixture: Fixture | undefined;
  let failure: { error: unknown } | null = null;
  try {
    fixture = await createFixture(admin, { prepareForApply: false });
    await createReplacementRun(admin, fixture);

    // Keep the immutable completed parent row locked while each candidate
    // trigger executes in another session. Both operations must finish first.
    await owner.query('begin');
    await owner.query('select id from public.official_import_runs where id=$1 for update', [
      fixture.runId,
    ]);
    await beginOwner(worker, fixture);
    await worker.query("set local statement_timeout = '3s'");
    const reviewed = await worker.query<{ review_status: string }>(
      "select (public.review_official_import_candidate($1,'approved')).review_status",
      [fixture.candidateId],
    );
    assert.equal(reviewed.rows[0]?.review_status, 'approved');
    await worker.query('commit');

    await worker.query('begin');
    await worker.query('set local role service_role');
    await worker.query("set local statement_timeout = '3s'");
    await worker.query(
      "select set_config('stage_tracker.official_import_superseding_run_id',$1,true)",
      [fixture.replacementRunId],
    );
    const deleted = await worker.query<{ id: string }>(
      'delete from public.official_import_candidates where id=$1 returning id',
      [fixture.candidateId],
    );
    assert.equal(deleted.rows[0]?.id, fixture.candidateId);
    await worker.query('commit');

    assert.equal((await snapshot(admin, fixture)).candidate, null);
    await owner.query('commit');
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    await teardown(admin, owner, worker, fixture, undefined, failure);
  }
});

void test('running and non-Kabuki parents retain candidate update and delete locks', async () => {
  const { admin, owner, worker } = await connectClients();
  const fixtures: Fixture[] = [];
  let pending: Promise<unknown> | undefined;
  let failure: { error: unknown } | null = null;
  try {
    const running = await createRunningFixture(admin);
    fixtures.push(running);
    const otherSource = await createFixture(admin, {
      prepareForApply: false,
      sourceId: 'event.secondary-feed',
    });
    fixtures.push(otherSource);
    await createReplacementRun(admin, otherSource);

    for (const fixture of fixtures) {
      await owner.query('begin');
      await owner.query('select id from public.official_import_runs where id=$1 for update', [
        fixture.runId,
      ]);
      await worker.query('begin');
      await worker.query('set local role service_role');
      const workerPid = await pid(worker);
      const ownerPid = await pid(owner);
      const update = worker
        .query('update public.official_import_candidates set proposal=proposal where id=$1', [
          fixture.candidateId,
        ])
        .then(
          (result) => ({ result, error: null }),
          (error: unknown) => ({ result: null, error }),
        );
      pending = update;
      await waitForBlock(admin, workerPid, ownerPid);
      await owner.query('commit');
      const updateResult = await update;
      assert.equal(updateResult.error, null);
      assert.equal(updateResult.result?.rowCount, 1);
      await worker.query('commit');
      pending = undefined;

      await owner.query('begin');
      await owner.query('select id from public.official_import_runs where id=$1 for update', [
        fixture.runId,
      ]);
      await worker.query('begin');
      await worker.query('set local role service_role');
      if (fixture.replacementRunId) {
        await worker.query(
          "select set_config('stage_tracker.official_import_superseding_run_id',$1,true)",
          [fixture.replacementRunId],
        );
      }
      const workerDeletePid = await pid(worker);
      const ownerDeletePid = await pid(owner);
      const remove = worker
        .query('delete from public.official_import_candidates where id=$1 returning id', [
          fixture.candidateId,
        ])
        .then(
          (result) => ({ result, error: null }),
          (error: unknown) => ({ result: null, error }),
        );
      pending = remove;
      await waitForBlock(admin, workerDeletePid, ownerDeletePid);
      await owner.query('commit');
      const removeResult = await remove;
      assert.equal(removeResult.error, null);
      assert.equal(removeResult.result?.rows[0]?.id, fixture.candidateId);
      await worker.query('commit');
      pending = undefined;
    }
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    await teardown(admin, owner, worker, fixtures, pending, failure);
  }
});

void test('Kabuki atomic apply waits before candidate lock when owner Event deletion wins', async () => {
  const { admin, owner, worker } = await connectClients();
  let fixture: Fixture | undefined;
  let pending: Promise<unknown> | undefined;
  let failure: { error: unknown } | null = null;
  try {
    fixture = await createFixture(admin);
    const before = await snapshot(admin, fixture);
    await beginOwner(owner, fixture);
    await owner.query('select id from public.events where id=$1 for update', [fixture.eventId]);
    await worker.query('begin');
    await worker.query('set local role service_role');
    const workerPid = await pid(worker);
    const ownerPid = await pid(owner);
    // Attach both handlers immediately: an early SQL failure must not become
    // an unhandled rejection while the observer checks the blocking edge.
    const outcome = apply(worker, fixture).then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error }),
    );
    pending = outcome;
    await waitForBlock(admin, workerPid, ownerPid);
    assert.deepEqual(await snapshot(admin, fixture), before);
    await admin.query('begin');
    await admin.query(
      'select id from public.official_import_candidates where id=$1 for update nowait',
      [fixture.candidateId],
    );
    await admin.query('rollback');
    await owner.query('select public.delete_event($1)', [fixture.eventId]);
    await owner.query('commit');
    const result = await outcome;
    assert.equal(result.value, null);
    assert.ok(result.error instanceof pg.DatabaseError);
    assert.equal((result.error as pg.DatabaseError).code, '40001');
    assert.equal((result.error as pg.DatabaseError).message, 'reviewed Event no longer exists');
    await worker.query('rollback');
    const after = await snapshot(admin, fixture);
    assert.equal(typeof after.candidate.updated_at, 'string');
    assert.deepEqual(after, {
      ...before,
      events: [],
      // The owner's FK update legitimately touches updated_at as well.
      candidate: {
        ...before.candidate,
        resolved_event_id: null,
        updated_at: after.candidate.updated_at,
      },
    });
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    await teardown(admin, owner, worker, fixture, pending, failure);
  }
});

void test('owner Event deletion waits for Kabuki atomic commit and preserves applied replay', async () => {
  const { admin, owner, worker } = await connectClients();
  let fixture: Fixture | undefined;
  let pending: Promise<unknown> | undefined;
  let failure: { error: unknown } | null = null;
  try {
    fixture = await createFixture(admin);
    await worker.query('begin');
    await worker.query('set local role service_role');
    assert.equal(await apply(worker, fixture), 'applied');
    const applied = await snapshot(worker, fixture);
    assert.equal(applied.candidate.apply_status, 'applied');
    assert.ok(applied.candidate.applied_at);
    assert.equal(applied.candidate.active_apply_attempt_token, null);
    await beginOwner(owner, fixture);
    const ownerPid = await pid(owner);
    const workerPid = await pid(worker);
    const outcome = owner.query('select public.delete_event($1)', [fixture.eventId]).then(
      () => ({ error: null }),
      (error: unknown) => ({ error }),
    );
    pending = outcome;
    await waitForBlock(admin, ownerPid, workerPid);
    await worker.query('commit');
    assert.equal((await outcome).error, null, '40P01 is a failure, not an accepted race result');
    await owner.query('commit');
    const beforeReplay = await snapshot(admin, fixture);
    assert.equal(typeof beforeReplay.candidate.updated_at, 'string');
    assert.deepEqual(beforeReplay, {
      ...applied,
      events: [],
      candidate: {
        ...applied.candidate,
        resolved_event_id: null,
        updated_at: beforeReplay.candidate.updated_at,
      },
    });
    // Deliberately stale target/arguments simulate a lost response after the
    // committed apply, followed by owner deletion. Applied history wins.
    await worker.query('begin');
    await worker.query('set local role service_role');
    const replay = await worker.query<{ result: string }>(
      `select public.apply_official_import_kabuki_event_candidate(
      $1,'lost-response','update',$2,$3,$4,'stale','2027-01-01','2027-01-02',
      '[]','[]','Hall',$5,null,false,null,false,'[]',null,'[]') as result`,
      [fixture.candidateId, fixture.ownerId, fixture.eventId, fixture.sourceKey, fixture.sourceUrl],
    );
    assert.equal(replay.rows[0]?.result, 'applied');
    await worker.query('commit');
    assert.deepEqual(await snapshot(admin, fixture), beforeReplay);
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    await teardown(admin, owner, worker, fixture, pending, failure);
  }
});
void test('owned Kabuki publications serialize and ignore equal or reversed start timestamps', async () => {
  const { admin, owner, worker } = await connectClients();
  const fixtures: PublisherFixture[] = [];
  let pending: Promise<unknown> | undefined;
  let failure: unknown = null;
  try {
    const first = await createPublisherFixture(admin, '2030-01-01T00:00:00Z');
    fixtures.push(first);
    const second = await createPublisherFixture(admin, '2020-01-01T00:00:00Z');
    fixtures.push(second);

    await owner.query('begin');
    await owner.query('set local role service_role');
    const firstPublish = await owner.query<{ count: number }>(
      'select public.commit_owned_official_import_candidate_batch($1,$2,$3,$4::jsonb) as count',
      [first.runId, first.sourceId, first.token, '[]'],
    );
    assert.equal(firstPublish.rows[0]?.count, 0);

    await worker.query('begin');
    await worker.query('set local role service_role');
    const ownerPid = await pid(owner);
    const workerPid = await pid(worker);
    const blocked = worker
      .query<{ count: number }>(
        'select public.commit_owned_official_import_candidate_batch($1,$2,$3,$4::jsonb) as count',
        [second.runId, second.sourceId, second.token, '[]'],
      )
      .then(
        (result) => ({ result, error: null }),
        (error: unknown) => ({ result: null, error }),
      );
    pending = blocked;
    await waitForBlock(admin, workerPid, ownerPid);
    const whileWaiting = await admin.query<{ status: string; publication_ordinal: string | null }>(
      'select status,publication_ordinal from public.official_import_runs where id=$1',
      [second.runId],
    );
    assert.equal(whileWaiting.rows[0]?.status, 'running');
    assert.equal(whileWaiting.rows[0]?.publication_ordinal, null);

    await owner.query('commit');
    const secondResult = await blocked;
    assert.equal(secondResult.error, null);
    assert.equal(secondResult.result?.rows[0]?.count, 0);
    await worker.query('commit');
    pending = undefined;

    const committed = await admin.query<{
      first_ordinal: string;
      second_ordinal: string;
      first_started_at: Date;
      second_started_at: Date;
    }>(
      'select first.publication_ordinal as first_ordinal, ' +
        'second.publication_ordinal as second_ordinal, ' +
        'first.started_at as first_started_at, second.started_at as second_started_at ' +
        'from public.official_import_runs first ' +
        'join public.official_import_runs second on second.id=$2 where first.id=$1',
      [first.runId, second.runId],
    );
    const row = committed.rows[0];
    assert.ok(row);
    assert.ok(row.first_started_at > row.second_started_at);
    assert.ok(BigInt(row.first_ordinal) < BigInt(row.second_ordinal));
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await teardownPublisherTest(admin, owner, worker, fixtures, pending, failure);
  }
});

void test('an owned publisher whose lease expires while waiting for the source lock allocates nothing', async () => {
  const { admin, owner, worker } = await connectClients();
  const fixtures: PublisherFixture[] = [];
  let pending: Promise<unknown> | undefined;
  let failure: unknown = null;
  try {
    const fixture = await createPublisherFixture(admin, '2027-01-01T00:00:00Z');
    fixtures.push(fixture);
    await shortenPublisherLease(admin, fixture);

    await owner.query('begin');
    await owner.query('set local role service_role');
    await owner.query(
      "select pg_advisory_xact_lock(pg_catalog.hashtextextended('official-import-candidates:' || $1,0))",
      [fixture.sourceId],
    );
    const sequenceBefore = await admin.query<{ state: string }>(
      "select last_value::text || ':' || is_called::text as state from public.official_import_kabuki_publication_ordinal_seq",
    );
    const before = sequenceBefore.rows[0]?.state;
    assert.ok(before);

    await worker.query('begin');
    await worker.query('set local role service_role');
    const ownerPid = await pid(owner);
    const workerPid = await pid(worker);
    const outcome = worker
      .query('select public.commit_owned_official_import_candidate_batch($1,$2,$3,$4::jsonb)', [
        fixture.runId,
        fixture.sourceId,
        fixture.token,
        '[]',
      ])
      .then(
        (result) => ({ result, error: null }),
        (error: unknown) => ({ result: null, error }),
      );
    pending = outcome;
    await waitForBlock(admin, workerPid, ownerPid);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await owner.query('commit');

    const result = await outcome;
    assert.equal(result.result, null);
    assert.ok(result.error instanceof pg.DatabaseError);
    assert.equal((result.error as pg.DatabaseError).code, '55000');
    await worker.query('rollback');
    pending = undefined;

    const after = await admin.query<{ status: string; publication_ordinal: string | null }>(
      'select status,publication_ordinal from public.official_import_runs where id=$1',
      [fixture.runId],
    );
    assert.equal(after.rows[0]?.status, 'running');
    assert.equal(after.rows[0]?.publication_ordinal, null);
    const sequenceAfter = await admin.query<{ state: string }>(
      "select last_value::text || ':' || is_called::text as state from public.official_import_kabuki_publication_ordinal_seq",
    );
    assert.equal(sequenceAfter.rows[0]?.state, before);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await teardownPublisherTest(admin, owner, worker, fixtures, pending, failure);
  }
});
