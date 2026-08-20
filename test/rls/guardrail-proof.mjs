// One-off, manually-run guardrail proof (Issue #3 "Guardrail proof").
//
// This is deliberately NOT part of `npm run test:rls` / blocking verify: it
// temporarily breaks real RLS policies and grants against the local
// database to prove the corresponding negative tests actually depend on
// them (would go red without them), then restores everything. Run it
// manually against a running local Supabase (`npm run db:start` /
// `npm run db:reset` first) and capture the output as PR evidence.
//
// Uses a direct superuser Postgres connection (from `supabase status`'s
// DB_URL) for the fault injection itself - this is the admin/fault-
// injection path, not the RLS assertion path. Each assertion below still
// goes through anon-key clients exactly like test/rls/events.test.ts.

import assert from 'node:assert/strict';
import pg from 'pg';
import { createTestActor, deleteTestActor } from './support/testActors.ts';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';

const status = readLocalSupabaseStatus();

function eventPayload(ownerId) {
  return {
    owner_id: ownerId,
    title: `guardrail proof event ${Date.now()}-${Math.random().toString(36).slice(2)}`,
    starts_at: new Date().toISOString(),
  };
}

async function withPgClient(run) {
  const client = new pg.Client({ connectionString: status.dbUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function withBrokenPolicy(policyName, breakSql, restoreSql, proveRedBehavior) {
  console.log(`\n--- breaking ${policyName} ---`);
  try {
    // breakSql runs inside this try, so a failure partway through a
    // multi-statement break (e.g. connection drop) still attempts restore
    // rather than leaving real local RLS state broken.
    await withPgClient((client) => client.query(breakSql));
    await proveRedBehavior();
    console.log(
      `OK: negative test for ${policyName} goes red without the real policy, as expected.`,
    );
  } finally {
    // Restore through a fresh connection: a break-time failure (e.g. a
    // dropped connection, or an aborted transaction from a failed
    // statement) can leave the connection that ran breakSql unusable for a
    // further query.
    await withPgClient((client) => client.query(restoreSql));
    console.log(`restored ${policyName}`);
  }
}

let actorA;
let actorB;

try {
  actorA = await createTestActor('guardrail-a', 'Str0ng-Test-Passw0rd!');
  actorB = await createTestActor('guardrail-b', 'Str0ng-Test-Passw0rd!');

  // 1. events_select_authenticated: without it, RLS default-denies SELECT
  // for authenticated too, so "authenticated user can read another user's
  // event" must start returning zero rows. The fixture row is created
  // before the policy is broken, since INSERT's RETURNING also needs
  // SELECT visibility.
  {
    const { data: created, error: fixtureError } = await actorA.client
      .from('events')
      .insert(eventPayload(actorA.user.id))
      .select()
      .single();
    if (fixtureError || !created) {
      throw new Error(`fixture insert failed: ${fixtureError?.message}`);
    }
    await withBrokenPolicy(
      'events_select_authenticated',
      'drop policy events_select_authenticated on public.events;',
      `create policy events_select_authenticated on public.events
         for select to authenticated using (true);`,
      async () => {
        const { data } = await actorB.client.from('events').select().eq('id', created.id);
        assert.deepEqual(
          data,
          [],
          'expected read to go red (empty) with the select policy dropped',
        );
      },
    );
  }

  // 2. events_insert_own: replacing its WITH CHECK with `true` must let
  // owner spoofing succeed, proving "user A cannot create an event owned by
  // user B" depends on this policy.
  await withBrokenPolicy(
    'events_insert_own',
    `drop policy events_insert_own on public.events;
     create policy events_insert_own on public.events
       for insert to authenticated with check (true);`,
    `drop policy events_insert_own on public.events;
     create policy events_insert_own on public.events
       for insert to authenticated with check (owner_id = auth.uid());`,
    async () => {
      const { data, error } = await actorA.client
        .from('events')
        .insert(eventPayload(actorB.user.id))
        .select()
        .single();
      assert.equal(
        error,
        null,
        'expected owner spoofing to go red (succeed) with the insert policy broken',
      );
      assert.equal(data.owner_id, actorB.user.id);
    },
  );

  // 3. events_update_own: replacing USING/WITH CHECK with `true` must let a
  // non-owner update succeed, proving "user B cannot update user A's event"
  // depends on this policy.
  await withBrokenPolicy(
    'events_update_own',
    `drop policy events_update_own on public.events;
     create policy events_update_own on public.events
       for update to authenticated using (true) with check (true);`,
    `drop policy events_update_own on public.events;
     create policy events_update_own on public.events
       for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());`,
    async () => {
      const { data: created } = await actorA.client
        .from('events')
        .insert(eventPayload(actorA.user.id))
        .select()
        .single();
      const { data, error } = await actorB.client
        .from('events')
        .update({ title: 'hijacked while policy is broken' })
        .eq('id', created.id)
        .select();
      assert.equal(error, null);
      assert.equal(
        data.length,
        1,
        'expected non-owner update to go red (succeed) with the update policy broken',
      );
    },
  );

  // 4. owner_id column grant: owner transfer is actually blocked by two
  // independent layers (RLS's WITH CHECK on owner_id, and the column-level
  // UPDATE grant that excludes owner_id). To isolate and prove the grant
  // layer specifically, both must be broken together here - breaking only
  // the grant (leaving WITH CHECK intact) still correctly denies the
  // transfer, which is defense-in-depth working as designed, not a gap.
  await withBrokenPolicy(
    'events owner_id column grant (with RLS WITH CHECK also relaxed)',
    `drop policy events_update_own on public.events;
     create policy events_update_own on public.events
       for update to authenticated using (owner_id = auth.uid()) with check (true);
     grant update (owner_id) on public.events to authenticated;`,
    `revoke update (owner_id) on public.events from authenticated;
     drop policy events_update_own on public.events;
     create policy events_update_own on public.events
       for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());`,
    async () => {
      const { data: created } = await actorA.client
        .from('events')
        .insert(eventPayload(actorA.user.id))
        .select()
        .single();
      const { data, error } = await actorA.client
        .from('events')
        .update({ owner_id: actorB.user.id })
        .eq('id', created.id)
        .select()
        .single();
      assert.equal(
        error,
        null,
        'expected owner transfer to go red (succeed) with both the grant and WITH CHECK relaxed',
      );
      assert.equal(data.owner_id, actorB.user.id);
    },
  );

  console.log(
    '\nAll guardrail proofs complete. Every broken mechanism produced red behavior, and all were restored.',
  );
} finally {
  // Only clean up actors that were actually created, and don't let one
  // actor's cleanup failure prevent the other's from being attempted.
  await Promise.all(
    [actorA, actorB]
      .filter((actor) => actor !== undefined)
      .map((actor) =>
        deleteTestActor(actor).catch((error) => {
          console.error(`cleanup failed for test user ${actor.user.id}: ${error.message}`);
        }),
      ),
  );
}
