import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  listTicketOpportunitiesWithDetails,
  removeMyTicketOpportunityState,
  setMyTicketOpportunityState,
} from '../../src/infrastructure/supabase/ticketOpportunity.ts';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';
import { createEventWithOccurrence } from './support/eventFixtures.ts';
import {
  createEventWithOpportunity,
  importOpportunity,
} from './support/ticketOpportunityFixtures.ts';

// Real local Supabase/RLS tests for the TicketOpportunity typed boundary
// (Issue #162), over public.ticket_opportunities /
// ticket_opportunity_target_occurrences / ticket_opportunity_milestones /
// user_ticket_opportunity_states. Unlike test/rls/ticketOpportunities.test.ts
// and test/rls/userTicketOpportunityStates.test.ts, which exercise the raw
// RLS policies directly, this file exercises
// src/infrastructure/supabase/ticketOpportunity.ts - the query boundary #144
// and #143 are meant to consume.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let catalogOwner: TestActor;
let actorA: TestActor;
let actorB: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  catalogOwner = await createTestActor('rls-typed-opp-catalog', PASSWORD, {
    designatedCatalogCreator: true,
  });
  createdActors.push(catalogOwner);
  actorA = await createTestActor('rls-typed-opp-a', PASSWORD);
  createdActors.push(actorA);
  actorB = await createTestActor('rls-typed-opp-b', PASSWORD);
  createdActors.push(actorB);
});

after(async () => {
  const results = await Promise.allSettled(createdActors.map((actor) => deleteTestActor(actor)));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    const messages = failures.map((failure) =>
      failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
    );
    throw new Error(`test actor cleanup failed:\n${messages.join('\n')}`);
  }
});

void test('listTicketOpportunitiesWithDetails composes target occurrences, milestones, and no personal state', async () => {
  const { event, opportunity, occurrence, secondOccurrence } = await createEventWithOpportunity(
    catalogOwner,
    {
      milestones: [
        {
          milestone_type: 'application_open',
          temporal_precision: 'date',
          date_value: '2026-09-01',
        },
        {
          milestone_type: 'sale_start',
          temporal_precision: 'datetime',
          at: '2026-09-10T10:00:00+09:00',
        },
      ],
    },
  );

  const result = await listTicketOpportunitiesWithDetails(actorA.client, { eventId: event.id });
  assert.equal(result.ok, true);
  assert.equal(result.data.length, 1);
  const detail = result.data[0];
  assert.equal(detail?.opportunity.id, opportunity.id);
  assert.deepEqual(
    detail.targetOccurrenceIds.slice().sort(),
    [occurrence.id, secondOccurrence.id].sort(),
  );
  assert.equal(detail.milestones.length, 2);
  assert.equal(
    detail.milestones[0]?.milestoneType,
    'application_open',
    'expected milestones to be chronologically ordered',
  );
  assert.equal(detail.myState, null);
});

void test('listTicketOpportunitiesWithDetails surfaces the caller’s own personal state only', async () => {
  const { event } = await createEventWithOccurrence(catalogOwner);
  const opportunity = await importOpportunity(event.id);

  const setResult = await setMyTicketOpportunityState(actorA.client, opportunity.id, 'planned');
  assert.equal(setResult.ok, true);
  assert.equal(setResult.data.status, 'planned');

  const asA = await listTicketOpportunitiesWithDetails(actorA.client, { eventId: event.id });
  assert.equal(asA.ok, true);
  assert.equal(asA.data[0]?.myState?.status, 'planned');

  const asB = await listTicketOpportunitiesWithDetails(actorB.client, { eventId: event.id });
  assert.equal(asB.ok, true);
  assert.equal(
    asB.data[0]?.myState,
    null,
    'expected actorB to see no personal state for actorA’s row',
  );
});

void test('setMyTicketOpportunityState upserts: planned then applied then back to planned', async () => {
  const { event } = await createEventWithOccurrence(catalogOwner);
  const opportunity = await importOpportunity(event.id);

  const planned = await setMyTicketOpportunityState(actorA.client, opportunity.id, 'planned');
  assert.equal(planned.ok, true);
  const firstId = planned.data.id;

  const applied = await setMyTicketOpportunityState(actorA.client, opportunity.id, 'applied');
  assert.equal(applied.ok, true);
  assert.equal(applied.data.id, firstId, 'expected the same row to be reused, not duplicated');
  assert.equal(applied.data.status, 'applied');

  const backToPlanned = await setMyTicketOpportunityState(actorA.client, opportunity.id, 'planned');
  assert.equal(backToPlanned.ok, true);
  assert.equal(backToPlanned.data.id, firstId);
  assert.equal(backToPlanned.data.status, 'planned');
});

void test('removeMyTicketOpportunityState removes the caller’s own state', async () => {
  const { event } = await createEventWithOccurrence(catalogOwner);
  const opportunity = await importOpportunity(event.id);
  await setMyTicketOpportunityState(actorA.client, opportunity.id, 'planned');

  const removed = await removeMyTicketOpportunityState(actorA.client, opportunity.id);
  assert.equal(removed.ok, true);

  const result = await listTicketOpportunitiesWithDetails(actorA.client, { eventId: event.id });
  assert.equal(result.ok, true);
  assert.equal(result.data[0]?.myState, null);
});

void test('setMyTicketOpportunityState reports unauthenticated for a client with no session', async () => {
  const { event } = await createEventWithOccurrence(catalogOwner);
  const opportunity = await importOpportunity(event.id);

  const anonymous = createAnonymousClient();
  const result = await setMyTicketOpportunityState(anonymous, opportunity.id, 'planned');
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'unauthenticated');
});
