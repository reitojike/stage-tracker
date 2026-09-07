import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActorsSequentially,
  type TestActor,
} from './support/testActors.ts';
import { createEventWithOccurrence } from './support/eventFixtures.ts';
import {
  createEventWithOpportunity,
  importOpportunity,
  opportunitySourceKey,
  readMilestonesAsAdmin,
  readOpportunityAsAdmin,
  readTargetOccurrencesAsAdmin,
} from './support/ticketOpportunityFixtures.ts';

// Real local Supabase/Postgres RLS + RPC tests for the shared TicketOpportunity
// schema (Issue #162): public.ticket_opportunities,
// public.ticket_opportunity_target_occurrences,
// public.ticket_opportunity_milestones, and the import_ticket_opportunity RPC.
// Shared catalog data - readable by every authenticated user, writable only
// through the service_role-only import RPC.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let catalogOwner: TestActor;
let otherUser: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  catalogOwner = await createTestActor('rls-opp-catalog', PASSWORD, {
    designatedCatalogCreator: true,
  });
  createdActors.push(catalogOwner);
  otherUser = await createTestActor('rls-opp-other', PASSWORD);
  createdActors.push(otherUser);
});

after(async () => {
  await deleteTestActorsSequentially(createdActors);
});

// --- Shared read ---

void test('an authenticated user can read a shared opportunity they did not create', async () => {
  const { event } = await createEventWithOccurrence(catalogOwner);
  const opportunity = await importOpportunity(event.id, { displayName: '一般発売' });

  const { data, error } = await otherUser.client
    .from('ticket_opportunities')
    .select()
    .eq('id', opportunity.id);
  assert.equal(error, null);
  assert.equal(data.length, 1);
  assert.equal(data[0]?.display_name, '一般発売');
});

void test('anonymous cannot read opportunities', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.from('ticket_opportunities').select();
  assert.ok(error, 'expected a permission error for anonymous select');
});

// --- Write boundary: ordinary users cannot mutate shared data ---

void test('an ordinary authenticated user cannot insert an opportunity directly', async () => {
  const { event } = await createEventWithOccurrence(catalogOwner);
  const { error } = await catalogOwner.client.from('ticket_opportunities').insert({
    event_id: event.id,
    target_scope: 'event_wide',
    display_name: '一般発売',
    source_key: opportunitySourceKey(),
  });
  assert.ok(error, 'expected direct INSERT to be rejected for an authenticated client');
});

void test('an ordinary authenticated user cannot update an opportunity directly', async () => {
  const { event } = await createEventWithOccurrence(catalogOwner);
  const opportunity = await importOpportunity(event.id);

  const { error } = await catalogOwner.client
    .from('ticket_opportunities')
    .update({ display_name: '差し替え' })
    .eq('id', opportunity.id);
  assert.ok(error, 'expected direct UPDATE to be rejected for an authenticated client');
});

void test('service/operator import creates a shared opportunity', async () => {
  const { event } = await createEventWithOccurrence(catalogOwner);
  const opportunity = await importOpportunity(event.id, { displayName: '第1抽選' });
  assert.equal(opportunity.event_id, event.id);
  assert.equal(opportunity.display_name, '第1抽選');
  assert.equal(opportunity.target_scope, 'event_wide');
});

// --- Target scope ---

void test('event-wide and selected-occurrence opportunities are distinguishable', async () => {
  const { event, occurrence } = await createEventWithOccurrence(catalogOwner);
  const eventWide = await importOpportunity(event.id, { targetScope: 'event_wide' });
  const selected = await importOpportunity(event.id, {
    targetScope: 'selected_occurrences',
    occurrenceIds: [occurrence.id],
  });

  assert.equal(eventWide.target_scope, 'event_wide');
  assert.equal(selected.target_scope, 'selected_occurrences');

  const eventWideTargets = await readTargetOccurrencesAsAdmin(eventWide.id);
  assert.deepEqual(eventWideTargets, []);

  const selectedTargets = await readTargetOccurrencesAsAdmin(selected.id);
  assert.equal(selectedTargets.length, 1);
  assert.equal(selectedTargets[0]?.occurrence_id, occurrence.id);
});

void test('one opportunity can target multiple occurrences', async () => {
  const { opportunity, occurrence, secondOccurrence } =
    await createEventWithOpportunity(catalogOwner);
  const targets = await readTargetOccurrencesAsAdmin(opportunity.id);
  assert.equal(targets.length, 2);
  assert.deepEqual(
    targets.map((t) => t.occurrence_id).sort(),
    [occurrence.id, secondOccurrence.id].sort(),
  );
});

void test('a selected-occurrences opportunity rejects an occurrence from another event', async () => {
  const { event } = await createEventWithOccurrence(catalogOwner);
  const { occurrence: foreignOccurrence } = await createEventWithOccurrence(catalogOwner);

  await assert.rejects(
    () =>
      importOpportunity(event.id, {
        targetScope: 'selected_occurrences',
        occurrenceIds: [foreignOccurrence.id],
      }),
    /must belong to the given event/,
  );
});

void test('an event-wide opportunity rejects being given target occurrences', async () => {
  const { event, occurrence } = await createEventWithOccurrence(catalogOwner);
  await assert.rejects(
    () =>
      importOpportunity(event.id, {
        targetScope: 'event_wide',
        occurrenceIds: [occurrence.id],
      }),
    /must not be given target occurrences/,
  );
});

void test('a selected-occurrences opportunity requires at least one target occurrence', async () => {
  const { event } = await createEventWithOccurrence(catalogOwner);
  await assert.rejects(
    () => importOpportunity(event.id, { targetScope: 'selected_occurrences', occurrenceIds: [] }),
    /requires at least one target occurrence/,
  );
});

// --- Milestones: temporal precision ---

void test('a date-only milestone is preserved without a fabricated time', async () => {
  const { event } = await createEventWithOccurrence(catalogOwner);
  const opportunity = await importOpportunity(event.id, {
    milestones: [
      { milestone_type: 'application_open', temporal_precision: 'date', date_value: '2026-09-01' },
    ],
  });
  const milestones = await readMilestonesAsAdmin(opportunity.id);
  assert.equal(milestones.length, 1);
  assert.equal(milestones[0]?.temporal_precision, 'date');
  assert.equal(milestones[0].date_value, '2026-09-01');
  assert.equal(milestones[0].at, null);
  assert.equal(milestones[0].starts_at, null);
  assert.equal(milestones[0].ends_at, null);
});

void test('an exact datetime milestone keeps its instant', async () => {
  const { event } = await createEventWithOccurrence(catalogOwner);
  const opportunity = await importOpportunity(event.id, {
    milestones: [
      {
        milestone_type: 'sale_start',
        temporal_precision: 'datetime',
        at: '2026-09-01T10:00:00+09:00',
      },
    ],
  });
  const milestones = await readMilestonesAsAdmin(opportunity.id);
  assert.equal(milestones[0]?.temporal_precision, 'datetime');
  assert.equal(new Date(milestones[0].at ?? '').toISOString(), '2026-09-01T01:00:00.000Z');
  assert.equal(milestones[0].date_value, null);
});

void test('a window milestone keeps its start and end instants', async () => {
  const { event } = await createEventWithOccurrence(catalogOwner);
  const opportunity = await importOpportunity(event.id, {
    milestones: [
      {
        milestone_type: 'payment_window',
        temporal_precision: 'window',
        starts_at: '2026-08-10T18:00:00+09:00',
        ends_at: '2026-08-13T23:59:00+09:00',
      },
    ],
  });
  const milestones = await readMilestonesAsAdmin(opportunity.id);
  assert.equal(milestones[0]?.temporal_precision, 'window');
  assert.equal(new Date(milestones[0].starts_at ?? '').toISOString(), '2026-08-10T09:00:00.000Z');
  assert.equal(new Date(milestones[0].ends_at ?? '').toISOString(), '2026-08-13T14:59:00.000Z');
});

void test('a window milestone rejects end before start', async () => {
  const { event } = await createEventWithOccurrence(catalogOwner);
  await assert.rejects(() =>
    importOpportunity(event.id, {
      milestones: [
        {
          milestone_type: 'payment_window',
          temporal_precision: 'window',
          starts_at: '2026-08-13T23:59:00+09:00',
          ends_at: '2026-08-10T18:00:00+09:00',
        },
      ],
    }),
  );
});

void test('a milestone with mismatched columns for its precision is rejected', async () => {
  const { event } = await createEventWithOccurrence(catalogOwner);
  await assert.rejects(() =>
    importOpportunity(event.id, {
      milestones: [
        {
          milestone_type: 'application_open',
          temporal_precision: 'date',
          date_value: '2026-09-01',
          at: '2026-09-01T00:00:00+09:00',
        },
      ],
    }),
  );
});

void test('an unknown milestone (e.g. result date not yet published) is simply absent, not coerced', async () => {
  const { event } = await createEventWithOccurrence(catalogOwner);
  const opportunity = await importOpportunity(event.id, {
    milestones: [
      { milestone_type: 'application_open', temporal_precision: 'date', date_value: '2026-09-01' },
    ],
  });
  const milestones = await readMilestonesAsAdmin(opportunity.id);
  assert.equal(milestones.length, 1);
  assert.ok(!milestones.some((m) => m.milestone_type === 'result_announcement'));
});

// --- Import idempotency ("replace all" on re-import) ---

void test('re-importing the same source_key updates the opportunity and replaces its milestones/targets', async () => {
  const { event, occurrence } = await createEventWithOccurrence(catalogOwner);
  const sourceKey = opportunitySourceKey();

  const first = await importOpportunity(event.id, {
    sourceKey,
    displayName: '第1抽選',
    targetScope: 'selected_occurrences',
    occurrenceIds: [occurrence.id],
    milestones: [
      { milestone_type: 'application_open', temporal_precision: 'date', date_value: '2026-09-01' },
    ],
  });

  const second = await importOpportunity(event.id, {
    sourceKey,
    displayName: '第1抽選（更新）',
    targetScope: 'event_wide',
    milestones: [
      {
        milestone_type: 'result_announcement',
        temporal_precision: 'datetime',
        at: '2026-09-05T12:00:00+09:00',
      },
    ],
  });

  assert.equal(second.id, first.id, 'expected the same opportunity row to be reused');
  const stored = await readOpportunityAsAdmin(first.id);
  assert.equal(stored.display_name, '第1抽選（更新）');
  assert.equal(stored.target_scope, 'event_wide');

  const targets = await readTargetOccurrencesAsAdmin(first.id);
  assert.deepEqual(targets, [], 'expected stale target occurrences to be replaced, not merged');

  const milestones = await readMilestonesAsAdmin(first.id);
  assert.equal(milestones.length, 1);
  assert.equal(milestones[0]?.milestone_type, 'result_announcement');
});

// --- source_key identity, independent of source_url ---

void test('two opportunities can share the same source_url but have distinct source_key identity', async () => {
  const { event } = await createEventWithOccurrence(catalogOwner);
  const sharedUrl = 'https://kageki.hankyu.co.jp/friends/pdf/schedule.pdf';
  const first = await importOpportunity(event.id, { displayName: '第1抽選', sourceUrl: sharedUrl });
  const second = await importOpportunity(event.id, {
    displayName: '第2抽選',
    sourceUrl: sharedUrl,
  });

  assert.notEqual(first.id, second.id);
  assert.equal(first.source_url, sharedUrl);
  assert.equal(second.source_url, sharedUrl);
  assert.notEqual(first.source_key, second.source_key);
});
