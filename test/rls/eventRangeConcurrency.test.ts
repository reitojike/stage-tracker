import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { createTestActor, deleteTestActor, type TestActor } from './support/testActors.ts';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';

// DB-level concurrency proof for the Issue #88 containment invariant
// (20260825000200_add_event_range_containment_triggers.sql). A constraint
// trigger existing is not, by itself, proof the invariant holds under
// concurrent writes: two transactions under READ COMMITTED can each
// validate against the other's not-yet-committed state and both commit,
// leaving a committed, invariant-violating result (write skew). This is
// what the `for share` row lock on check_occurrence_within_event_range's
// events read exists to close - see that migration's own comment - and
// what this file proves empirically rather than by code inspection alone.
//
// Uses two independent raw pg.Client connections (not the typed,
// RLS-governed actor.client) so each side of the race can be controlled
// explicitly: begin a transaction, run one statement, and hold it open
// while the other connection's conflicting statement is issued, proving
// the second one actually blocks on the first (via pg_stat_activity)
// rather than racing ahead on stale data. Both orderings are exercised for
// both conflict shapes (a brand-new occurrence vs. an existing one's
// starts_at), since the locking has to hold regardless of which side
// reaches the row first.
//
// The only acceptable outcomes here are "one side blocks, then sees the
// other's committed result and is correctly rejected" or "one side is
// aborted by the deadlock detector" - never both sides committing into a
// state where an occurrence's Tokyo date falls outside its event's range.

const status = readLocalSupabaseStatus();

async function newClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: status.dbUrl });
  await client.connect();
  return client;
}

async function backendPid(client: pg.Client): Promise<number> {
  const { rows } = await client.query<{ pid: number }>('select pg_backend_pid() as pid');
  const pid = rows[0]?.pid;
  if (pid === undefined) {
    throw new Error('failed to read backend pid');
  }
  return pid;
}

/**
 * Polls pg_stat_activity until the given backend is observed waiting on a
 * lock, proving a statement on that connection is genuinely blocked - not
 * just slow - before the test proceeds to release it. Fails (rather than
 * hanging forever) if no block is ever observed, since that would mean
 * this test isn't actually exercising the serialization it exists to
 * prove.
 */
async function waitUntilBlocked(admin: pg.Client, pid: number): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const { rows } = await admin.query<{ wait_event_type: string | null }>(
      'select wait_event_type from pg_stat_activity where pid = $1',
      [pid],
    );
    if (rows[0]?.wait_event_type === 'Lock') {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for backend ${String(pid)} to block on a lock`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

let owner: TestActor;

before(async () => {
  owner = await createTestActor('range-concurrency-owner', 'Str0ng-Test-Passw0rd!');
});

after(async () => {
  await deleteTestActor(owner);
});

async function createFixtureEvent(
  admin: pg.Client,
  startsOn: string,
  endsOn: string,
): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into public.events (owner_id, title, starts_on, ends_on)
     values ($1, $2, $3, $4)
     returning id`,
    [
      owner.user.id,
      `concurrency fixture ${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
      startsOn,
      endsOn,
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error('fixture event insert returned no id');
  }
  return id;
}

interface RangeUpdateOutcome {
  committed: boolean;
}

async function attemptRangeUpdate(
  client: pg.Client,
  eventId: string,
  startsOn: string,
  endsOn: string,
): Promise<RangeUpdateOutcome> {
  await client.query('begin');
  try {
    await client.query('update public.events set starts_on = $1, ends_on = $2 where id = $3', [
      startsOn,
      endsOn,
      eventId,
    ]);
    await client.query('commit');
    return { committed: true };
  } catch {
    await client.query('rollback').catch(() => {});
    return { committed: false };
  }
}

async function readEventRange(
  admin: pg.Client,
  eventId: string,
): Promise<{ startsOn: string; endsOn: string }> {
  const { rows } = await admin.query<{ starts_on: string; ends_on: string }>(
    `select to_char(starts_on, 'YYYY-MM-DD') as starts_on,
            to_char(ends_on, 'YYYY-MM-DD') as ends_on
     from public.events where id = $1`,
    [eventId],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`event ${eventId} not found`);
  }
  return { startsOn: row.starts_on, endsOn: row.ends_on };
}

// --- Case A: a brand-new occurrence insert vs. narrowing the range to exclude it ---

void test('concurrency A (insert first): a narrower range that would exclude a just-inserted occurrence is rejected, not silently committed', async () => {
  const admin = await newClient();
  const tx1 = await newClient();
  const tx2 = await newClient();
  try {
    const eventId = await createFixtureEvent(admin, '2030-01-01', '2030-01-31');
    const tx2Pid = await backendPid(tx2);

    await tx1.query('begin');
    await tx1.query('insert into public.event_occurrences (event_id, starts_at) values ($1, $2)', [
      eventId,
      '2030-01-15T01:00:00Z',
    ]);

    const tx2Result = attemptRangeUpdate(tx2, eventId, '2030-02-01', '2030-02-10');
    await waitUntilBlocked(admin, tx2Pid);
    await tx1.query('commit');
    const outcome = await tx2Result;

    assert.equal(
      outcome.committed,
      false,
      'expected the narrower range to be rejected once tx2 sees the committed, now-out-of-range occurrence',
    );
    assert.deepEqual(await readEventRange(admin, eventId), {
      startsOn: '2030-01-01',
      endsOn: '2030-01-31',
    });
    const { rows: occRows } = await admin.query(
      'select 1 from public.event_occurrences where event_id = $1 and starts_at = $2',
      [eventId, '2030-01-15T01:00:00Z'],
    );
    assert.equal(occRows.length, 1, "expected tx1's occurrence to have committed");
  } finally {
    await tx1.end();
    await tx2.end();
    await admin.end();
  }
});

void test('concurrency A (range update first): an occurrence insert outside a just-narrowed range is rejected, not silently committed', async () => {
  const admin = await newClient();
  const tx1 = await newClient();
  const tx2 = await newClient();
  try {
    const eventId = await createFixtureEvent(admin, '2030-01-01', '2030-01-31');
    const tx1Pid = await backendPid(tx1);

    await tx2.query('begin');
    await tx2.query('update public.events set starts_on = $1, ends_on = $2 where id = $3', [
      '2030-02-01',
      '2030-02-10',
      eventId,
    ]);

    const tx1Result = (async () => {
      await tx1.query('begin');
      try {
        await tx1.query(
          'insert into public.event_occurrences (event_id, starts_at) values ($1, $2)',
          [eventId, '2030-01-15T01:00:00Z'],
        );
        await tx1.query('commit');
        return { committed: true };
      } catch {
        await tx1.query('rollback').catch(() => {});
        return { committed: false };
      }
    })();

    await waitUntilBlocked(admin, tx1Pid);
    await tx2.query('commit');
    const outcome = await tx1Result;

    assert.equal(
      outcome.committed,
      false,
      'expected the out-of-range insert to be rejected once tx1 sees the committed, narrower range',
    );
    assert.deepEqual(await readEventRange(admin, eventId), {
      startsOn: '2030-02-01',
      endsOn: '2030-02-10',
    });
    const { rows: occRows } = await admin.query(
      'select 1 from public.event_occurrences where event_id = $1 and starts_at = $2',
      [eventId, '2030-01-15T01:00:00Z'],
    );
    assert.equal(occRows.length, 0, "expected tx1's occurrence to have rolled back");
  } finally {
    await tx1.end();
    await tx2.end();
    await admin.end();
  }
});

// --- Case B: moving an existing occurrence's starts_at vs. the range update ---

void test('concurrency B (occurrence update first): a range update that would exclude a just-moved occurrence is rejected, not silently committed', async () => {
  const admin = await newClient();
  const tx1 = await newClient();
  const tx2 = await newClient();
  try {
    const eventId = await createFixtureEvent(admin, '2030-01-01', '2030-01-31');
    const { rows: occRows } = await admin.query<{ id: string }>(
      `insert into public.event_occurrences (event_id, starts_at) values ($1, $2) returning id`,
      [eventId, '2030-01-05T01:00:00Z'],
    );
    const occurrenceId = occRows[0]?.id;
    assert.ok(occurrenceId);
    const tx2Pid = await backendPid(tx2);

    await tx1.query('begin');
    await tx1.query('update public.event_occurrences set starts_at = $1 where id = $2', [
      '2030-01-20T01:00:00Z',
      occurrenceId,
    ]);

    const tx2Result = attemptRangeUpdate(tx2, eventId, '2030-01-01', '2030-01-15');
    await waitUntilBlocked(admin, tx2Pid);
    await tx1.query('commit');
    const outcome = await tx2Result;

    assert.equal(
      outcome.committed,
      false,
      'expected the narrower range to be rejected once tx2 sees the committed, moved occurrence',
    );
    assert.deepEqual(await readEventRange(admin, eventId), {
      startsOn: '2030-01-01',
      endsOn: '2030-01-31',
    });
    const { rows: refetched } = await admin.query<{ starts_at: string }>(
      'select starts_at from public.event_occurrences where id = $1',
      [occurrenceId],
    );
    assert.equal(
      new Date(refetched[0]?.starts_at ?? '').toISOString(),
      '2030-01-20T01:00:00.000Z',
      "expected tx1's move to have committed",
    );
  } finally {
    await tx1.end();
    await tx2.end();
    await admin.end();
  }
});

void test('concurrency B (range update first): moving an occurrence outside a just-narrowed range is rejected, not silently committed', async () => {
  const admin = await newClient();
  const tx1 = await newClient();
  const tx2 = await newClient();
  try {
    const eventId = await createFixtureEvent(admin, '2030-01-01', '2030-01-31');
    const { rows: occRows } = await admin.query<{ id: string }>(
      `insert into public.event_occurrences (event_id, starts_at) values ($1, $2) returning id`,
      [eventId, '2030-01-05T01:00:00Z'],
    );
    const occurrenceId = occRows[0]?.id;
    assert.ok(occurrenceId);
    const tx1Pid = await backendPid(tx1);

    await tx2.query('begin');
    await tx2.query('update public.events set starts_on = $1, ends_on = $2 where id = $3', [
      '2030-01-01',
      '2030-01-15',
      eventId,
    ]);

    const tx1Result = (async () => {
      await tx1.query('begin');
      try {
        await tx1.query('update public.event_occurrences set starts_at = $1 where id = $2', [
          '2030-01-20T01:00:00Z',
          occurrenceId,
        ]);
        await tx1.query('commit');
        return { committed: true };
      } catch {
        await tx1.query('rollback').catch(() => {});
        return { committed: false };
      }
    })();

    await waitUntilBlocked(admin, tx1Pid);
    await tx2.query('commit');
    const outcome = await tx1Result;

    assert.equal(
      outcome.committed,
      false,
      'expected the out-of-range move to be rejected once tx1 sees the committed, narrower range',
    );
    const { rows: refetched } = await admin.query<{ starts_at: string }>(
      'select starts_at from public.event_occurrences where id = $1',
      [occurrenceId],
    );
    assert.equal(
      new Date(refetched[0]?.starts_at ?? '').toISOString(),
      '2030-01-05T01:00:00.000Z',
      "expected tx1's move to have rolled back",
    );
  } finally {
    await tx1.end();
    await tx2.end();
    await admin.end();
  }
});
