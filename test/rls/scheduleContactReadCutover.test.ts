import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import pg from 'pg';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';

// Replay the actual P1/P3/P4 SQL, with real roles, auth.uid(), triggers, FKs,
// and locks, in disposable schemas. Never alter public tables or auth.users.
// HTTP behavior is covered separately by scheduleContactAccess.test.ts.
const status = readLocalSupabaseStatus();
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(status.dbUrl).hostname));
const migrations = new URL('../../supabase/migrations/', import.meta.url);
const migration = (name: string): string => readFileSync(new URL(name, migrations), 'utf8');
function uniqueMigration(suffix: string): string {
  const names = readdirSync(migrations).filter((name) => name.endsWith(suffix));
  assert.equal(names.length, 1, `exactly one migration ending ${suffix}`);
  const name = names[0];
  assert.ok(name);
  return migration(name);
}
const p4 = uniqueMigration('_schedule_contact_read_cutover.sql');
const p3 = uniqueMigration('_schedule_contact_write_cutover.sql');
const baseline = [
  '20260822000000_create_personal_schedule.sql',
  '20260823020000_create_schedule_share_email_boundary.sql',
  '20260826000000_personal_schedule_title_blocking.sql',
  '20260908010000_add_share_by_email_sqlstates.sql',
  '20260920000100_enforce_schedule_share_email_boundary.sql',
  '20261016002654_schedule_contact_registration_foundation.sql',
  '20261016021552_schedule_contact_management_generation.sql',
].map(migration);

function transactionBody(sql: string): string {
  const first = sql.search(/^begin;\s*$/im);
  const last = sql.search(/^commit;\s*$/im);
  assert.ok(first >= 0 && last > first, 'migration has explicit outer transaction');
  assert.match(sql.slice(last + 'commit;'.length), /^\s*$/);
  return sql.slice(first + 'begin;'.length, last);
}

const backendPids = new WeakMap<pg.Client, number>();
async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: status.dbUrl, statement_timeout: 15000 });
  await client.connect();
  const pid = (await client.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]?.pid;
  assert.ok(pid);
  backendPids.set(client, pid);
  return client;
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
  bound: string;
  ab: string;
  ac: string;
  rewrite: (sql: string) => string;
}

async function actor(client: pg.Client, id: string): Promise<void> {
  await client.query('begin');
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
}

async function fixture(
  run: (f: Fixture) => Promise<void>,
  withShares = true,
  legacyAcl: 'fresh' | 'deployed' = 'fresh',
): Promise<void> {
  const admin = await connect();
  const first = await connect();
  const second = await connect();
  const suffix = randomUUID().replaceAll('-', '');
  const name = `contact_p4_${suffix}`;
  const secret = `${name}_private`;
  const a = randomUUID();
  const b = randomUUID();
  const c = randomUUID();
  const entry = randomUUID();
  const reverse = randomUUID();
  const bound = randomUUID();
  const rewrite = (sql: string): string =>
    sql
      .replaceAll('share_schedule_entry_by_email', `legacy_${suffix}`)
      .replaceAll('public.', `${name}.`)
      .replaceAll('private.', `${secret}.`)
      .replaceAll('auth.users', `${secret}.users`);
  const gate = (
    await admin.query('select public.schedule_contact_registration_enabled() as enabled')
  ).rows;
  try {
    await admin.query(`create schema ${name}; create schema ${secret};
      grant usage on schema ${name} to authenticated;
      -- Match Supabase's explicit public-function default grants, scoped only
      -- to this disposable namespace. The historical owner/email functions
      -- revoke PUBLIC but retain anon/authenticated/service_role grants.
      alter default privileges for role postgres in schema ${name}
        grant execute on functions to anon,authenticated,service_role;
      create table ${secret}.users(id uuid primary key,email text,deleted_at timestamptz)`);
    for (const sql of baseline) await admin.query(rewrite(sql));
    if (legacyAcl === 'deployed')
      await admin.query(`revoke execute on function
      ${name}.is_personal_schedule_entry_owner(uuid),${name}.list_schedule_share_recipient_emails(uuid)
      from anon,service_role`);
    // These two later FK swaps are equivalent to the current validated CASCADE
    // constraints. No historical migration touching unrelated tables is run.
    await admin.query(`alter table ${name}.personal_schedule_entries
      drop constraint personal_schedule_entries_owner_id_fkey,
      add constraint personal_schedule_entries_owner_id_fkey foreign key(owner_id)
        references ${secret}.users(id) on delete cascade;
      alter table ${name}.personal_schedule_shares
      drop constraint personal_schedule_shares_shared_with_user_id_fkey,
      add constraint personal_schedule_shares_shared_with_user_id_fkey foreign key(shared_with_user_id)
        references ${secret}.users(id) on delete cascade`);
    await admin.query(
      `insert into ${secret}.users(id,email) values
      ($1,'a@example.test'),($2,'b@example.test'),($3,'c@example.test')`,
      [a, b, c],
    );
    await admin.query(
      `insert into ${name}.personal_schedule_entries
      (id,owner_id,title,is_all_day,starts_on,ends_on,blocking)
      values($1,$2,'A legacy',true,'2026-10-16','2026-10-16',true),
      ($3,$4,'B reverse',true,'2026-10-16','2026-10-16',true),
      ($5,$2,'A bound',true,'2026-10-16','2026-10-16',false)`,
      [entry, a, reverse, b, bound],
    );
    if (withShares)
      await admin.query(
        `insert into ${name}.personal_schedule_shares
      (schedule_entry_id,shared_with_user_id,created_at) values
      ($1,$2,'2026-10-01T10:00:00Z'),($3,$4,'2026-10-02T11:00:00Z'),
      ($1,$5,'2026-10-03T12:00:00Z')`,
        [entry, b, reverse, a, c],
      );
    await admin.query(rewrite(p3));
    async function accept(recipient: string, email: string): Promise<string> {
      await actor(first, a);
      await first.query(`select ${name}.request_schedule_contact_by_email($1)`, [email]);
      await first.query('commit');
      const request = (
        await admin.query<{ id: string }>(
          `select id from ${name}.schedule_contact_requests where recipient_id=$1`,
          [recipient],
        )
      ).rows[0];
      assert.ok(request);
      await actor(second, recipient);
      await second.query(`select ${name}.accept_schedule_contact_request($1)`, [request.id]);
      await second.query('commit');
      const contact = (
        await admin.query<{ id: string }>(
          `select id from ${name}.schedule_contacts
        where user_low_id=least($1::uuid,$2::uuid) and user_high_id=greatest($1::uuid,$2::uuid)`,
          [a, recipient],
        )
      ).rows[0];
      assert.ok(contact);
      return contact.id;
    }
    const ab = await accept(b, 'b@example.test');
    const ac = await accept(c, 'c@example.test');
    if (withShares) {
      await actor(first, a);
      await first.query(`select ${name}.share_schedule_entry_with_contact($1,$2)`, [bound, ab]);
      await first.query('commit');
    }
    await run({
      admin,
      first,
      second,
      name,
      secret,
      a,
      b,
      c,
      entry,
      reverse,
      bound,
      ab,
      ac,
      rewrite,
    });
  } finally {
    await Promise.all([first.query('rollback'), second.query('rollback'), admin.query('rollback')]);
    await Promise.all([first.end(), second.end()]);
    await admin.query(
      `drop schema if exists ${name} cascade; drop schema if exists ${secret} cascade`,
    );
    assert.deepEqual(
      (await admin.query('select public.schedule_contact_registration_enabled() as enabled')).rows,
      gate,
    );
    await admin.end();
  }
}

async function snapshot(f: Fixture): Promise<unknown> {
  return (
    await f.admin.query(`select
    ${f.name}.schedule_contact_registration_enabled() as enabled,
    (select jsonb_agg(to_jsonb(s) order by id) from ${f.name}.personal_schedule_shares s) as shares,
    (select jsonb_agg(to_jsonb(e) order by id) from ${f.name}.personal_schedule_entries e) as entries,
    (select jsonb_agg(to_jsonb(c) order by id) from ${f.name}.schedule_contacts c) as contacts,
    (select jsonb_agg(to_jsonb(r) order by id) from ${f.name}.schedule_contact_requests r) as requests,
    (select jsonb_agg(to_jsonb(a) order by contact_id,owner_id) from ${f.name}.schedule_contact_aliases a) as aliases,
    (select jsonb_agg(to_jsonb(u) order by id) from ${f.secret}.users u) as users,
    (select jsonb_agg(to_jsonb(b) order by user_id) from ${f.secret}.schedule_contact_request_budgets b) as budgets,
    (select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,
      'definition',pg_get_functiondef(p.oid),'acl',p.proacl::text,'owner',p.proowner)
      order by n.nspname,p.proname,p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.oid in ('${f.name}'::regnamespace,'${f.secret}'::regnamespace)) as functions,
    (select jsonb_agg(jsonb_build_object('table',polrelid::regclass::text,'name',polname,
      'command',polcmd,'roles',polroles,'permissive',polpermissive,
      'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid))
      order by polrelid,polname) from pg_policy where polrelid in
      (select oid from pg_class where relnamespace='${f.name}'::regnamespace)) as policies,
    (select jsonb_agg(jsonb_build_object('name',c.relname,'acl',c.relacl::text,
      'rls',c.relrowsecurity,'force',c.relforcerowsecurity) order by c.relname)
      from pg_class c where c.relnamespace in ('${f.name}'::regnamespace,'${f.secret}'::regnamespace)
      and c.relkind='r') as tables,
    (select jsonb_agg(jsonb_build_object('table',attrelid::regclass::text,'name',attname,
      'notnull',attnotnull,'acl',attacl::text,'default',(select pg_get_expr(d.adbin,d.adrelid)
        from pg_attrdef d where d.adrelid=attrelid and d.adnum=attnum)) order by attrelid,attnum)
      from pg_attribute where attrelid in (select oid from pg_class
      where relnamespace='${f.name}'::regnamespace) and attnum>0 and not attisdropped) as columns,
    (select jsonb_agg(jsonb_build_object('name',conname,'valid',convalidated,
      'definition',pg_get_constraintdef(oid)) order by conrelid,conname)
      from pg_constraint where connamespace='${f.name}'::regnamespace) as constraints,
    (select jsonb_agg(jsonb_build_object('table',tgrelid::regclass::text,'name',tgname,
      'enabled',tgenabled,'definition',pg_get_triggerdef(oid)) order by tgrelid,tgname)
      from pg_trigger where tgrelid in (select oid from pg_class
      where relnamespace='${f.name}'::regnamespace) and not tgisinternal) as triggers`)
  ).rows;
}

async function rejectedUnchanged(f: Fixture): Promise<void> {
  const before = await snapshot(f);
  await assert.rejects(f.admin.query(f.rewrite(p4)), { code: '55000' });
  await f.admin.query('rollback');
  assert.deepEqual(
    await snapshot(f),
    before,
    'failed P4 leaves all rows, definitions, ACLs and constraints unchanged',
  );
}

async function visible(f: Fixture, id: string): Promise<unknown> {
  await actor(f.first, id);
  const shares = (
    await f.first.query(`select schedule_entry_id,shared_with_user_id
    from ${f.name}.personal_schedule_shares order by schedule_entry_id,shared_with_user_id`)
  ).rows;
  const entries = (
    await f.first.query(`select id from ${f.name}.personal_schedule_entries order by id`)
  ).rows;
  await f.first.query('commit');
  return { shares, entries };
}

for (const legacyAcl of ['fresh', 'deployed'] as const) {
  for (const populated of [false, true]) {
    void test(`P4 actual SQL succeeds with ${legacyAcl} ACL and ${populated ? 'reciprocal legacy, third-party and bound shares' : 'zero shares'}`, async () =>
      fixture(
        async (f) => {
          const aclSql = `select proname,proacl::text from pg_proc where oid in
        ('${f.name}.is_personal_schedule_entry_owner(uuid)'::regprocedure,
         '${f.name}.list_schedule_share_recipient_emails(uuid)'::regprocedure) order by proname`;
          const readAcls = (await f.admin.query(aclSql)).rows;
          const rows = (
            await f.admin.query(`select * from ${f.name}.personal_schedule_shares order by id`)
          ).rows;
          const entries = (
            await f.admin.query(`select * from ${f.name}.personal_schedule_entries order by id`)
          ).rows;
          const contacts = (
            await f.admin.query(`select * from ${f.name}.schedule_contacts order by id`)
          ).rows;
          const views: Array<[string, unknown]> = [];
          for (const id of [f.a, f.b, f.c]) views.push([id, await visible(f, id)]);
          await f.admin.query(f.rewrite(p4));
          assert.deepEqual(
            (await f.admin.query(aclSql)).rows,
            readAcls,
            'both known legacy read ACL profiles are preserved exactly',
          );
          const after = (
            await f.admin.query(`select * from ${f.name}.personal_schedule_shares order by id`)
          ).rows;
          assert.deepEqual(
            after,
            rows.map(
              (row: {
                contact_id: string | null;
                shared_with_user_id: string;
                schedule_entry_id: string;
              }) => ({
                ...row,
                contact_id: row.contact_id ?? (row.shared_with_user_id === f.c ? f.ac : f.ab),
              }),
            ),
            'only NULL contact IDs change; complete row IDs and timestamps survive',
          );
          assert.deepEqual(
            (await f.admin.query(`select * from ${f.name}.personal_schedule_entries order by id`))
              .rows,
            entries,
          );
          assert.deepEqual(
            (await f.admin.query(`select * from ${f.name}.schedule_contacts order by id`)).rows,
            contacts,
            'no acceptance is synthesized',
          );
          for (const [id, before] of views) {
            assert.equal(typeof id, 'string');
            const afterView = await visible(f, String(id));
            assert.deepEqual(
              afterView,
              before,
              'entry and recipient-share visibility survives backfill',
            );
          }
          assert.deepEqual(
            (
              await f.admin.query(`select attnotnull from pg_attribute
      where attrelid='${f.name}.personal_schedule_shares'::regclass and attname='contact_id'`)
            ).rows,
            [{ attnotnull: true }],
          );
        },
        populated,
        legacyAcl,
      ));
  }
}

void test('P4 failure after real backfill and policy publication rolls the entire transaction back', async () =>
  fixture(async (f) => {
    const before = await snapshot(f);
    await f.admin.query('begin');
    await f.admin.query(f.rewrite(transactionBody(p4)));
    assert.equal(
      (
        await f.admin.query<{ n: number }>(
          `select count(*)::int n from ${f.name}.personal_schedule_shares where contact_id is null`,
        )
      ).rows[0]?.n,
      0,
    );
    await assert.rejects(
      f.admin.query("do $$ begin raise exception 'P4 injected failure'; end $$;"),
    );
    await f.admin.query('rollback');
    assert.deepEqual(await snapshot(f), before);
  }));

for (const bad of [
  'no-acceptance',
  'inactive-owner',
  'inactive-recipient',
  'self',
  'orphan-entry',
  'orphan-recipient',
  'orphan-owner',
  'stale-binding',
  'mismatched-binding',
] as const) {
  void test(`P4 data inventory fails closed: ${bad}`, async () =>
    fixture(async (f) => {
      if (bad === 'no-acceptance')
        await f.admin.query(`delete from ${f.name}.schedule_contacts where id=$1`, [f.ab]);
      else if (bad === 'inactive-owner' || bad === 'inactive-recipient')
        await f.admin.query(`update ${f.secret}.users set deleted_at=now() where id=$1`, [
          bad === 'inactive-owner' ? f.a : f.b,
        ]);
      else {
        await f.admin.query('begin');
        await f.admin.query("set local session_replication_role='replica'");
        if (bad === 'orphan-owner')
          await f.admin.query(
            `update ${f.name}.personal_schedule_entries set owner_id=$1 where id=$2`,
            [randomUUID(), f.entry],
          );
        else {
          const column =
            bad === 'orphan-entry'
              ? 'schedule_entry_id'
              : bad === 'stale-binding' || bad === 'mismatched-binding'
                ? 'contact_id'
                : 'shared_with_user_id';
          const value = bad === 'self' ? f.a : bad === 'mismatched-binding' ? f.ac : randomUUID();
          await f.admin.query(
            `update ${f.name}.personal_schedule_shares set ${column}=$1 where schedule_entry_id=$2 and shared_with_user_id=$3`,
            [value, f.entry, f.b],
          );
        }
        await f.admin.query('commit');
      }
      await rejectedUnchanged(f);
    }));
}

for (const drift of [
  'unknown-share-policy',
  'unknown-entry-policy',
  'share-policy',
  'entry-policy',
  'owner-helper',
  'owner-projection',
  'acceptance-body',
  'function-acl',
  'legacy-public-execute',
  'private-acl',
  'validator-disabled',
  'guard-disabled',
  'validator-conditional',
  'contact-fk-action',
  'contact-fk-unvalidated',
  'user-fk-unvalidated',
  'contact-pair-check',
  'contact-pair-unique',
  'rls-disabled',
  'write-grant',
  'read-helper-overload',
  'entry-owner-update',
  'entry-id-update',
  'contact-index-missing',
  'contact-id-fixed-default',
  'contact-id-no-default',
  'request-id-fixed-default',
  'request-id-no-default',
] as const) {
  void test(`P4 catalog inventory fails closed: ${drift}`, async () =>
    fixture(async (f) => {
      const mutations: Record<typeof drift, string> = {
        'unknown-share-policy': `create policy unexpected_read on ${f.name}.personal_schedule_shares for select to authenticated using(true)`,
        'unknown-entry-policy': `create policy unexpected_read on ${f.name}.personal_schedule_entries for select to authenticated using(true)`,
        'share-policy': `alter policy personal_schedule_shares_select_owner_or_recipient on ${f.name}.personal_schedule_shares using(true)`,
        'entry-policy': `alter policy personal_schedule_entries_select_owner_or_shared on ${f.name}.personal_schedule_entries using(true)`,
        'owner-helper': `alter function ${f.name}.is_personal_schedule_entry_owner(uuid) volatile`,
        'owner-projection': `alter function ${f.name}.list_schedule_share_recipient_emails(uuid) security invoker`,
        'acceptance-body': `create or replace function ${f.name}.accept_schedule_contact_request(p_request_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin return; end; $$`,
        'function-acl': `revoke execute on function ${f.name}.list_schedule_share_recipient_emails(uuid) from authenticated`,
        'legacy-public-execute': `grant execute on function ${f.name}.is_personal_schedule_entry_owner(uuid) to public`,
        'private-acl': `grant execute on function ${f.secret}.lock_schedule_contact_pair(uuid,uuid) to authenticated`,
        'validator-disabled': `alter table ${f.name}.personal_schedule_shares disable trigger personal_schedule_shares_validate_contact`,
        'guard-disabled': `alter table ${f.name}.personal_schedule_shares disable trigger personal_schedule_shares_require_contact`,
        'validator-conditional': `drop trigger personal_schedule_shares_validate_contact on ${f.name}.personal_schedule_shares; create trigger personal_schedule_shares_validate_contact before insert or update on ${f.name}.personal_schedule_shares for each row when(new.contact_id is not null) execute function ${f.secret}.validate_schedule_share_contact()`,
        'contact-fk-action': `alter table ${f.name}.personal_schedule_shares drop constraint personal_schedule_shares_contact_id_fkey, add constraint personal_schedule_shares_contact_id_fkey foreign key(contact_id) references ${f.name}.schedule_contacts(id)`,
        'contact-fk-unvalidated': `alter table ${f.name}.personal_schedule_shares drop constraint personal_schedule_shares_contact_id_fkey, add constraint personal_schedule_shares_contact_id_fkey foreign key(contact_id) references ${f.name}.schedule_contacts(id) on delete cascade not valid`,
        'user-fk-unvalidated': `alter table ${f.name}.personal_schedule_shares drop constraint personal_schedule_shares_shared_with_user_id_fkey, add constraint personal_schedule_shares_shared_with_user_id_fkey foreign key(shared_with_user_id) references ${f.secret}.users(id) on delete cascade not valid`,
        'contact-pair-check': `alter table ${f.name}.schedule_contacts drop constraint schedule_contacts_ordered_pair, add constraint schedule_contacts_ordered_pair check(user_low_id<>user_high_id)`,
        'contact-pair-unique': `alter table ${f.name}.schedule_contacts drop constraint schedule_contacts_pair_key`,
        'rls-disabled': `alter table ${f.name}.personal_schedule_shares disable row level security`,
        'write-grant': `grant update(contact_id) on ${f.name}.personal_schedule_shares to authenticated`,
        'read-helper-overload': `create function ${f.secret}.can_read_current_schedule_share(text) returns boolean language sql as $$ select true; $$`,
        'entry-owner-update': `grant update(owner_id) on ${f.name}.personal_schedule_entries to authenticated`,
        'entry-id-update': `grant update(id) on ${f.name}.personal_schedule_entries to authenticated`,
        'contact-index-missing': `drop index ${f.name}.personal_schedule_shares_contact_id_idx`,
        'contact-id-fixed-default': `alter table ${f.name}.schedule_contacts alter column id set default '${randomUUID()}'::uuid`,
        'contact-id-no-default': `alter table ${f.name}.schedule_contacts alter column id drop default`,
        'request-id-fixed-default': `alter table ${f.name}.schedule_contact_requests alter column id set default '${randomUUID()}'::uuid`,
        'request-id-no-default': `alter table ${f.name}.schedule_contact_requests alter column id drop default`,
      };
      await f.admin.query(mutations[drift]);
      await rejectedUnchanged(f);
    }));
}

void test('P4 rejects unexpected private-function default EXECUTE and rolls back the cutover', async () =>
  fixture(async (f) => {
    const role = `p4_acl_${randomUUID().replaceAll('-', '')}`;
    try {
      await f.admin.query(`create role ${role};
        grant usage on schema ${f.secret} to ${role};
        alter default privileges for role postgres in schema ${f.secret}
          grant execute on functions to ${role}`);
      await rejectedUnchanged(f);
    } finally {
      await f.admin.query('rollback');
      await f.admin.query(`alter default privileges for role postgres in schema ${f.secret}
          revoke execute on functions from ${role};
        revoke all privileges on all functions in schema ${f.secret} from ${role};
        revoke usage on schema ${f.secret} from ${role};
        drop role ${role}`);
    }
  }));

void test('P4 rejects EXECUTE grant options on a legacy read function', async () =>
  fixture(async (f) => {
    await f.admin.query(
      `grant execute on function ${f.name}.list_schedule_share_recipient_emails(uuid) to authenticated with grant option`,
    );
    await rejectedUnchanged(f);
  }));

for (const inherited of [false, true]) {
  void test(`P4 rejects ${inherited ? 'inherited anonymous' : 'unknown direct role'} EXECUTE on a legacy read function`, async () =>
    fixture(
      async (f) => {
        const role = `p4_acl_${randomUUID().replaceAll('-', '')}`;
        const fn = `${f.name}.list_schedule_share_recipient_emails(uuid)`;
        try {
          await f.admin.query(`create role ${role}`);
          await f.admin.query(`grant execute on function ${fn} to ${role}`);
          if (inherited) {
            await f.admin.query(`grant ${role} to anon`);
            assert.equal(
              (
                await f.admin.query<{ allowed: boolean }>(
                  `select has_function_privilege('anon',$1,'EXECUTE') allowed`,
                  [fn],
                )
              ).rows[0]?.allowed,
              true,
              'fixture establishes actual inherited EXECUTE beyond the deployed direct ACL',
            );
          }
          await rejectedUnchanged(f);
        } finally {
          await f.admin.query('rollback');
          if (inherited) await f.admin.query(`revoke ${role} from anon`);
          await f.admin.query(`revoke execute on function ${fn} from ${role}; drop role ${role}`);
        }
      },
      true,
      'deployed',
    ));
}

function settled(work: Promise<unknown>): Promise<unknown> {
  return work.catch((error: unknown) => error);
}

async function blocked(observer: pg.Client, loser: pg.Client, winner: pg.Client): Promise<void> {
  const winnerPid = (await winner.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]
    ?.pid;
  // Fetch the losing PID before launching the blocked query; caller passes
  // clients whose PID was cached by the initial connection handshake below.
  const loserPid = backendPids.get(loser);
  assert.ok(winnerPid && loserPid);
  const deadline = Date.now() + 5000;
  for (;;) {
    if (
      (
        await observer.query<{ blocked: boolean }>(
          'select $2::int=any(pg_blocking_pids($1)) blocked',
          [loserPid, winnerPid],
        )
      ).rows[0]?.blocked
    )
      return;
    assert.ok(Date.now() < deadline, 'must observe an actual PostgreSQL blocking edge');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

void test('P4 drains an already guarded RPC transaction before taking the account barrier', async () =>
  fixture(async (f) => {
    await actor(f.first, f.a);
    await f.first.query(`select ${f.name}.list_schedule_contacts()`);
    const applying = settled(f.second.query(f.rewrite(p4)));
    await blocked(f.admin, f.second, f.first);
    await f.first.query('commit');
    assert.ok(!((await applying) instanceof Error));
  }));

void test('P4 holds the account barrier before a later guarded RPC runs', async () =>
  fixture(async (f) => {
    await f.first.query('begin');
    await f.first.query(f.rewrite(transactionBody(p4)));
    await actor(f.second, f.a);
    const requesting = settled(f.second.query(`select ${f.name}.list_schedule_contacts()`));
    await blocked(f.admin, f.second, f.first);
    await f.first.query('commit');
    assert.ok(!((await requesting) instanceof Error));
    await f.second.query('commit');
  }));

void test('P4 NOWAIT breaks child-FK/account inversion without a deadlock or partial binding', async () =>
  fixture(async (f) => {
    const before = await snapshot(f);
    await f.first.query('begin');
    await f.first.query(`lock table ${f.secret}.users in exclusive mode`);
    await f.second.query('begin');
    const inserting = settled(
      f.second.query(
        `insert into ${f.name}.personal_schedule_entries
    (owner_id,title,is_all_day,starts_on,ends_on,blocking) values($1,'FK waiter',true,'2026-10-17','2026-10-17',false)`,
        [f.a],
      ),
    );
    await blocked(f.admin, f.second, f.first);
    await assert.rejects(f.first.query(f.rewrite(transactionBody(p4))), { code: '55P03' });
    await f.first.query('rollback');
    assert.ok(!((await inserting) instanceof Error));
    await f.second.query('rollback');
    assert.deepEqual(await snapshot(f), before);
  }));

void test('P4 NOWAIT safely aborts when a prior shares read precedes an actual share RPC at the account barrier', async () =>
  fixture(async (f) => {
    const before = await snapshot(f);
    await f.first.query('begin');
    await f.first.query(`lock table ${f.secret}.users in exclusive mode`);
    await actor(f.second, f.a);
    // A caller can read its current recipients before sharing in the same
    // transaction. This holds the observed AccessShare lock while the actual
    // guarded RPC waits for users, rather than inventing a pre-lock in its body.
    await f.second.query(
      `select * from ${f.name}.personal_schedule_shares where schedule_entry_id=$1`,
      [f.bound],
    );
    const sharing = settled(
      f.second.query(`select ${f.name}.share_schedule_entry_with_contact($1,$2)`, [f.bound, f.ab]),
    );
    await blocked(f.admin, f.second, f.first);
    assert.equal(
      (
        await f.admin.query<{ waiting: boolean }>(
          `select exists(select 1 from pg_locks
    where pid=$1 and relation=$2::regclass and not granted) waiting`,
          [backendPids.get(f.second), `${f.secret}.users`],
        )
      ).rows[0]?.waiting,
      true,
    );
    await assert.rejects(f.first.query(f.rewrite(transactionBody(p4))), { code: '55P03' });
    await f.first.query('rollback');
    const result = await sharing;
    if (result instanceof Error) throw result;
    await f.second.query('rollback');
    assert.deepEqual(
      await snapshot(f),
      before,
      'NOWAIT inversion failure rolls back every P4 change',
    );
  }));

for (const operation of ['share', 'unlink', 'accept', 'account-delete'] as const) {
  for (const migrationFirst of [false, true]) {
    void test(`P4 account barrier/${operation} with ${migrationFirst ? 'P4' : 'operation'} first`, async () =>
      fixture(async (f) => {
        let request: string | undefined;
        const shareEntry = randomUUID();
        if (operation === 'share')
          await f.admin.query(
            `insert into ${f.name}.personal_schedule_entries
          (id,owner_id,title,is_all_day,starts_on,ends_on,blocking)
          values($1,$2,'new concurrent share',true,'2026-10-17','2026-10-17',true)`,
            [shareEntry, f.a],
          );
        if (operation === 'accept') {
          await actor(f.first, f.b);
          await f.first.query(
            `select ${f.name}.request_schedule_contact_by_email('c@example.test')`,
          );
          await f.first.query('commit');
          request = (
            await f.admin.query<{ id: string }>(
              `select id from ${f.name}.schedule_contact_requests where requester_id=$1 and recipient_id=$2`,
              [f.b, f.c],
            )
          ).rows[0]?.id;
          assert.ok(request);
        }
        async function beginOperation(client: pg.Client): Promise<void> {
          if (operation === 'account-delete') await client.query('begin');
          else await actor(client, operation === 'accept' ? f.c : f.a);
        }
        function perform(client: pg.Client): Promise<pg.QueryResult> {
          if (operation === 'account-delete')
            return client.query(`delete from ${f.secret}.users where id=$1`, [f.b]);
          if (operation === 'share')
            return client.query(`select ${f.name}.share_schedule_entry_with_contact($1,$2)`, [
              shareEntry,
              f.ab,
            ]);
          if (operation === 'unlink')
            return client.query(`select ${f.name}.unlink_schedule_contact($1)`, [f.ab]);
          return client.query(`select ${f.name}.accept_schedule_contact_request($1)`, [request]);
        }
        if (migrationFirst) {
          await f.first.query('begin');
          await f.first.query(f.rewrite(transactionBody(p4)));
          await beginOperation(f.second);
          const pending = settled(perform(f.second));
          await blocked(f.admin, f.second, f.first);
          // A cold composite return type can lock the shares relation before
          // the RPC reaches require_schedule_contact_registration(). Both
          // waits are real P4 locks; the other operations reach the users gate.
          assert.equal(
            (
              await f.admin.query<{ waiting: boolean }>(
                `select exists(select 1 from pg_locks
          where pid=$1 and relation in($2::regclass,$3::regclass) and not granted) waiting`,
                [
                  backendPids.get(f.second),
                  `${f.secret}.users`,
                  operation === 'share'
                    ? `${f.name}.personal_schedule_shares`
                    : `${f.secret}.users`,
                ],
              )
            ).rows[0]?.waiting,
            true,
            'later operation must wait on the observed P4 account or composite-type relation lock',
          );
          await f.first.query('commit');
          const result = await pending;
          if (result instanceof Error) throw result;
          await f.second.query('commit');
        } else {
          await beginOperation(f.first);
          await perform(f.first);
          const pending = settled(f.second.query(f.rewrite(p4)));
          await blocked(f.admin, f.second, f.first);
          assert.equal(
            (
              await f.admin.query<{ waiting: boolean }>(
                `select exists(select 1 from pg_locks
          where pid=$1 and relation=$2::regclass and mode='ExclusiveLock' and not granted) waiting`,
                [backendPids.get(f.second), `${f.secret}.users`],
              )
            ).rows[0]?.waiting,
            true,
            'P4 must drain the preexisting account-locking transaction',
          );
          await f.first.query('commit');
          const result = await pending;
          if (result instanceof Error) throw result;
        }
        const count = (
          await f.admin.query<{
            shares: number;
            contacts: number;
            nulls: number;
            owners: number;
            third_party: number;
          }>(
            `select
        (select count(*)::int from ${f.name}.personal_schedule_shares) shares,
        (select count(*)::int from ${f.name}.schedule_contacts) contacts,
        (select count(*)::int from ${f.name}.personal_schedule_shares where contact_id is null) nulls,
        (select count(*)::int from ${f.name}.personal_schedule_entries where owner_id=$1) owners,
        (select count(*)::int from ${f.name}.personal_schedule_shares where schedule_entry_id=$2 and shared_with_user_id=$3) third_party`,
            [f.a, f.entry, f.c],
          )
        ).rows[0];
        assert.deepEqual(count, {
          shares:
            operation === 'unlink' || operation === 'account-delete'
              ? 1
              : operation === 'share'
                ? 5
                : 4,
          contacts: operation === 'accept' ? 3 : operation === 'share' ? 2 : 1,
          nulls: 0,
          owners: operation === 'share' ? 3 : 2,
          third_party: 1,
        });
        if (operation === 'account-delete')
          assert.equal(
            (
              await f.admin.query<{ n: number }>(
                `select count(*)::int n from ${f.name}.personal_schedule_entries where owner_id=$1`,
                [f.b],
              )
            ).rows[0]?.n,
            0,
            'deleted owner schedule lifecycle cascades independently',
          );
        if (operation === 'accept')
          assert.equal(
            (
              await f.admin.query<{ n: number }>(
                `select count(*)::int n from ${f.name}.schedule_contact_requests where id=$1`,
                [request],
              )
            ).rows[0]?.n,
            0,
            'accepted request generation is consumed exactly once',
          );
      }));
  }
}

for (const operation of [
  'read-shares',
  'read-entries',
  'delete-entry',
  'owner-revoke',
  'recipient-leave',
] as const) {
  for (const migrationFirst of [false, true]) {
    void test(`P4/${operation} lock order with ${migrationFirst ? 'P4' : 'operation'} first`, async () =>
      fixture(async (f) => {
        const owner = operation === 'recipient-leave' ? f.b : f.a;
        async function run(client: pg.Client): Promise<pg.QueryResult> {
          if (operation === 'read-shares')
            return client.query(`select * from ${f.name}.personal_schedule_shares`);
          if (operation === 'read-entries')
            return client.query(`select * from ${f.name}.personal_schedule_entries`);
          if (operation === 'delete-entry')
            return client.query(`delete from ${f.name}.personal_schedule_entries where id=$1`, [
              f.entry,
            ]);
          return client.query(
            `delete from ${f.name}.personal_schedule_shares where schedule_entry_id=$1 and shared_with_user_id=$2`,
            [f.entry, f.b],
          );
        }
        if (migrationFirst) {
          await f.first.query('begin');
          await f.first.query(f.rewrite(transactionBody(p4)));
          await actor(f.second, owner);
          const pending = settled(run(f.second));
          await blocked(f.admin, f.second, f.first);
          await f.first.query('commit');
          assert.ok(!((await pending) instanceof Error));
          await f.second.query('commit');
        } else {
          await actor(f.first, owner);
          await run(f.first);
          const before = await snapshot(f);
          await assert.rejects(f.second.query(f.rewrite(p4)), { code: '55P03' });
          await f.second.query('rollback');
          assert.deepEqual(await snapshot(f), before);
          await f.first.query('commit');
          await f.admin.query(f.rewrite(p4));
        }
        assert.equal(
          (
            await f.admin.query<{ n: number }>(
              `select count(*)::int n from ${f.name}.schedule_contacts`,
            )
          ).rows[0]?.n,
          2,
          'individual removal preserves accepted contacts',
        );
        if (operation === 'owner-revoke' || operation === 'recipient-leave') {
          assert.equal(
            (
              await f.admin.query<{ n: number }>(
                `select count(*)::int n from ${f.name}.personal_schedule_shares where schedule_entry_id=$1 and shared_with_user_id=$2`,
                [f.entry, f.b],
              )
            ).rows[0]?.n,
            0,
          );
          assert.equal(
            (
              await f.admin.query<{ n: number }>(
                `select count(*)::int n from ${f.name}.personal_schedule_shares where schedule_entry_id=$1 and shared_with_user_id=$2`,
                [f.entry, f.c],
              )
            ).rows[0]?.n,
            1,
            'third-party share survives',
          );
        }
      }));
  }
}
