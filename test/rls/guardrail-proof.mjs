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
import {
  createTestActor,
  deleteTestActor,
  grantCatalogCreator,
  revokeCatalogCreator,
} from './support/testActors.ts';
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

// Issue #31: personal_schedule_entries has no atomicity invariant, so a
// plain INSERT (unlike events' RPC) is the fixture create path. Takes the
// full actor (not just its client) because, unlike create_event_with_
// occurrence, owner_id here is an explicit column the caller supplies.
async function createScheduleEntryAsOwner(actor) {
  const startsOn = new Date().toISOString().slice(0, 10);
  const { data, error } = await actor.client
    .from('personal_schedule_entries')
    .insert({
      owner_id: actor.user.id,
      schedule_type: 'other',
      is_all_day: true,
      starts_on: startsOn,
      ends_on: startsOn,
    })
    .select()
    .single();
  if (error || !data) {
    throw new Error(`fixture personal_schedule_entries insert failed: ${error?.message}`);
  }
  return data;
}

// Issue #30: an occurrence the given actor is attending, i.e. the state
// every participation/invitation guardrail below starts from. The event is
// created by the actor themselves only because create_event_with_occurrence
// is the supported create path - event ownership confers no invite right,
// so it is irrelevant to what these proofs are testing.
async function createAttendedOccurrence(actor, visibility) {
  const event = await createEventAsOwner(actor.client);
  const { data: occurrences, error: occurrencesError } = await actor.client
    .from('event_occurrences')
    .select()
    .eq('event_id', event.id);
  if (occurrencesError || occurrences.length !== 1) {
    throw new Error(
      `fixture occurrence lookup failed for event ${event.id}: ${occurrencesError?.message ?? `found ${occurrences?.length}`}`,
    );
  }
  const occurrenceId = occurrences[0].id;

  const { data: participation, error } = await actor.client
    .from('occurrence_participations')
    .insert({
      occurrence_id: occurrenceId,
      user_id: actor.user.id,
      status: 'attending',
      visibility,
    })
    .select()
    .single();
  if (error || !participation) {
    throw new Error(`fixture participation insert failed: ${error?.message}`);
  }
  return { occurrenceId, participation };
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
let stranger;
let primaryError;

try {
  // actorA creates every fixture event, so it holds designated catalog
  // creator membership (Issue #29). actorB deliberately does not - the
  // creator gate item below injects that membership temporarily to prove
  // the create denial actually depends on it.
  actorA = await createTestActor('guardrail-a', 'Str0ng-Test-Passw0rd!', {
    designatedCatalogCreator: true,
  });
  actorB = await createTestActor('guardrail-b', 'Str0ng-Test-Passw0rd!');
  stranger = await createTestActor('guardrail-stranger', 'Str0ng-Test-Passw0rd!');

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
    // The restore below re-creates events_insert_own with its *current*
    // definition, which since Issue #29 also requires designated catalog
    // creator membership. Restoring the pre-#29 definition here would
    // silently drop that layer from the local database after this script
    // ran - a fault injection that quietly leaves a hole behind is worse
    // than no proof at all.
    `revoke insert on public.events from authenticated;
     drop policy events_insert_own on public.events;
     create policy events_insert_own on public.events
       for insert to authenticated with check (
         owner_id = auth.uid()
         and exists (
           select 1 from public.catalog_creators cc where cc.user_id = auth.uid()
         )
       );`,
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

  // 6. event_occurrences_select_authenticated: without it, RLS
  // default-denies SELECT for authenticated too, so "authenticated user
  // can read another owner's occurrence" must start returning zero rows.
  {
    const created = await createEventAsOwner(actorA.client);
    const { data: occurrence, error: occurrenceError } = await actorA.client
      .from('event_occurrences')
      .select()
      .eq('event_id', created.id)
      .single();
    if (occurrenceError || !occurrence) {
      throw new Error(`fixture occurrence lookup failed: ${occurrenceError?.message}`);
    }
    await withBrokenPolicy(
      'event_occurrences_select_authenticated',
      'drop policy event_occurrences_select_authenticated on public.event_occurrences;',
      `create policy event_occurrences_select_authenticated on public.event_occurrences
         for select to authenticated using (true);`,
      async () => {
        const { data } = await actorB.client
          .from('event_occurrences')
          .select()
          .eq('id', occurrence.id);
        assert.deepEqual(
          data,
          [],
          'expected read to go red (empty) with the select policy dropped',
        );
      },
    );
  }

  // 7. event_occurrences_insert_own: replacing its WITH CHECK with `true`
  // must let a non-owner insert an occurrence for someone else's event,
  // proving "non-owner cannot insert an occurrence for someone else's
  // event" depends on this policy.
  await withBrokenPolicy(
    'event_occurrences_insert_own',
    `drop policy event_occurrences_insert_own on public.event_occurrences;
     create policy event_occurrences_insert_own on public.event_occurrences
       for insert to authenticated with check (true);`,
    `drop policy event_occurrences_insert_own on public.event_occurrences;
     create policy event_occurrences_insert_own on public.event_occurrences
       for insert to authenticated with check (
         exists (
           select 1 from public.events e
           where e.id = event_id and e.owner_id = auth.uid()
         )
       );`,
    async () => {
      const created = await createEventAsOwner(actorA.client);
      const { data, error } = await actorB.client
        .from('event_occurrences')
        .insert({ event_id: created.id, starts_at: new Date().toISOString() })
        .select()
        .single();
      assert.equal(
        error,
        null,
        'expected a non-owner occurrence insert to go red (succeed) with the insert policy broken',
      );
      assert.equal(data.event_id, created.id);
    },
  );

  // 8. event_occurrences_update_own: replacing USING/WITH CHECK with `true`
  // must let a non-owner update someone else's occurrence, proving
  // "non-owner cannot update an occurrence" depends on this policy.
  await withBrokenPolicy(
    'event_occurrences_update_own',
    `drop policy event_occurrences_update_own on public.event_occurrences;
     create policy event_occurrences_update_own on public.event_occurrences
       for update to authenticated using (true) with check (true);`,
    `drop policy event_occurrences_update_own on public.event_occurrences;
     create policy event_occurrences_update_own on public.event_occurrences
       for update to authenticated using (
         exists (
           select 1 from public.events e
           where e.id = event_id and e.owner_id = auth.uid()
         )
       )
       with check (
         exists (
           select 1 from public.events e
           where e.id = event_id and e.owner_id = auth.uid()
         )
       );`,
    async () => {
      const created = await createEventAsOwner(actorA.client);
      const { data: occurrence, error: occurrenceError } = await actorA.client
        .from('event_occurrences')
        .select()
        .eq('event_id', created.id)
        .single();
      if (occurrenceError || !occurrence) {
        throw new Error(`fixture occurrence lookup failed: ${occurrenceError?.message}`);
      }
      const { data, error } = await actorB.client
        .from('event_occurrences')
        .update({ starts_at: new Date(0).toISOString() })
        .eq('id', occurrence.id)
        .select();
      assert.equal(error, null);
      assert.equal(
        data.length,
        1,
        'expected a non-owner occurrence update to go red (succeed) with the update policy broken',
      );
    },
  );

  // 9. event_id column grant: reassigning an occurrence to a different
  // parent event is actually blocked by two independent layers (RLS's
  // WITH CHECK re-evaluating ownership of the *new* event_id, and the
  // column-level UPDATE grant that excludes event_id entirely). Mirroring
  // item 4's owner_id case, both must be broken together here - breaking
  // only the grant (leaving WITH CHECK intact) would still correctly deny
  // reassignment to an event the caller doesn't own, which is
  // defense-in-depth working as designed, not a gap.
  await withBrokenPolicy(
    'event_occurrences event_id column grant (with RLS WITH CHECK also relaxed)',
    `drop policy event_occurrences_update_own on public.event_occurrences;
     create policy event_occurrences_update_own on public.event_occurrences
       for update to authenticated using (
         exists (
           select 1 from public.events e
           where e.id = event_id and e.owner_id = auth.uid()
         )
       ) with check (true);
     grant update (event_id) on public.event_occurrences to authenticated;`,
    `revoke update (event_id) on public.event_occurrences from authenticated;
     drop policy event_occurrences_update_own on public.event_occurrences;
     create policy event_occurrences_update_own on public.event_occurrences
       for update to authenticated using (
         exists (
           select 1 from public.events e
           where e.id = event_id and e.owner_id = auth.uid()
         )
       )
       with check (
         exists (
           select 1 from public.events e
           where e.id = event_id and e.owner_id = auth.uid()
         )
       );`,
    async () => {
      const createdA = await createEventAsOwner(actorA.client);
      const createdA2 = await createEventAsOwner(actorA.client);
      const { data: occurrence, error: occurrenceError } = await actorA.client
        .from('event_occurrences')
        .select()
        .eq('event_id', createdA.id)
        .single();
      if (occurrenceError || !occurrence) {
        throw new Error(`fixture occurrence lookup failed: ${occurrenceError?.message}`);
      }
      const { data, error } = await actorA.client
        .from('event_occurrences')
        .update({ event_id: createdA2.id })
        .eq('id', occurrence.id)
        .select()
        .single();
      assert.equal(
        error,
        null,
        'expected occurrence reassignment to go red (succeed) with both the grant and WITH CHECK relaxed',
      );
      assert.equal(data.event_id, createdA2.id);
    },
  );

  // 10. personal_schedule_entries_select_owner_or_shared (Issue #31):
  // without it, RLS default-denies SELECT entirely (there is no
  // `using (true)` catch-all on this table, unlike events), so even the
  // owner would lose read access. Restoring to `using (true)` instead
  // proves the opposite direction: that the private-by-default boundary
  // (a stranger with no share cannot read) actually depends on this
  // policy's owner-or-shared condition, not on some other mechanism.
  {
    const created = await createScheduleEntryAsOwner(actorA);
    await withBrokenPolicy(
      'personal_schedule_entries_select_owner_or_shared',
      `drop policy personal_schedule_entries_select_owner_or_shared on public.personal_schedule_entries;
       create policy personal_schedule_entries_select_owner_or_shared
         on public.personal_schedule_entries for select to authenticated using (true);`,
      `drop policy personal_schedule_entries_select_owner_or_shared on public.personal_schedule_entries;
       create policy personal_schedule_entries_select_owner_or_shared
         on public.personal_schedule_entries for select to authenticated using (
           owner_id = auth.uid()
           or exists (
             select 1 from public.personal_schedule_shares s
             where s.schedule_entry_id = personal_schedule_entries.id
               and s.shared_with_user_id = auth.uid()
           )
         );`,
      async () => {
        const { data } = await actorB.client
          .from('personal_schedule_entries')
          .select()
          .eq('id', created.id);
        assert.equal(
          data?.length,
          1,
          'expected a stranger with no share to go red (able to read) with the select policy broken',
        );
      },
    );
  }

  // 11. personal_schedule_entries_insert_own: replacing its WITH CHECK with
  // `true` must let a caller insert an entry with a spoofed owner_id,
  // proving "owner_id cannot be spoofed on insert" depends on this policy.
  await withBrokenPolicy(
    'personal_schedule_entries_insert_own',
    `drop policy personal_schedule_entries_insert_own on public.personal_schedule_entries;
     create policy personal_schedule_entries_insert_own
       on public.personal_schedule_entries for insert to authenticated with check (true);`,
    `drop policy personal_schedule_entries_insert_own on public.personal_schedule_entries;
     create policy personal_schedule_entries_insert_own
       on public.personal_schedule_entries for insert to authenticated with check (owner_id = auth.uid());`,
    async () => {
      const startsOn = new Date().toISOString().slice(0, 10);
      // Unique per-run so the direct-connection existence check below
      // can't match some other fixture row actorA happens to own with the
      // same shape (e.g. from guardrail item 10 above), which would make
      // this assertion pass or fail for the wrong reason.
      const marker = `guardrail-proof spoofed-owner marker ${Date.now()}-${Math.random().toString(36).slice(2)}`;
      // No .select() here: personal_schedule_entries' SELECT policy
      // (owner-or-shared, private-by-default) is independent of this
      // INSERT policy and stays intact throughout this proof, so a
      // RETURNING clause would correctly deny actorB visibility of a row
      // it just spoofed to actorA's ownership - entangling that unrelated,
      // unbroken SELECT policy into this INSERT-only proof via .select()
      // would fail this assertion for the wrong reason (RLS still working,
      // just on a different policy than the one under test).
      const { error } = await actorB.client.from('personal_schedule_entries').insert({
        owner_id: actorA.user.id,
        schedule_type: 'other',
        memo: marker,
        is_all_day: true,
        starts_on: startsOn,
        ends_on: startsOn,
      });
      assert.equal(
        error,
        null,
        'expected a spoofed-owner insert to go red (succeed) with the insert policy broken',
      );

      // Confirm the spoofed row actually landed via a direct (RLS-
      // bypassing) connection instead, since actorB's own client can never
      // read it back.
      const spoofedRow = await withPgClient((client) =>
        client.query(
          `select 1 from public.personal_schedule_entries where owner_id = $1 and memo = $2`,
          [actorA.user.id, marker],
        ),
      );
      assert.equal(
        spoofedRow.rowCount,
        1,
        'expected the spoofed-owner row to actually exist once the insert policy is broken',
      );
    },
  );

  // 12. personal_schedule_entries_update_own: replacing USING/WITH CHECK
  // with `true` must let a recipient the entry was shared with update
  // someone else's entry, proving "a recipient cannot update the shared
  // entry" depends on this policy, not merely on the UI. The fixture below
  // must actually share the entry with actorB first: for UPDATE, Postgres
  // requires a row to also pass the table's SELECT policy (not just the
  // UPDATE policy's own USING clause) before it can even be found to
  // update - an actorB with no share at all has no SELECT visibility into
  // actorA's private entry regardless of this policy, so the UPDATE would
  // silently match zero rows even with this policy fully broken, proving
  // nothing about the policy under test.
  await withBrokenPolicy(
    'personal_schedule_entries_update_own',
    `drop policy personal_schedule_entries_update_own on public.personal_schedule_entries;
     create policy personal_schedule_entries_update_own
       on public.personal_schedule_entries for update to authenticated using (true) with check (true);`,
    `drop policy personal_schedule_entries_update_own on public.personal_schedule_entries;
     create policy personal_schedule_entries_update_own
       on public.personal_schedule_entries for update to authenticated
       using (owner_id = auth.uid()) with check (owner_id = auth.uid());`,
    async () => {
      const created = await createScheduleEntryAsOwner(actorA);
      const { error: shareError } = await actorA.client
        .from('personal_schedule_shares')
        .insert({ schedule_entry_id: created.id, shared_with_user_id: actorB.user.id });
      if (shareError) {
        throw new Error(`fixture share insert failed: ${shareError.message}`);
      }
      const hijackedMemo = `hijacked while policy is broken ${Date.now()}-${Math.random().toString(36).slice(2)}`;
      // No .select() here, for the same reason as guardrail item 11 above:
      // personal_schedule_entries' SELECT policy stays intact throughout,
      // and a RETURNING clause would be evaluated against it too - moot
      // here since actorB does have SELECT visibility via the share, but
      // kept consistent with the other UPDATE/DELETE proofs in this file.
      const { error } = await actorB.client
        .from('personal_schedule_entries')
        .update({ memo: hijackedMemo })
        .eq('id', created.id);
      assert.equal(error, null);

      // Confirm the hijacked memo actually landed via a direct (RLS-
      // bypassing) connection instead, since actorB's own client can never
      // read the row back.
      const hijackedRow = await withPgClient((client) =>
        client.query(`select 1 from public.personal_schedule_entries where id = $1 and memo = $2`, [
          created.id,
          hijackedMemo,
        ]),
      );
      assert.equal(
        hijackedRow.rowCount,
        1,
        'expected a non-owner update to go red (succeed) with the update policy broken',
      );
    },
  );

  // 13. personal_schedule_shares_insert_owner: replacing its WITH CHECK
  // with `true` must let a non-owner add a recipient to someone else's
  // entry, proving "a recipient cannot add another recipient to an entry
  // they don't own" depends on this policy.
  await withBrokenPolicy(
    'personal_schedule_shares_insert_owner',
    `drop policy personal_schedule_shares_insert_owner on public.personal_schedule_shares;
     create policy personal_schedule_shares_insert_owner
       on public.personal_schedule_shares for insert to authenticated with check (true);`,
    `drop policy personal_schedule_shares_insert_owner on public.personal_schedule_shares;
     create policy personal_schedule_shares_insert_owner
       on public.personal_schedule_shares for insert to authenticated
       with check (public.is_personal_schedule_entry_owner(schedule_entry_id));`,
    async () => {
      const created = await createScheduleEntryAsOwner(actorA);
      const { data, error } = await actorB.client
        .from('personal_schedule_shares')
        .insert({ schedule_entry_id: created.id, shared_with_user_id: actorB.user.id })
        .select()
        .single();
      assert.equal(
        error,
        null,
        'expected a non-owner adding a recipient to go red (succeed) with the insert policy broken',
      );
      assert.equal(data.schedule_entry_id, created.id);
    },
  );

  // 14. personal_schedule_shares_delete_owner_or_self (relaxed together with
  // its SELECT policy, like guardrail item 2 above): replacing DELETE's
  // USING with `true` must let a stranger (neither the entry owner nor the
  // share's own recipient) delete someone else's share row, proving "a
  // recipient cannot remove another recipient's share" depends on this
  // policy's owner-or-self condition, not on some other mechanism.
  // personal_schedule_shares_select_owner_or_recipient has to be relaxed
  // to `true` in the same breakSql: DELETE (like UPDATE - see guardrail
  // item 12 above) can only affect rows that also pass the table's SELECT
  // policy, and that policy is the exact same owner-or-recipient condition
  // - a genuine stranger has no SELECT visibility into someone else's
  // share row at all, so DELETE would still silently match zero rows with
  // only its own USING clause broken, proving nothing about this policy.
  await withBrokenPolicy(
    'personal_schedule_shares_delete_owner_or_self',
    `drop policy personal_schedule_shares_select_owner_or_recipient on public.personal_schedule_shares;
     create policy personal_schedule_shares_select_owner_or_recipient
       on public.personal_schedule_shares for select to authenticated using (true);
     drop policy personal_schedule_shares_delete_owner_or_self on public.personal_schedule_shares;
     create policy personal_schedule_shares_delete_owner_or_self
       on public.personal_schedule_shares for delete to authenticated using (true);`,
    `drop policy personal_schedule_shares_select_owner_or_recipient on public.personal_schedule_shares;
     create policy personal_schedule_shares_select_owner_or_recipient
       on public.personal_schedule_shares for select to authenticated using (
         shared_with_user_id = auth.uid()
         or public.is_personal_schedule_entry_owner(schedule_entry_id)
       );
     drop policy personal_schedule_shares_delete_owner_or_self on public.personal_schedule_shares;
     create policy personal_schedule_shares_delete_owner_or_self
       on public.personal_schedule_shares for delete to authenticated using (
         shared_with_user_id = auth.uid()
         or public.is_personal_schedule_entry_owner(schedule_entry_id)
       );`,
    async () => {
      const created = await createScheduleEntryAsOwner(actorA);
      const { data: share, error: shareError } = await actorA.client
        .from('personal_schedule_shares')
        .insert({ schedule_entry_id: created.id, shared_with_user_id: actorB.user.id })
        .select()
        .single();
      if (shareError || !share) {
        throw new Error(`fixture share insert failed: ${shareError?.message}`);
      }
      const { data, error } = await stranger.client
        .from('personal_schedule_shares')
        .delete()
        .eq('id', share.id)
        .select();
      assert.equal(error, null);
      assert.equal(
        data.length,
        1,
        'expected a stranger delete to go red (succeed) with the delete policy broken',
      );
    },
  );

  // 15. The designated catalog creator gate (Issue #29). Unlike the items
  // above, the mechanism under test is data (a public.catalog_creators
  // row), not a policy or grant - so the fault is injected by *granting*
  // membership to actorB, which must make "a non-creator cannot create an
  // event" go red. This proves that denial depends on the membership row
  // rather than on some unrelated failure (a broken RPC, a missing EXECUTE
  // grant, an invalid session) that would deny actorB anyway.
  //
  // Granting/revoking goes through service_role rather than the superuser
  // connection used elsewhere here, because that is the same path the real
  // operational script uses.
  {
    console.log('\n--- breaking designated catalog creator gate (granting actorB) ---');
    // Baseline first: without membership, the create must be denied. If
    // this ever stopped holding, the "red" assertion below would prove
    // nothing.
    const { error: deniedBefore } = await actorB.client.rpc('create_event_with_occurrence', {
      p_title: `guardrail proof creator gate baseline ${Date.now()}`,
      p_starts_at: new Date().toISOString(),
    });
    assert.ok(deniedBefore, 'expected a non-creator to be denied before membership is granted');

    try {
      await grantCatalogCreator(actorB.user.id);
      const { data, error } = await actorB.client.rpc('create_event_with_occurrence', {
        p_title: `guardrail proof creator gate ${Date.now()}`,
        p_starts_at: new Date().toISOString(),
      });
      assert.equal(
        error,
        null,
        'expected event creation to go red (succeed) once catalog creator membership is granted',
      );
      assert.equal(
        data.owner_id,
        actorB.user.id,
        'expected the creator to become the owner, unchanged by the membership gate',
      );
      console.log(
        'OK: negative test for the creator gate goes red with membership granted, as expected.',
      );
    } finally {
      await revokeCatalogCreator(actorB.user.id);
      console.log('restored designated catalog creator gate (revoked actorB)');
    }
  }

  // 16. occurrence_participations_select_visible (Issue #30): private is
  // the default, so replacing the owner-or-public condition with `true`
  // must let a stranger read someone else's private participation, proving
  // "another authenticated user cannot read a private participation"
  // depends on this policy rather than on the row simply being hard to
  // find.
  await withBrokenPolicy(
    'occurrence_participations_select_visible',
    `drop policy occurrence_participations_select_visible on public.occurrence_participations;
     create policy occurrence_participations_select_visible
       on public.occurrence_participations for select to authenticated using (true);`,
    `drop policy occurrence_participations_select_visible on public.occurrence_participations;
     create policy occurrence_participations_select_visible
       on public.occurrence_participations for select to authenticated
       using (user_id = auth.uid() or visibility = 'public');`,
    async () => {
      const { participation } = await createAttendedOccurrence(actorA, 'private');
      const { data, error } = await stranger.client
        .from('occurrence_participations')
        .select()
        .eq('id', participation.id);
      assert.equal(error, null);
      assert.equal(
        data.length,
        1,
        'expected a private participation to go red (readable) with the select policy broken',
      );
    },
  );

  // 17. occurrence_participations_insert_own: user_id is deliberately
  // grantable on INSERT (the column grant is what lets a client state whose
  // participation it is), so this policy's WITH CHECK is the only thing
  // stopping a client from recording a participation on somebody else’s
  // behalf. Replacing it with `true` must let that spoof succeed.
  await withBrokenPolicy(
    'occurrence_participations_insert_own',
    `drop policy occurrence_participations_insert_own on public.occurrence_participations;
     create policy occurrence_participations_insert_own
       on public.occurrence_participations for insert to authenticated with check (true);`,
    `drop policy occurrence_participations_insert_own on public.occurrence_participations;
     create policy occurrence_participations_insert_own
       on public.occurrence_participations for insert to authenticated
       with check (user_id = auth.uid());`,
    async () => {
      const { occurrenceId } = await createAttendedOccurrence(actorA, 'private');
      // No .select(): the SELECT policy stays intact throughout this proof
      // (see guardrail item 11), and actorB has no visibility into a
      // private row it just spoofed to actorA - a RETURNING clause would
      // fail this assertion for the wrong reason.
      const { error } = await actorB.client.from('occurrence_participations').insert({
        occurrence_id: occurrenceId,
        user_id: stranger.user.id,
        status: 'considering',
      });
      assert.equal(
        error,
        null,
        'expected an on-behalf-of insert to go red (succeed) with the insert policy broken',
      );

      const spoofed = await withPgClient((client) =>
        client.query(
          `select 1 from public.occurrence_participations where occurrence_id = $1 and user_id = $2`,
          [occurrenceId, stranger.user.id],
        ),
      );
      assert.equal(
        spoofed.rowCount,
        1,
        'expected the spoofed participation to actually exist once the insert policy is broken',
      );
    },
  );

  // 18. occurrence_participations_update_own: this is what makes
  // "only the invitee can move considering -> attending" true. Replacing
  // USING/WITH CHECK with `true` must let another user rewrite someone
  // else's status. The fixture row is public so the (intact) SELECT policy
  // gives actorB the visibility UPDATE also requires - see guardrail item
  // 12 for why that matters.
  await withBrokenPolicy(
    'occurrence_participations_update_own',
    `drop policy occurrence_participations_update_own on public.occurrence_participations;
     create policy occurrence_participations_update_own
       on public.occurrence_participations for update to authenticated
       using (true) with check (true);`,
    `drop policy occurrence_participations_update_own on public.occurrence_participations;
     create policy occurrence_participations_update_own
       on public.occurrence_participations for update to authenticated
       using (user_id = auth.uid()) with check (user_id = auth.uid());`,
    async () => {
      const { participation } = await createAttendedOccurrence(actorA, 'public');
      const { data, error } = await actorB.client
        .from('occurrence_participations')
        .update({ status: 'considering' })
        .eq('id', participation.id)
        .select();
      assert.equal(error, null);
      assert.equal(
        data.length,
        1,
        'expected a third-party status rewrite to go red (succeed) with the update policy broken',
      );
    },
  );

  // 19. occurrence_invitations_select_party: an invitation is readable only
  // by its two parties. Replacing that with `true` must let an unrelated
  // user read it, proving the privacy boundary is this policy.
  await withBrokenPolicy(
    'occurrence_invitations_select_party',
    `drop policy occurrence_invitations_select_party on public.occurrence_invitations;
     create policy occurrence_invitations_select_party
       on public.occurrence_invitations for select to authenticated using (true);`,
    `drop policy occurrence_invitations_select_party on public.occurrence_invitations;
     create policy occurrence_invitations_select_party
       on public.occurrence_invitations for select to authenticated
       using (inviter_id = auth.uid() or invitee_id = auth.uid());`,
    async () => {
      const { occurrenceId } = await createAttendedOccurrence(actorA, 'private');
      const { data: invitation, error: inviteError } = await actorA.client.rpc(
        'invite_to_occurrence',
        {
          p_occurrence_id: occurrenceId,
          p_invitee_id: actorB.user.id,
        },
      );
      if (inviteError || !invitation) {
        throw new Error(`fixture invite_to_occurrence failed: ${inviteError?.message}`);
      }
      const { data, error } = await stranger.client
        .from('occurrence_invitations')
        .select()
        .eq('id', invitation.id);
      assert.equal(error, null);
      assert.equal(
        data.length,
        1,
        'expected a third party read to go red (succeed) with the select policy broken',
      );
    },
  );

  // 20. occurrence_invitations has no UPDATE grant and no UPDATE policy at
  // all: declined_at is written only by decline_occurrence_invitation, which
  // stamps now() and never clears it. That absence is what keeps decline-undo
  // - an operation no product rule has decided - out of the schema, so it is
  // worth proving the negative test depends on it. Both layers have to be
  // added together (like guardrail items 2 and 4): a grant with no policy
  // still default-denies, and a policy with no grant is never reached.
  await withBrokenPolicy(
    'occurrence_invitations declined_at UPDATE grant + policy (added together)',
    `grant update (declined_at) on public.occurrence_invitations to authenticated;
     create policy occurrence_invitations_update_decline_own
       on public.occurrence_invitations for update to authenticated
       using (invitee_id = auth.uid()) with check (invitee_id = auth.uid());`,
    `drop policy occurrence_invitations_update_decline_own on public.occurrence_invitations;
     revoke update on public.occurrence_invitations from authenticated;`,
    async () => {
      const { occurrenceId } = await createAttendedOccurrence(actorA, 'private');
      const { data: invitation, error: inviteError } = await actorA.client.rpc(
        'invite_to_occurrence',
        {
          p_occurrence_id: occurrenceId,
          p_invitee_id: actorB.user.id,
        },
      );
      if (inviteError || !invitation) {
        throw new Error(`fixture invite_to_occurrence failed: ${inviteError?.message}`);
      }
      const { error: declineError } = await actorB.client.rpc('decline_occurrence_invitation', {
        p_invitation_id: invitation.id,
      });
      if (declineError) {
        throw new Error(`fixture decline_occurrence_invitation failed: ${declineError.message}`);
      }

      const { data, error } = await actorB.client
        .from('occurrence_invitations')
        .update({ declined_at: null })
        .eq('id', invitation.id)
        .select();
      assert.equal(error, null);
      assert.equal(data.length, 1);
      assert.equal(
        data[0].declined_at,
        null,
        'expected un-declining to go red (succeed) once a declined_at UPDATE grant and policy exist',
      );
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
    [actorA, actorB, stranger]
      .filter((actor) => actor !== undefined)
      .map((actor) => deleteTestActor(actor)),
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
