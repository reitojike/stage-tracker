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

// Direct authenticated INSERT into events is unsupported since Issue #17;
// create_event_with_occurrence is the only supported create path, so every
// fixture event below goes through it instead of `.insert()`.
async function createEventAsOwner(client) {
  const { data, error } = await client.rpc('create_event_with_occurrence', {
    p_title: `guardrail proof event ${Date.now()}-${Math.random().toString(36).slice(2)}`,
    p_starts_at: new Date().toISOString(),
  });
  if (error || !data) {
    throw new Error(`fixture create_event_with_occurrence failed: ${error?.message}`);
  }
  return data;
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
let primaryError;

try {
  actorA = await createTestActor('guardrail-a', 'Str0ng-Test-Passw0rd!');
  actorB = await createTestActor('guardrail-b', 'Str0ng-Test-Passw0rd!');

  // 1. events_select_authenticated: without it, RLS default-denies SELECT
  // for authenticated too, so "authenticated user can read another user's
  // event" must start returning zero rows. The fixture row is created
  // before the policy is broken, since the RPC's RETURNING also needs
  // SELECT visibility.
  {
    const created = await createEventAsOwner(actorA.client);
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

  // 2. Direct authenticated INSERT into events is blocked primarily by the
  // revoked table grant (Issue #17), with events_insert_own's WITH CHECK
  // kept as defense-in-depth. Breaking the grant alone would not go red
  // (WITH CHECK would still block a spoofed owner_id), so - mirroring item
  // 4 below - both layers are relaxed together here to prove that
  // "authenticated client cannot directly INSERT into events" actually
  // depends on this combination, not on some other mechanism.
  await withBrokenPolicy(
    'events INSERT grant + events_insert_own (relaxed together)',
    `grant insert (owner_id, title, venue, source_url, memo) on public.events to authenticated;
     drop policy events_insert_own on public.events;
     create policy events_insert_own on public.events
       for insert to authenticated with check (true);`,
    `revoke insert on public.events from authenticated;
     drop policy events_insert_own on public.events;
     create policy events_insert_own on public.events
       for insert to authenticated with check (owner_id = auth.uid());`,
    async () => {
      const { data, error } = await actorA.client
        .from('events')
        .insert({
          owner_id: actorB.user.id,
          title: `guardrail proof direct insert ${Date.now()}`,
        })
        .select()
        .single();
      assert.equal(
        error,
        null,
        'expected direct INSERT (with a spoofed owner_id) to go red (succeed) with both layers relaxed',
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
      const created = await createEventAsOwner(actorA.client);
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
      const created = await createEventAsOwner(actorA.client);
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

  // 5. create_event_with_occurrence's EXECUTE grant to authenticated: this
  // is the only thing letting a normal client reach the RPC at all (the
  // function itself runs SECURITY DEFINER regardless). Revoking it must
  // make even a legitimate, non-spoofing call fail.
  await withBrokenPolicy(
    'create_event_with_occurrence EXECUTE grant',
    `revoke execute on function public.create_event_with_occurrence(
       text, timestamptz, text, timestamptz, text, text
     ) from authenticated;`,
    `grant execute on function public.create_event_with_occurrence(
       text, timestamptz, text, timestamptz, text, text
     ) to authenticated;`,
    async () => {
      const { error } = await actorA.client.rpc('create_event_with_occurrence', {
        p_title: `guardrail proof rpc execute ${Date.now()}`,
        p_starts_at: new Date().toISOString(),
      });
      assert.ok(error, 'expected the create RPC to go red (denied) with its EXECUTE grant revoked');
    },
  );

  console.log(
    '\nAll guardrail proofs complete. Every broken mechanism produced red behavior, and all were restored.',
  );
} catch (error) {
  // Captured explicitly, rather than left to propagate straight out of this
  // try, so a cleanup failure in the finally block below can't silently
  // discard it: a guardrail assertion failing here is exactly the signal
  // this script exists to surface (a policy that should have gone red
  // didn't), and standard try/finally semantics would let an unconditional
  // throw in finally erase it.
  primaryError = error;
} finally {
  // Attempt cleanup for every actor that was actually created, even if one
  // fails, but still exit non-zero if any cleanup failed - a silently-
  // swallowed cleanup failure would leave stale users/events behind while
  // reporting success.
  const results = await Promise.allSettled(
    [actorA, actorB].filter((actor) => actor !== undefined).map((actor) => deleteTestActor(actor)),
  );
  const failures = results.filter((result) => result.status === 'rejected');
  const cleanupError =
    failures.length > 0
      ? new Error(
          `test actor cleanup failed:\n${failures
            .map((failure) =>
              failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
            )
            .join('\n')}`,
        )
      : undefined;

  if (primaryError && cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      'guardrail proof failed, and test actor cleanup also failed',
    );
  }
  if (primaryError) {
    throw primaryError;
  }
  if (cleanupError) {
    throw cleanupError;
  }
}
