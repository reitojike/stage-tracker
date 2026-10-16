import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import pg from 'pg';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';

// Execute the actual migrations in fixture-owned namespaces. Only the fixture's
// gate is true; the public release gate is never replaced across sessions.
// auth.uid(), roles, row/advisory locks and FK cascades are real PostgreSQL.
// A surrogate users table avoids DDL locks on auth.users in the parallel suite.
// Actual auth.users/RLS/PostgREST integration is covered separately by pgTAP
// and scheduleContactAccess.test.ts; this is not HTTP timing evidence.
const status = readLocalSupabaseStatus();
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(status.dbUrl).hostname));
const foundation = readFileSync(
  new URL(
    '../../supabase/migrations/20261016002654_schedule_contact_registration_foundation.sql',
    import.meta.url,
  ),
  'utf8',
);
const management = readFileSync(
  new URL(
    '../../supabase/migrations/20261016021552_schedule_contact_management_generation.sql',
    import.meta.url,
  ),
  'utf8',
);

async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: status.dbUrl, statement_timeout: 10000 });
  await client.connect();
  return client;
}

async function fixture(run: (f: Fixture) => Promise<void>): Promise<void> {
  const admin = await connect();
  const first = await connect();
  const second = await connect();
  const name = `contact_p1b_${randomUUID().replaceAll('-', '')}`;
  const secret = `${name}_private`;
  assert.match(name, /^contact_p1b_[a-f0-9]{32}$/);
  const ids = {
    a: randomUUID(),
    b: randomUUID(),
    c: randomUUID(),
    entry: randomUUID(),
    reverse: randomUUID(),
  };
  try {
    assert.equal(
      (await admin.query('select public.schedule_contact_registration_enabled() as enabled'))
        .rows[0].enabled,
      false,
    );
    await admin.query(`create schema ${name}; create schema ${secret};
      grant usage on schema ${name} to authenticated;
      create table ${secret}.users(id uuid primary key, email text, deleted_at timestamptz);
      create table ${name}.personal_schedule_entries(
        id uuid primary key, owner_id uuid references ${secret}.users on delete cascade);
      create table ${name}.personal_schedule_shares(
        id uuid primary key default gen_random_uuid(),
        schedule_entry_id uuid not null references ${name}.personal_schedule_entries on delete cascade,
        shared_with_user_id uuid not null references ${secret}.users on delete cascade,
        created_at timestamptz not null default now(),
        unique(schedule_entry_id,shared_with_user_id));`);
    const rewrite = (sql: string): string =>
      sql
        .replaceAll('public.', `${name}.`)
        .replaceAll('private.', `${secret}.`)
        .replaceAll('auth.users', `${secret}.users`);
    assert.equal(foundation.split('as $$ select false; $$;').length, 2);
    await admin.query(
      rewrite(foundation).replace('as $$ select false; $$;', () => 'as $$ select true; $$;'),
    );
    await admin.query(rewrite(management));
    await admin.query(
      `insert into ${secret}.users(id,email) values ($1,'a@example.test'),($2,'b@example.test'),($3,'c@example.test')`,
      [ids.a, ids.b, ids.c],
    );
    await admin.query(`insert into ${name}.personal_schedule_entries values ($1,$2),($3,$4)`, [
      ids.entry,
      ids.a,
      ids.reverse,
      ids.b,
    ]);
    await run({ admin, first, second, name, secret, ...ids });
  } finally {
    await first.query('rollback');
    await second.query('rollback');
    await Promise.all([first.end(), second.end()]);
    await admin.query('rollback');
    await admin.query(
      `drop schema if exists ${name} cascade; drop schema if exists ${secret} cascade`,
    );
    assert.equal(
      (await admin.query('select public.schedule_contact_registration_enabled() as enabled'))
        .rows[0].enabled,
      false,
    );
    await admin.end();
  }
}

interface Fixture {
  admin: pg.Client;
  first: pg.Client;
  second: pg.Client;
  name: string;
  secret: string;
  a: string;
  b: string;
  c: string;
  entry: string;
  reverse: string;
}

async function actor(client: pg.Client, id: string): Promise<void> {
  await client.query('begin');
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
}

async function rpc(
  client: pg.Client,
  f: Fixture,
  operation: string,
  args: unknown[] = [],
): Promise<pg.QueryResult> {
  assert.match(operation, /^[a-z_]+$/);
  return client.query(
    `select * from ${f.name}.${operation}(${args.map((_, i) => `$${String(i + 1)}`).join(',')})`,
    args,
  );
}

async function accepted(f: Fixture): Promise<string> {
  await actor(f.first, f.a);
  await rpc(f.first, f, 'request_schedule_contact_by_email', ['b@example.test']);
  await f.first.query('commit');
  const request: string = (
    await f.admin.query(`select id from ${f.name}.schedule_contact_requests`)
  ).rows[0].id;
  await actor(f.second, f.b);
  await rpc(f.second, f, 'accept_schedule_contact_request', [request]);
  await f.second.query('commit');
  return (await f.admin.query(`select id from ${f.name}.schedule_contacts`)).rows[0].id as string;
}

// Assert a real dependency on the held transaction, rather than use a sleep
// and assume the conflicting operation has reached its critical section.
async function blocked(
  f: Fixture,
  winner: pg.Client,
  loser: pg.Client,
  work: () => Promise<unknown>,
): Promise<unknown> {
  const winningPid: number = (await winner.query('select pg_backend_pid() as pid')).rows[0].pid;
  const losingPid: number = (await loser.query('select pg_backend_pid() as pid')).rows[0].pid;
  const pending = work().then(
    (value) => ({ value, error: undefined }),
    (error) => ({ value: undefined, error: error as Error }),
  );
  const deadline = Date.now() + 5000;
  for (;;) {
    const { rows } = await f.admin.query('select $2::int = any(pg_blocking_pids($1)) as blocked', [
      losingPid,
      winningPid,
    ]);
    if (rows[0].blocked === true) break;
    assert.ok(Date.now() < deadline, 'second operation must wait on the first transaction');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await winner.query('commit');
  const result = await pending;
  if (result.error) {
    await loser.query('rollback');
    return result.error;
  }
  await loser.query('commit');
  return result.value;
}

for (const reverse of [false, true]) {
  void test(`contact request serializes ${reverse ? 'reverse' : 'duplicate'} submission without accepting`, async () =>
    fixture(async (f) => {
      await actor(f.first, f.a);
      await rpc(f.first, f, 'request_schedule_contact_by_email', ['b@example.test']);
      await actor(f.second, reverse ? f.b : f.a);
      const result = await blocked(f, f.first, f.second, () =>
        rpc(f.second, f, 'request_schedule_contact_by_email', [
          reverse ? 'a@example.test' : 'b@example.test',
        ]),
      );
      assert.ok(!(result instanceof Error));
      assert.equal(
        (await f.admin.query(`select count(*)::int as n from ${f.name}.schedule_contact_requests`))
          .rows[0].n,
        1,
      );
      assert.equal(
        (await f.admin.query(`select count(*)::int as n from ${f.name}.schedule_contacts`)).rows[0]
          .n,
        0,
      );
    }));
}

for (const acceptFirst of [false, true]) {
  void test(`accept/cancel serializes with ${acceptFirst ? 'accept' : 'cancel'} first`, async () =>
    fixture(async (f) => {
      await actor(f.first, f.a);
      await rpc(f.first, f, 'request_schedule_contact_by_email', ['b@example.test']);
      await f.first.query('commit');
      const request: string = (
        await f.admin.query(`select id from ${f.name}.schedule_contact_requests`)
      ).rows[0].id;
      const accept = (client: pg.Client): Promise<pg.QueryResult> =>
        rpc(client, f, 'accept_schedule_contact_request', [request]);
      const cancel = (client: pg.Client): Promise<pg.QueryResult> =>
        rpc(client, f, 'cancel_schedule_contact_request_by_email', ['b@example.test']);
      await actor(f.first, acceptFirst ? f.b : f.a);
      await (acceptFirst ? accept : cancel)(f.first);
      await actor(f.second, acceptFirst ? f.a : f.b);
      assert.ok(
        !(
          (await blocked(f, f.first, f.second, () =>
            (acceptFirst ? cancel : accept)(f.second),
          )) instanceof Error
        ),
      );
      assert.equal(
        (await f.admin.query(`select count(*)::int as n from ${f.name}.schedule_contacts`)).rows[0]
          .n,
        acceptFirst ? 1 : 0,
      );
      assert.equal(
        (await f.admin.query(`select count(*)::int as n from ${f.name}.schedule_contact_requests`))
          .rows[0].n,
        0,
      );
    }));
}

for (const unlinkFirst of [false, true]) {
  for (const operation of ['share', 'alias'] as const) {
    void test(`unlink/${operation} serializes with ${unlinkFirst ? 'unlink' : operation} first`, async () =>
      fixture(async (f) => {
        const contact = await accepted(f);
        // Both directions and unrelated legacy visibility exist before the race.
        await f.admin.query(
          `insert into ${f.name}.personal_schedule_shares(schedule_entry_id,shared_with_user_id)
        values($1,$2),($3,$4),($1,$5)`,
          [f.entry, f.b, f.reverse, f.a, f.c],
        );
        const unlink = (client: pg.Client): Promise<pg.QueryResult> =>
          rpc(client, f, 'unlink_schedule_contact', [contact]);
        const write = (client: pg.Client): Promise<pg.QueryResult> =>
          operation === 'share'
            ? rpc(client, f, 'share_schedule_entry_with_contact', [f.entry, contact])
            : rpc(client, f, 'set_schedule_contact_alias', [contact, 'private name']);
        await actor(f.first, unlinkFirst ? f.b : f.a);
        await (unlinkFirst ? unlink : write)(f.first);
        await actor(f.second, unlinkFirst ? f.a : f.b);
        const result = await blocked(f, f.first, f.second, () =>
          (unlinkFirst ? write : unlink)(f.second),
        );
        if (unlinkFirst) assert.equal((result as pg.DatabaseError).code, '42501');
        else assert.ok(!(result instanceof Error));
        assert.equal(
          (await f.admin.query(`select count(*)::int as n from ${f.name}.schedule_contacts`))
            .rows[0].n,
          0,
        );
        assert.equal(
          (await f.admin.query(`select count(*)::int as n from ${f.name}.schedule_contact_aliases`))
            .rows[0].n,
          0,
        );
        assert.deepEqual(
          (
            await f.admin.query(
              `select shared_with_user_id from ${f.name}.personal_schedule_shares`,
            )
          ).rows,
          [{ shared_with_user_id: f.c }],
        );
        assert.equal(
          (
            await f.admin.query(
              `select count(*)::int as n from ${f.name}.personal_schedule_entries`,
            )
          ).rows[0].n,
          2,
        );
      }));
  }
}

for (const deleteFirst of [false, true]) {
  void test(`account deletion/share serializes with ${deleteFirst ? 'deletion' : 'share'} first`, async () =>
    fixture(async (f) => {
      const contact = await accepted(f);
      const deletion = (client: pg.Client): Promise<pg.QueryResult> =>
        client.query(`delete from ${f.secret}.users where id=$1`, [f.b]);
      const share = (client: pg.Client): Promise<pg.QueryResult> =>
        rpc(client, f, 'share_schedule_entry_with_contact', [f.entry, contact]);
      if (deleteFirst) await f.first.query('begin');
      else await actor(f.first, f.a);
      await (deleteFirst ? deletion : share)(f.first);
      if (deleteFirst) await actor(f.second, f.a);
      else await f.second.query('begin');
      const result = await blocked(f, f.first, f.second, () =>
        (deleteFirst ? share : deletion)(f.second),
      );
      if (deleteFirst) assert.equal((result as pg.DatabaseError).code, '42501');
      else assert.ok(!(result instanceof Error));
      assert.equal(
        (await f.admin.query(`select count(*)::int as n from ${f.name}.schedule_contacts`)).rows[0]
          .n,
        0,
      );
      assert.equal(
        (await f.admin.query(`select count(*)::int as n from ${f.name}.personal_schedule_shares`))
          .rows[0].n,
        0,
      );
      assert.equal(
        (
          await f.admin.query(
            `select count(*)::int as n from ${f.name}.personal_schedule_entries where owner_id=$1`,
            [f.a],
          )
        ).rows[0].n,
        1,
      );
    }));
}

for (const deleteFirst of [false, true]) {
  void test(`account deletion/accept serializes with ${deleteFirst ? 'deletion' : 'accept'} first`, async () =>
    fixture(async (f) => {
      await actor(f.first, f.a);
      await rpc(f.first, f, 'request_schedule_contact_by_email', ['b@example.test']);
      await f.first.query('commit');
      const request: string = (
        await f.admin.query(`select id from ${f.name}.schedule_contact_requests`)
      ).rows[0].id;
      const deletion = (client: pg.Client): Promise<pg.QueryResult> =>
        client.query(`delete from ${f.secret}.users where id=$1`, [f.a]);
      const accept = (client: pg.Client): Promise<pg.QueryResult> =>
        rpc(client, f, 'accept_schedule_contact_request', [request]);
      if (deleteFirst) await f.first.query('begin');
      else await actor(f.first, f.b);
      await (deleteFirst ? deletion : accept)(f.first);
      if (deleteFirst) await actor(f.second, f.b);
      else await f.second.query('begin');
      assert.ok(
        !(
          (await blocked(f, f.first, f.second, () =>
            (deleteFirst ? accept : deletion)(f.second),
          )) instanceof Error
        ),
      );
      assert.equal(
        (await f.admin.query(`select count(*)::int as n from ${f.name}.schedule_contacts`)).rows[0]
          .n,
        0,
      );
      assert.equal(
        (await f.admin.query(`select count(*)::int as n from ${f.name}.schedule_contact_requests`))
          .rows[0].n,
        0,
      );
    }));
}

void test('opaque request result and budget do not expose known/unknown/duplicate/reverse existence', async () =>
  fixture(async (f) => {
    const results: unknown[] = [];
    for (const [caller, email] of [
      [f.a, 'unknown@example.test'],
      [f.a, 'b@example.test'],
      [f.a, 'b@example.test'],
      [f.b, 'a@example.test'],
    ]) {
      assert.ok(caller && email);
      await actor(f.first, caller);
      results.push((await rpc(f.first, f, 'request_schedule_contact_by_email', [email])).rows);
      await f.first.query('commit');
    }
    for (const result of results) assert.deepEqual(result, results[0]);
    assert.equal(
      (
        await f.admin.query(
          `select attempts from ${f.secret}.schedule_contact_request_budgets where user_id=$1`,
          [f.a],
        )
      ).rows[0].attempts,
      3,
    );
    await actor(f.first, f.a);
    assert.deepEqual((await rpc(f.first, f, 'list_received_schedule_contact_requests')).rows, []);
    await assert.rejects(f.first.query(`select * from ${f.name}.schedule_contact_requests`), {
      code: '42501',
    });
    await f.first.query('rollback');
  }));
