import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { resolveAdminTarget } from '../../scripts/lib/adminTarget.mjs';
import {
  loadAndValidateSeed,
  resolvePlans,
  applyPlans,
} from '../../scripts/lib/ticketOpportunityImport.mjs';

// Real local Supabase/Postgres end-to-end tests for the TicketOpportunity
// operator import script (Issue #163): scripts/import-ticket-opportunities.mjs
// and its lib modules, exercised against a real database the same way the
// real CLI is - loadAndValidateSeed reads real seed files, resolvePlans
// resolves them against real events/occurrences, applyPlans calls the real
// import_ticket_opportunity RPC.
//
// Deliberately self-contained (no import from test/rls/support/*.ts):
// admin.rpc/.from calls run as service_role, which bypasses RLS entirely,
// so this file needs no signed-in actor - only a valid auth.users id for
// events.owner_id and user_ticket_opportunity_states.user_id. Kept as a
// plain .mjs file (no TypeScript) so importing the script's own .mjs lib
// modules needs no cross-extension resolution concern.

const admin = resolveAdminTarget(false);

let ownerId;
let tmpDir;
const testTag = `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;

function sourceKey(label) {
  return `test:ticket-import:${testTag}:${label}`;
}

before(async () => {
  const email = `ticket-import-script-${testTag}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'Str0ng-Test-Passw0rd!',
    email_confirm: true,
  });
  if (error) {
    throw new Error(`failed to create fixture owner: ${error.message}`);
  }
  ownerId = data.user.id;

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-opportunity-seed-'));
});

after(async () => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  if (ownerId) {
    // events.owner_id -> auth.users(id) and event_occurrences.event_id ->
    // events(id) both have no ON DELETE action (RESTRICT), matching
    // delete_event_occurrence's own enumerate-and-reject checks - so
    // occurrences must be deleted before their events, before the user
    // itself, mirroring test/rls/support/testActors.ts's own
    // deleteTestActor ordering for the same FK shape.
    // ticket_opportunities/its milestones/target-occurrences/
    // user_ticket_opportunity_states all cascade from events or
    // event_occurrences (directly or transitively), so no separate cleanup
    // is needed for those.
    const { data: ownedEvents, error: selectEventsError } = await admin
      .from('events')
      .select('id')
      .eq('owner_id', ownerId);
    if (selectEventsError) {
      throw new Error(`failed to look up fixture events: ${selectEventsError.message}`);
    }
    const ownedEventIds = ownedEvents.map((row) => row.id);
    if (ownedEventIds.length > 0) {
      const { error: deleteOccurrencesError } = await admin
        .from('event_occurrences')
        .delete()
        .in('event_id', ownedEventIds);
      if (deleteOccurrencesError) {
        throw new Error(`failed to delete fixture occurrences: ${deleteOccurrencesError.message}`);
      }
    }
    const { error: deleteEventsError } = await admin
      .from('events')
      .delete()
      .eq('owner_id', ownerId);
    if (deleteEventsError) {
      throw new Error(`failed to delete fixture events: ${deleteEventsError.message}`);
    }
    // Retried like test/rls/support/testActors.ts's own deleteTestActor:
    // node --test runs every test/rls/*.test.* file as its own process
    // against one shared local Supabase stack, and GoTrue's
    // "Database error deleting user" has been observed under that
    // concurrency even after every FK-referencing row above is genuinely
    // gone (see that module's own comment on DELETE_USER_ATTEMPTS).
    const attemptErrors = [];
    let deleted = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { error } = await admin.auth.admin.deleteUser(ownerId);
      if (!error) {
        deleted = true;
        break;
      }
      attemptErrors.push(`attempt ${attempt + 1}: ${error.message}`);
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
    if (!deleted) {
      throw new Error(`failed to delete fixture owner: ${attemptErrors.join('; ')}`);
    }
  }
});

async function insertEvent(overrides = {}) {
  const { data, error } = await admin
    .from('events')
    .insert({
      owner_id: ownerId,
      title: overrides.title ?? 'ticket import test event',
      source_key: overrides.sourceKey,
      starts_on: overrides.startsOn ?? '2026-09-01',
      ends_on: overrides.endsOn ?? '2026-09-05',
    })
    .select()
    .single();
  if (error) {
    throw new Error(`fixture event insert failed: ${error.message}`);
  }
  return data;
}

async function insertOccurrence(eventId, startsAt) {
  const { data, error } = await admin
    .from('event_occurrences')
    .insert({ event_id: eventId, starts_at: startsAt })
    .select()
    .single();
  if (error) {
    throw new Error(`fixture occurrence insert failed: ${error.message}`);
  }
  return data;
}

function writeSeedFile(name, content) {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
  return filePath;
}

async function readOpportunityBySourceKey(key) {
  const { data, error } = await admin
    .from('ticket_opportunities')
    .select('*')
    .eq('source_key', key)
    .maybeSingle();
  if (error) {
    throw new Error(`fixture opportunity read failed: ${error.message}`);
  }
  return data;
}

async function readMilestones(opportunityId) {
  const { data, error } = await admin
    .from('ticket_opportunity_milestones')
    .select('*')
    .eq('opportunity_id', opportunityId);
  if (error) {
    throw new Error(`fixture milestone read failed: ${error.message}`);
  }
  return data;
}

async function readTargetOccurrences(opportunityId) {
  const { data, error } = await admin
    .from('ticket_opportunity_target_occurrences')
    .select('occurrence_id')
    .eq('opportunity_id', opportunityId);
  if (error) {
    throw new Error(`fixture target-occurrence read failed: ${error.message}`);
  }
  return data.map((row) => row.occurrence_id);
}

// --- dry run performs zero writes ---

void test('a dry run resolves plans but writes nothing', async () => {
  const event = await insertEvent({ sourceKey: sourceKey('dry-run-event') });
  const key = sourceKey('dry-run-opportunity');
  const seedPath = writeSeedFile('dry-run.json', {
    eventSourceKey: event.source_key,
    sourceKey: key,
    displayName: '第1抽選',
    targetScope: 'event_wide',
    milestones: [{ type: 'application_open', precision: 'date', date: '2026-08-01' }],
  });

  const loaded = loadAndValidateSeed(seedPath);
  assert.equal(loaded.ok, true);
  const resolved = await resolvePlans(admin, loaded.entries);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.plans[0].action, 'create');

  // No applyPlans call at all - this is the dry-run path.
  const after1 = await readOpportunityBySourceKey(key);
  assert.equal(after1, null);
});

// --- create, then idempotent re-run ---

void test('apply creates an opportunity; re-applying the identical seed is a no-op', async () => {
  const event = await insertEvent({ sourceKey: sourceKey('create-event') });
  const key = sourceKey('create-opportunity');
  const seed = {
    eventSourceKey: event.source_key,
    sourceKey: key,
    displayName: '第1抽選',
    sourceUrl: 'https://example.invalid/tickets',
    memo: '一次募集',
    targetScope: 'event_wide',
    milestones: [
      { type: 'application_open', precision: 'date', date: '2026-08-01' },
      { type: 'application_close', precision: 'datetime', at: '2026-09-05T17:00:00+09:00' },
      {
        type: 'payment_window',
        precision: 'window',
        startsAt: '2026-09-10T18:00:00+09:00',
        endsAt: '2026-09-13T23:59:00+09:00',
      },
    ],
  };
  const seedPath = writeSeedFile('create.json', seed);

  const loaded = loadAndValidateSeed(seedPath);
  const resolved = await resolvePlans(admin, loaded.entries);
  assert.equal(resolved.plans[0].action, 'create');
  await applyPlans(admin, resolved.plans);

  const created = await readOpportunityBySourceKey(key);
  assert.ok(created);
  assert.equal(created.display_name, '第1抽選');
  assert.equal(created.target_scope, 'event_wide');

  const milestones = await readMilestones(created.id);
  assert.equal(milestones.length, 3);
  const byType = new Map(milestones.map((m) => [m.milestone_type, m]));
  assert.equal(byType.get('application_open').date_value, '2026-08-01');
  assert.equal(byType.get('application_close').temporal_precision, 'datetime');
  assert.equal(byType.get('payment_window').temporal_precision, 'window');
  // No result_announcement milestone was in the seed - absence, not a
  // fabricated row (#163 "sourceに結果日時が無ければ捏造しない").
  assert.equal(byType.has('result_announcement'), false);

  // Re-run the identical seed: idempotent, no duplicate opportunity, and
  // classified as 'unchanged' rather than 'update'.
  const reloaded = loadAndValidateSeed(seedPath);
  const reresolved = await resolvePlans(admin, reloaded.entries);
  assert.equal(reresolved.plans[0].action, 'unchanged');
  await applyPlans(admin, reresolved.plans);

  const { data: allWithKey, error } = await admin
    .from('ticket_opportunities')
    .select('id')
    .eq('source_key', key);
  if (error) throw new Error(error.message);
  assert.equal(allWithKey.length, 1);
  assert.equal(allWithKey[0].id, created.id);
});

// --- update: within-opportunity replace-all semantics ---

void test('re-importing with a corrected seed replaces milestones and details (replace-all)', async () => {
  const event = await insertEvent({ sourceKey: sourceKey('update-event') });
  const key = sourceKey('update-opportunity');
  const firstSeedPath = writeSeedFile('update-1.json', {
    eventSourceKey: event.source_key,
    sourceKey: key,
    displayName: '第1抽選',
    targetScope: 'event_wide',
    milestones: [
      { type: 'application_open', precision: 'date', date: '2026-08-01' },
      { type: 'application_close', precision: 'date', date: '2026-08-15' },
      { type: 'result_announcement', precision: 'date', date: '2026-08-20' },
    ],
  });
  const firstResolved = await resolvePlans(admin, loadAndValidateSeed(firstSeedPath).entries);
  await applyPlans(admin, firstResolved.plans);
  const created = await readOpportunityBySourceKey(key);

  // Source correction: result date turned out to be wrong / retracted -
  // the corrected seed simply omits it (#163 "古いresult milestoneが
  // 消えることは#162のreplace-all semanticsとして意図されている").
  const secondSeedPath = writeSeedFile('update-2.json', {
    eventSourceKey: event.source_key,
    sourceKey: key,
    displayName: '第1抽選（訂正）',
    targetScope: 'event_wide',
    milestones: [
      { type: 'application_open', precision: 'date', date: '2026-08-01' },
      { type: 'application_close', precision: 'date', date: '2026-08-16' },
    ],
  });
  const secondLoaded = loadAndValidateSeed(secondSeedPath);
  const secondResolved = await resolvePlans(admin, secondLoaded.entries);
  assert.equal(secondResolved.plans[0].action, 'update');
  assert.equal(secondResolved.plans[0].detailsChanged, true);
  assert.equal(secondResolved.plans[0].milestonesChanged, true);
  await applyPlans(admin, secondResolved.plans);

  const { data: afterList, error } = await admin
    .from('ticket_opportunities')
    .select('id')
    .eq('source_key', key);
  if (error) throw new Error(error.message);
  assert.equal(afterList.length, 1);
  assert.equal(afterList[0].id, created.id, 'update reuses the same row, not a new one');

  const updated = await readOpportunityBySourceKey(key);
  assert.equal(updated.display_name, '第1抽選（訂正）');

  const milestonesAfter = await readMilestones(created.id);
  assert.equal(milestonesAfter.length, 2);
  const typesAfter = new Set(milestonesAfter.map((m) => m.milestone_type));
  assert.equal(typesAfter.has('result_announcement'), false);
  assert.equal(typesAfter.has('application_close'), true);
});

// --- selected_occurrences target scope ---

void test('selected_occurrences resolves stable startsAt locators to the right occurrence ids', async () => {
  const event = await insertEvent({
    sourceKey: sourceKey('selected-event'),
    startsOn: '2026-09-01',
    endsOn: '2026-09-10',
  });
  const occurrenceA = await insertOccurrence(event.id, '2026-09-01T13:00:00+09:00');
  const occurrenceB = await insertOccurrence(event.id, '2026-09-02T13:00:00+09:00');
  await insertOccurrence(event.id, '2026-09-03T13:00:00+09:00'); // not targeted

  const key = sourceKey('selected-opportunity');
  const seedPath = writeSeedFile('selected.json', {
    eventSourceKey: event.source_key,
    sourceKey: key,
    displayName: 'Vpass先行',
    targetScope: 'selected_occurrences',
    targetOccurrences: ['2026-09-01T13:00:00+09:00', '2026-09-02T13:00:00+09:00'],
    milestones: [
      { type: 'application_close', precision: 'datetime', at: '2026-08-25T23:59:00+09:00' },
    ],
  });
  const resolved = await resolvePlans(admin, loadAndValidateSeed(seedPath).entries);
  assert.equal(resolved.ok, true);
  assert.deepEqual(
    new Set(resolved.plans[0].occurrenceIds),
    new Set([occurrenceA.id, occurrenceB.id]),
  );
  await applyPlans(admin, resolved.plans);

  const created = await readOpportunityBySourceKey(key);
  const targets = await readTargetOccurrences(created.id);
  assert.deepEqual(new Set(targets), new Set([occurrenceA.id, occurrenceB.id]));
});

void test('a target occurrence locator that does not resolve is a validation error, not a partial write', async () => {
  const event = await insertEvent({ sourceKey: sourceKey('missing-occ-event') });
  await insertOccurrence(event.id, '2026-09-01T13:00:00+09:00');
  const key = sourceKey('missing-occ-opportunity');
  const seedPath = writeSeedFile('missing-occ.json', {
    eventSourceKey: event.source_key,
    sourceKey: key,
    displayName: '一般発売',
    targetScope: 'selected_occurrences',
    targetOccurrences: ['2026-12-25T13:00:00+09:00'],
  });
  const resolved = await resolvePlans(admin, loadAndValidateSeed(seedPath).entries);
  assert.equal(resolved.ok, false);
  assert.ok(resolved.problems.some((p) => p.includes('target occurrence(s) not found')));

  const missing = await readOpportunityBySourceKey(key);
  assert.equal(missing, null);
});

void test('an unresolved Event source key is a validation error', async () => {
  const key = sourceKey('unresolved-event-opportunity');
  const seedPath = writeSeedFile('unresolved.json', {
    eventSourceKey: sourceKey('this-event-does-not-exist'),
    sourceKey: key,
    displayName: '一般発売',
    targetScope: 'event_wide',
  });
  const resolved = await resolvePlans(admin, loadAndValidateSeed(seedPath).entries);
  assert.equal(resolved.ok, false);
  assert.ok(resolved.problems.some((p) => p.includes('no Event found')));
});

// --- multiple opportunities per event ---

void test('one Event can have multiple Opportunities imported together', async () => {
  const event = await insertEvent({ sourceKey: sourceKey('multi-opp-event') });
  const seedPath = writeSeedFile('multi.json', [
    {
      eventSourceKey: event.source_key,
      sourceKey: sourceKey('multi-lottery1'),
      displayName: '第1抽選',
      targetScope: 'event_wide',
    },
    {
      eventSourceKey: event.source_key,
      sourceKey: sourceKey('multi-lottery2'),
      displayName: '第2抽選',
      targetScope: 'event_wide',
    },
    {
      eventSourceKey: event.source_key,
      sourceKey: sourceKey('multi-general'),
      displayName: '一般発売',
      targetScope: 'event_wide',
    },
  ]);
  const resolved = await resolvePlans(admin, loadAndValidateSeed(seedPath).entries);
  assert.equal(resolved.plans.length, 3);
  await applyPlans(admin, resolved.plans);

  const { data, error } = await admin
    .from('ticket_opportunities')
    .select('source_key')
    .eq('event_id', event.id);
  if (error) throw new Error(error.message);
  assert.equal(data.length, 3);
});

// --- directory input, multiple files, no stale deletion ---

void test('directory input applies every file, and an Opportunity absent from a later seed is left untouched', async () => {
  const event = await insertEvent({ sourceKey: sourceKey('dir-event') });
  const dir = fs.mkdtempSync(path.join(tmpDir, 'dir-'));
  const keyA = sourceKey('dir-a');
  const keyB = sourceKey('dir-b');
  fs.writeFileSync(
    path.join(dir, 'a.json'),
    JSON.stringify({
      eventSourceKey: event.source_key,
      sourceKey: keyA,
      displayName: 'A',
      targetScope: 'event_wide',
    }),
  );
  fs.writeFileSync(
    path.join(dir, 'b.json'),
    JSON.stringify({
      eventSourceKey: event.source_key,
      sourceKey: keyB,
      displayName: 'B',
      targetScope: 'event_wide',
    }),
  );

  const loaded = loadAndValidateSeed(dir);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.entries.length, 2);
  const resolved = await resolvePlans(admin, loaded.entries);
  await applyPlans(admin, resolved.plans);

  assert.ok(await readOpportunityBySourceKey(keyA));
  assert.ok(await readOpportunityBySourceKey(keyB));

  // A later import run whose directory only contains A must not touch B -
  // no directory-level stale-removal policy (#163 out of scope).
  const laterDir = fs.mkdtempSync(path.join(tmpDir, 'dir-later-'));
  fs.writeFileSync(
    path.join(laterDir, 'a.json'),
    JSON.stringify({
      eventSourceKey: event.source_key,
      sourceKey: keyA,
      displayName: 'A (touched again)',
      targetScope: 'event_wide',
    }),
  );
  const laterResolved = await resolvePlans(admin, loadAndValidateSeed(laterDir).entries);
  await applyPlans(admin, laterResolved.plans);

  const stillThere = await readOpportunityBySourceKey(keyB);
  assert.ok(stillThere, 'Opportunity B must survive a re-import whose seed does not mention it');
});

// --- personal state preservation ---

void test('re-importing an Opportunity never touches an existing personal planning state', async () => {
  const event = await insertEvent({ sourceKey: sourceKey('personal-state-event') });
  const key = sourceKey('personal-state-opportunity');
  const firstResolved = await resolvePlans(
    admin,
    loadAndValidateSeed(
      writeSeedFile('personal-1.json', {
        eventSourceKey: event.source_key,
        sourceKey: key,
        displayName: '第1抽選',
        targetScope: 'event_wide',
        milestones: [{ type: 'application_open', precision: 'date', date: '2026-08-01' }],
      }),
    ).entries,
  );
  await applyPlans(admin, firstResolved.plans);
  const created = await readOpportunityBySourceKey(key);

  const { error: stateInsertError } = await admin.from('user_ticket_opportunity_states').insert({
    user_id: ownerId,
    opportunity_id: created.id,
    status: 'planned',
  });
  if (stateInsertError) {
    throw new Error(`fixture personal state insert failed: ${stateInsertError.message}`);
  }

  // Official correction: displayName and milestones change.
  const secondResolved = await resolvePlans(
    admin,
    loadAndValidateSeed(
      writeSeedFile('personal-2.json', {
        eventSourceKey: event.source_key,
        sourceKey: key,
        displayName: '第1抽選（時刻変更）',
        targetScope: 'event_wide',
        milestones: [
          { type: 'application_open', precision: 'date', date: '2026-08-02' },
          { type: 'application_close', precision: 'date', date: '2026-08-20' },
        ],
      }),
    ).entries,
  );
  assert.equal(secondResolved.plans[0].action, 'update');
  await applyPlans(admin, secondResolved.plans);

  const { data: stateAfter, error: stateReadError } = await admin
    .from('user_ticket_opportunity_states')
    .select('*')
    .eq('user_id', ownerId)
    .eq('opportunity_id', created.id)
    .maybeSingle();
  if (stateReadError) {
    throw new Error(`fixture personal state read failed: ${stateReadError.message}`);
  }
  assert.ok(stateAfter, 'personal state row must still exist after the shared data changed');
  assert.equal(stateAfter.status, 'planned', 'import must never change personal status');
});
