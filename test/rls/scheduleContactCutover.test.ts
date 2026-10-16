import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import pg from 'pg';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';

// Replays the actual SQL in fixture-owned
// schemas; public release state and real auth.users are never changed.
// RLS/PostgREST coverage belongs to the ordinary integration/pgTAP suites.
const status = readLocalSupabaseStatus();
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(status.dbUrl).hostname));
const migrations = new URL('../../supabase/migrations/', import.meta.url);
const readMigration = (name: string): string => readFileSync(new URL(name, migrations), 'utf8');
const cutovers = readdirSync(migrations).filter((name) =>
  name.endsWith('_schedule_contact_write_cutover.sql'),
);
assert.equal(cutovers.length, 1, 'exactly one reviewed P3 cutover migration');
const cutover = readMigration(cutovers[0]!);
const foundation = readMigration('20261016002654_schedule_contact_registration_foundation.sql');
const management = readMigration('20261016021552_schedule_contact_management_generation.sql');
const legacy = readMigration('20260908010000_add_share_by_email_sqlstates.sql');

async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: status.dbUrl, statement_timeout: 15000 });
  await client.connect();
  return client;
}

interface Fixture {
  admin: pg.Client;
  actor: pg.Client;
  name: string;
  secret: string;
  legacyName: string;
  a: string;
  b: string;
  oldEntry: string;
  newEntry: string;
  rewrite: (sql: string) => string;
}

// Execute the real migration body inside an explicitly controlled transaction.
// Only its outer transaction delimiters are removed; no statement splitting.
function transactionBody(sql: string): string {
  const first = sql.search(/^begin;\s*$/m);
  const last = sql.search(/^commit;\s*$/m);
  assert.ok(first >= 0 && last > first, 'migration has outer BEGIN/COMMIT');
  assert.ok(/^\s*$/.test(sql.slice(last + 'commit;'.length)), 'COMMIT is final statement');
  return sql.slice(first + 'begin;'.length, last);
}

async function fixture(run: (f: Fixture) => Promise<void>): Promise<void> {
  const admin = await connect();
  const actor = await connect();
  const suffix = randomUUID().replaceAll('-', '');
  const name = `contact_p3_${suffix}`;
  const secret = `${name}_private`;
  // Global same-name overload inventory still works, without counting the real
  // public function or another parallel fixture. Do not narrow its schema scan.
  const legacyName = `legacy_contact_${suffix}`;
  const a = randomUUID();
  const b = randomUUID();
  const oldEntry = randomUUID();
  const newEntry = randomUUID();
  const rewrite = (sql: string): string =>
    sql
      .replaceAll('share_schedule_entry_by_email', legacyName)
      .replaceAll('public.', `${name}.`)
      .replaceAll('private.', `${secret}.`)
      .replaceAll('auth.users', `${secret}.users`);
  const publicGate = (
    await admin.query('select public.schedule_contact_registration_enabled() as enabled')
  ).rows[0].enabled;
  try {
    await admin.query(`create schema ${name}; create schema ${secret};
      grant usage on schema ${name} to authenticated;
      create table ${secret}.users(id uuid primary key, email text, deleted_at timestamptz);
      create table ${name}.personal_schedule_entries(
        id uuid primary key, owner_id uuid not null references ${secret}.users on delete cascade);
      create table ${name}.personal_schedule_shares(
        id uuid primary key default gen_random_uuid(),
        schedule_entry_id uuid not null references ${name}.personal_schedule_entries on delete cascade,
        shared_with_user_id uuid not null references ${secret}.users on delete cascade,
        created_at timestamptz not null default now(),
        unique(schedule_entry_id,shared_with_user_id));
      grant select,delete on ${name}.personal_schedule_shares to authenticated;
      create function ${name}.is_personal_schedule_entry_owner(p_entry_id uuid)
      returns boolean language sql stable security definer set search_path='' as $$
        select exists(select 1 from ${name}.personal_schedule_entries
          where id=p_entry_id and owner_id=auth.uid());
      $$;
      revoke all on function ${name}.is_personal_schedule_entry_owner(uuid) from public,anon;
      grant execute on function ${name}.is_personal_schedule_entry_owner(uuid) to authenticated;`);
    await admin.query(rewrite(foundation));
    await admin.query(rewrite(management));
    await admin.query(rewrite(legacy));
    await admin.query(
      `insert into ${secret}.users(id,email) values
      ($1,'a@example.test'),($2,'b@example.test')`,
      [a, b],
    );
    await admin.query(`insert into ${name}.personal_schedule_entries values($1,$2),($3,$2)`, [
      oldEntry,
      a,
      newEntry,
    ]);
    // The legacy row predates P3, just as a real pre-existing share would.
    await admin.query(
      `insert into ${name}.personal_schedule_shares
      (schedule_entry_id,shared_with_user_id) values($1,$2)`,
      [oldEntry, b],
    );
    await run({ admin, actor, name, secret, legacyName, a, b, oldEntry, newEntry, rewrite });
  } finally {
    await actor.query('rollback');
    await admin.query('rollback');
    await actor.end();
    await admin.query(
      `drop schema if exists ${name} cascade; drop schema if exists ${secret} cascade`,
    );
    assert.equal(
      (await admin.query('select public.schedule_contact_registration_enabled() as enabled'))
        .rows[0].enabled,
      publicGate,
      'real public gate stays at its initial value',
    );
    await admin.end();
  }
}

async function asActor(client: pg.Client, id: string): Promise<void> {
  await client.query('begin');
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
}

async function snapshot(f: Fixture): Promise<unknown> {
  return (
    await f.admin.query(`select
    ${f.name}.schedule_contact_registration_enabled() as enabled,
    pg_get_functiondef('${f.name}.${f.legacyName}(uuid,text)'::regprocedure) as legacy_definition,
    (select proacl::text from pg_proc where oid='${f.name}.${f.legacyName}(uuid,text)'::regprocedure) as legacy_acl,
    (select jsonb_build_object('definition',pg_get_functiondef(p.oid),
      'owner',p.proowner::regrole::text,'acl',p.proacl::text,'config',p.proconfig,
      'definer',p.prosecdef,'volatile',p.provolatile,'parallel',p.proparallel,
      'strict',p.proisstrict,'leakproof',p.proleakproof,'language',p.prolang)
      from pg_proc p where p.oid='${f.secret}.validate_schedule_share_contact()'::regprocedure) as validator,
    (select jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid)) order by tgname)
      from pg_trigger where tgrelid='${f.name}.personal_schedule_shares'::regclass and not tgisinternal) as triggers,
    (select jsonb_agg(to_jsonb(s) order by s.id) from ${f.name}.personal_schedule_shares s) as shares,
    (select relacl::text from pg_class where oid='${f.name}.personal_schedule_shares'::regclass) as table_acl,
    (select jsonb_agg(jsonb_build_object('name',attname,'acl',attacl::text) order by attnum)
      from pg_attribute where attrelid='${f.name}.personal_schedule_shares'::regclass and attnum>0 and not attisdropped) as column_acl`)
  ).rows[0];
}

async function blocked(observer: pg.Client, blockedPid: number, blockerPid: number): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const result = await observer.query('select $2::int = any(pg_blocking_pids($1)) as blocked', [
      blockedPid,
      blockerPid,
    ]);
    if (result.rows[0].blocked === true) return;
    assert.ok(Date.now() < deadline, 'actual PostgreSQL lock dependency must be observed');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function invariant(f: Fixture): Promise<void> {
  const result = await f.admin.query(
    `select
    ${f.name}.schedule_contact_registration_enabled() as enabled,
    has_function_privilege('anon','${f.name}.${f.legacyName}(uuid,text)','EXECUTE') as anon_execute,
    has_function_privilege('authenticated','${f.name}.${f.legacyName}(uuid,text)','EXECUTE') as auth_execute,
    (select count(*)::int from ${f.name}.personal_schedule_shares where schedule_entry_id=$1 and contact_id is null) as legacy_count,
    (select count(*)::int from ${f.name}.schedule_contacts) as contacts`,
    [f.oldEntry],
  );
  assert.deepEqual(result.rows[0], {
    enabled: true,
    anon_execute: false,
    auth_execute: false,
    legacy_count: 1,
    contacts: 0,
  });
}

void test('P3 atomically closes old callers, preserves legacy rows, and permits explicit accepted sharing', async () =>
  fixture(async (f) => {
    await f.admin.query(f.rewrite(cutover));
    await invariant(f);
    // A privileged caller/wrapper also meets the deny body, regardless of ACL.
    await assert.rejects(
      f.admin.query(`select ${f.name}.${f.legacyName}($1,$2)`, [f.newEntry, 'b@example.test']),
      { code: '42501' },
    );
    await assert.rejects(
      f.admin.query(
        `insert into ${f.name}.personal_schedule_shares
      (schedule_entry_id,shared_with_user_id) values($1,$2)`,
        [f.newEntry, f.b],
      ),
      { code: '42501' },
    );
    await asActor(f.actor, f.a);
    await f.actor.query(`select ${f.name}.request_schedule_contact_by_email('b@example.test')`);
    await f.actor.query('commit');
    const request = (await f.admin.query(`select id from ${f.name}.schedule_contact_requests`))
      .rows[0].id;
    await asActor(f.actor, f.b);
    await f.actor.query(`select ${f.name}.accept_schedule_contact_request($1)`, [request]);
    await f.actor.query('commit');
    assert.equal(
      (await f.admin.query(`select count(*)::int as n from ${f.name}.personal_schedule_shares`))
        .rows[0].n,
      1,
      'acceptance creates no automatic share',
    );
    const contact = (await f.admin.query(`select id from ${f.name}.schedule_contacts`)).rows[0].id;
    await asActor(f.actor, f.a);
    await f.actor.query(`select ${f.name}.share_schedule_entry_with_contact($1,$2)`, [
      f.newEntry,
      contact,
    ]);
    await f.actor.query('commit');
    assert.equal(
      (
        await f.admin.query(
          `select contact_id from ${f.name}.personal_schedule_shares where schedule_entry_id=$1`,
          [f.newEntry],
        )
      ).rows[0].contact_id,
      contact,
    );
    assert.equal(
      (
        await f.admin.query(
          `select contact_id from ${f.name}.personal_schedule_shares where schedule_entry_id=$1`,
          [f.oldEntry],
        )
      ).rows[0].contact_id,
      null,
      'other legacy row is not automatically bound',
    );

    // A forward emergency stop must never restore legacy write permission.
    await f.admin
      .query(`create or replace function ${f.name}.schedule_contact_registration_enabled()
      returns boolean language sql immutable set search_path='' as $$ select false; $$;`);
    await assert.rejects(
      f.admin.query(`select ${f.name}.${f.legacyName}($1,$2)`, [f.oldEntry, 'b@example.test']),
      { code: '42501' },
    );
    await assert.rejects(
      f.admin.query(
        `insert into ${f.name}.personal_schedule_shares
      (schedule_entry_id,shared_with_user_id) values($1,$2)`,
        [f.newEntry, f.b],
      ),
      { code: '42501' },
    );
    await asActor(f.actor, f.a);
    await assert.rejects(
      f.actor.query(`select ${f.name}.request_schedule_contact_by_email('b@example.test')`),
      { code: '0A000' },
    );
    await f.actor.query('rollback');
    assert.equal(
      (await f.admin.query(`select count(*)::int as n from ${f.name}.personal_schedule_shares`))
        .rows[0].n,
      2,
    );
  }));

void test('P3 failure after gate switch rolls back function, ACL, triggers and every legacy row', async () =>
  fixture(async (f) => {
    const before = await snapshot(f);
    await f.admin.query('begin');
    await f.admin.query(f.rewrite(transactionBody(cutover)));
    await invariant(f);
    await assert.rejects(
      f.admin.query("do $$ begin raise exception 'P3 fault injection'; end $$;"),
    );
    await f.admin.query('rollback');
    assert.deepEqual(await snapshot(f), before);
  }));

void test('P3 unexpected overload fails closed without partial gate or ACL changes', async () =>
  fixture(async (f) => {
    await f.admin.query(`create function ${f.name}.${f.legacyName}(text)
      returns void language plpgsql as $$ begin return; end; $$`);
    const before = await snapshot(f);
    await assert.rejects(f.admin.query(f.rewrite(cutover)), { code: '55000' });
    await f.admin.query('rollback');
    assert.deepEqual(await snapshot(f), before);
  }));

void test('P3 same-name function in another schema fails closed', async () =>
  fixture(async (f) => {
    await f.admin.query(`create function ${f.secret}.${f.legacyName}(uuid,text)
      returns void language plpgsql as $$ begin return; end; $$`);
    const before = await snapshot(f);
    await assert.rejects(f.admin.query(f.rewrite(cutover)), { code: '55000' });
    await f.admin.query('rollback');
    assert.deepEqual(await snapshot(f), before);
  }));

void test('P3 clears explicit PUBLIC/anon EXECUTE and table/column write grants', async () =>
  fixture(async (f) => {
    await f.admin
      .query(`grant execute on function ${f.name}.${f.legacyName}(uuid,text) to public,anon;
      grant insert on ${f.name}.personal_schedule_shares to anon;
      grant update(contact_id) on ${f.name}.personal_schedule_shares to authenticated`);
    await f.admin.query(f.rewrite(cutover));
    await invariant(f);
    for (const role of ['anon', 'authenticated']) {
      const privileges = (
        await f.admin.query(
          `select
        has_table_privilege($1,$2,'INSERT,UPDATE') as table_write,
        has_any_column_privilege($1,$2,'INSERT,UPDATE') as column_write`,
          [role, `${f.name}.personal_schedule_shares`],
        )
      ).rows[0];
      assert.deepEqual(privileges, { table_write: false, column_write: false });
    }
  }));

void test('P3 refuses to activate when the accepted-pair validation trigger is disabled', async () =>
  fixture(async (f) => {
    await f.admin.query(`alter table ${f.name}.personal_schedule_shares
      disable trigger personal_schedule_shares_validate_contact`);
    const before = await snapshot(f);
    await assert.rejects(f.admin.query(f.rewrite(cutover)), { code: '55000' });
    await f.admin.query('rollback');
    assert.deepEqual(await snapshot(f), before);
  }));

for (const kind of ['conditional', 'arguments', 'columns'] as const) {
  void test(`P3 refuses validator drift: ${kind}`, async () =>
    fixture(async (f) => {
      await f.admin.query(`drop trigger personal_schedule_shares_validate_contact
        on ${f.name}.personal_schedule_shares;
        create trigger personal_schedule_shares_validate_contact
        before insert or update ${kind === 'columns' ? 'of contact_id' : ''} on ${f.name}.personal_schedule_shares
        for each row ${kind === 'conditional' ? 'when (new.contact_id is null)' : ''}
        execute function ${f.secret}.validate_schedule_share_contact(${kind === 'arguments' ? "'unexpected'" : ''})`);
      const before = await snapshot(f);
      await assert.rejects(f.admin.query(f.rewrite(cutover)), { code: '55000' });
      await f.admin.query('rollback');
      assert.deepEqual(await snapshot(f), before);
    }));
}

for (const drift of ['body', 'invoker', 'search-path', 'owner', 'execute'] as const) {
  void test(`P3 refuses same-OID validator definition drift: ${drift}`, async () =>
    fixture(async (f) => {
      const fn = `${f.secret}.validate_schedule_share_contact()`;
      const oid = (await f.admin.query(`select '${fn}'::regprocedure::oid as oid`)).rows[0].oid;
      const mutation = {
        body: `create or replace function ${fn} returns trigger
          language plpgsql security definer set search_path='' as $$ begin return new; end; $$`,
        invoker: `alter function ${fn} security invoker`,
        'search-path': `alter function ${fn} set search_path=public`,
        // Ownership transfer requires CREATE on this disposable fixture schema.
        owner: `grant usage,create on schema ${f.secret} to service_role;
          alter function ${fn} owner to service_role`,
        execute: `grant execute on function ${fn} to authenticated`,
      }[drift];
      await f.admin.query(mutation);
      assert.equal(
        (await f.admin.query(`select '${fn}'::regprocedure::oid as oid`)).rows[0].oid,
        oid,
        'definition drift must preserve the OID referenced by the unchanged trigger',
      );
      const before = await snapshot(f);
      await assert.rejects(f.admin.query(f.rewrite(cutover)), { code: '55000' });
      await f.admin.query('rollback');
      assert.deepEqual(await snapshot(f), before);
    }));
}

void test('P3 inherited EXECUTE fails closed and rolls back the entire cutover', async () =>
  fixture(async (f) => {
    const role = `contact_grant_${randomUUID().replaceAll('-', '')}`;
    try {
      await f.admin.query(`create role ${role}; grant ${role} to authenticated;
        grant execute on function ${f.name}.${f.legacyName}(uuid,text) to ${role}`);
      assert.equal(
        (await f.admin.query("select pg_has_role('authenticated',$1,'USAGE') as inherited", [role]))
          .rows[0].inherited,
        true,
        'fixture must establish effective inherited privilege',
      );
      const before = await snapshot(f);
      await assert.rejects(f.admin.query(f.rewrite(cutover)), { code: '55000' });
      await f.admin.query('rollback');
      assert.deepEqual(await snapshot(f), before);
    } finally {
      await f.admin.query('rollback');
      await f.admin.query(`revoke ${role} from authenticated;
        revoke all on function ${f.name}.${f.legacyName}(uuid,text) from ${role}; drop role ${role}`);
    }
  }));

void test('P3 drains an already inserted legacy transaction before committing the boundary', async () =>
  fixture(async (f) => {
    const adminPid = (await f.admin.query('select pg_backend_pid() as pid')).rows[0].pid as number;
    const actorPid = (await f.actor.query('select pg_backend_pid() as pid')).rows[0].pid as number;
    await asActor(f.actor, f.a);
    await f.actor.query(`select ${f.name}.${f.legacyName}($1,$2)`, [f.newEntry, 'b@example.test']);
    const applying = f.admin.query(f.rewrite(cutover)).then(
      (value) => ({ value, error: undefined }),
      (error) => ({ value: undefined, error: error as Error }),
    );
    await blocked(f.actor, adminPid, actorPid);
    await f.actor.query('commit');
    const result = await applying;
    assert.equal(result.error, undefined);
    await invariant(f);
    assert.equal(
      (
        await f.admin.query(`select count(*)::int as n from ${f.name}.personal_schedule_shares
      where contact_id is null`)
      ).rows[0].n,
      2,
      'pre-cutover committed legacy share survives',
    );
  }));

void test('old RPC already running before INSERT cannot create a NULL share after P3 commits', async () =>
  fixture(async (f) => {
    const adminPid = (await f.admin.query('select pg_backend_pid() as pid')).rows[0].pid as number;
    const actorPid = (await f.actor.query('select pg_backend_pid() as pid')).rows[0].pid as number;
    await f.admin.query('begin');
    await f.admin.query(`lock table ${f.secret}.users in access exclusive mode`);
    await asActor(f.actor, f.a);
    const running = f.actor
      .query(`select ${f.name}.${f.legacyName}($1,$2)`, [f.newEntry, 'b@example.test'])
      .then(
        (value) => ({ value, error: undefined }),
        (error) => ({ value: undefined, error: error as pg.DatabaseError }),
      );
    await blocked(f.admin, actorPid, adminPid);
    await f.admin.query(f.rewrite(transactionBody(cutover)));
    await f.admin.query('commit');
    const result = await running;
    assert.equal(result.error?.code, '42501');
    await f.actor.query('rollback');
    await invariant(f);
    assert.equal(
      (
        await f.admin.query(
          `select count(*)::int as n from ${f.name}.personal_schedule_shares
      where schedule_entry_id=$1`,
          [f.newEntry],
        )
      ).rows[0].n,
      0,
    );
  }));
