import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActorsSequentially,
  type TestActor,
} from './support/testActors.ts';
import { createEventWithOccurrence } from './support/eventFixtures.ts';
import { importOpportunity, readMyStateAsAdmin } from './support/ticketOpportunityFixtures.ts';

// Real local Supabase/Postgres RLS tests for public.user_ticket_opportunity_states
// (Issue #162): the owner-only personal `planned`/`applied` planning state.
// Unlike ticket_opportunities/ticket_opportunity_milestones (shared,
// SELECT-only for every authenticated user), this table has no shared read
// policy at all - only its own owner may read or write a row.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let catalogOwner: TestActor;
let owner: TestActor;
let otherUser: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  catalogOwner = await createTestActor('rls-uto-catalog', PASSWORD, {
    designatedCatalogCreator: true,
  });
  createdActors.push(catalogOwner);
  owner = await createTestActor('rls-uto-owner', PASSWORD);
  createdActors.push(owner);
  otherUser = await createTestActor('rls-uto-other', PASSWORD);
  createdActors.push(otherUser);
});

after(async () => {
  await deleteTestActorsSequentially(createdActors);
});

async function opportunityId(): Promise<string> {
  const { event } = await createEventWithOccurrence(catalogOwner);
  const opportunity = await importOpportunity(event.id);
  return opportunity.id;
}

// --- Positive: lifecycle ---

void test('the owner can create a planned state', async () => {
  const opportunity = await opportunityId();
  const { data, error } = await owner.client
    .from('user_ticket_opportunity_states')
    .insert({ user_id: owner.user.id, opportunity_id: opportunity, status: 'planned' })
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.status, 'planned');
  assert.equal(data.user_id, owner.user.id);
});

void test('the owner can move planned -> applied', async () => {
  const opportunity = await opportunityId();
  const { data: created } = await owner.client
    .from('user_ticket_opportunity_states')
    .insert({ user_id: owner.user.id, opportunity_id: opportunity, status: 'planned' })
    .select()
    .single();
  assert.ok(created);

  const { data, error } = await owner.client
    .from('user_ticket_opportunity_states')
    .update({ status: 'applied' })
    .eq('id', created.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.status, 'applied');
});

void test('the owner can move applied -> planned', async () => {
  const opportunity = await opportunityId();
  const { data: created } = await owner.client
    .from('user_ticket_opportunity_states')
    .insert({ user_id: owner.user.id, opportunity_id: opportunity, status: 'applied' })
    .select()
    .single();
  assert.ok(created);

  const { data, error } = await owner.client
    .from('user_ticket_opportunity_states')
    .update({ status: 'planned' })
    .eq('id', created.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.status, 'planned');
});

void test('the owner can remove their personal state', async () => {
  const opportunity = await opportunityId();
  const { data: created } = await owner.client
    .from('user_ticket_opportunity_states')
    .insert({ user_id: owner.user.id, opportunity_id: opportunity, status: 'planned' })
    .select()
    .single();
  assert.ok(created);

  const { error } = await owner.client
    .from('user_ticket_opportunity_states')
    .delete()
    .eq('id', created.id);
  assert.equal(error, null);

  const stored = await readMyStateAsAdmin(owner.user.id, opportunity);
  assert.equal(stored, null);
});

// --- Negative: status vocabulary ---

void test('state status is limited to planned/applied', async () => {
  const opportunity = await opportunityId();
  for (const status of ['pending', 'secured', 'unsuccessful', '']) {
    const { error } = await owner.client
      .from('user_ticket_opportunity_states')
      .insert({ user_id: owner.user.id, opportunity_id: opportunity, status });
    assert.ok(error, `expected status "${status}" to be rejected`);
  }
});

// --- Negative: uniqueness ---

void test('a duplicate (user, opportunity) row is rejected', async () => {
  const opportunity = await opportunityId();
  const { error: firstError } = await owner.client
    .from('user_ticket_opportunity_states')
    .insert({ user_id: owner.user.id, opportunity_id: opportunity, status: 'planned' });
  assert.equal(firstError, null);

  const { error } = await owner.client
    .from('user_ticket_opportunity_states')
    .insert({ user_id: owner.user.id, opportunity_id: opportunity, status: 'applied' });
  assert.ok(
    error,
    'expected a unique-constraint violation for a duplicate (user, opportunity) row',
  );
});

// --- Negative: privacy ---

void test('another authenticated user cannot read someone else’s state', async () => {
  const opportunity = await opportunityId();
  const { data: created } = await owner.client
    .from('user_ticket_opportunity_states')
    .insert({ user_id: owner.user.id, opportunity_id: opportunity, status: 'planned' })
    .select()
    .single();
  assert.ok(created);

  const { data, error } = await otherUser.client
    .from('user_ticket_opportunity_states')
    .select()
    .eq('id', created.id);
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

void test('another authenticated user cannot update someone else’s state', async () => {
  const opportunity = await opportunityId();
  const { data: created } = await owner.client
    .from('user_ticket_opportunity_states')
    .insert({ user_id: owner.user.id, opportunity_id: opportunity, status: 'planned' })
    .select()
    .single();
  assert.ok(created);

  const { data, error } = await otherUser.client
    .from('user_ticket_opportunity_states')
    .update({ status: 'applied' })
    .eq('id', created.id)
    .select();
  assert.equal(error, null);
  assert.deepEqual(data, []);

  const stored = await readMyStateAsAdmin(owner.user.id, opportunity);
  assert.equal(stored?.status, 'planned');
});

void test('another authenticated user cannot delete someone else’s state', async () => {
  const opportunity = await opportunityId();
  const { data: created } = await owner.client
    .from('user_ticket_opportunity_states')
    .insert({ user_id: owner.user.id, opportunity_id: opportunity, status: 'planned' })
    .select()
    .single();
  assert.ok(created);

  const { data, error } = await otherUser.client
    .from('user_ticket_opportunity_states')
    .delete()
    .eq('id', created.id)
    .select();
  assert.equal(error, null);
  assert.deepEqual(data, []);

  const stored = await readMyStateAsAdmin(owner.user.id, opportunity);
  assert.ok(stored, 'expected the row to still exist');
});

void test('a user cannot create a state owned by someone else', async () => {
  const opportunity = await opportunityId();
  const { error } = await otherUser.client
    .from('user_ticket_opportunity_states')
    .insert({ user_id: owner.user.id, opportunity_id: opportunity, status: 'planned' });
  assert.ok(error, 'expected an RLS violation for owner spoofing on insert');
});

// --- Negative: anonymous ---

void test('anonymous cannot read/write personal states', async () => {
  const opportunity = await opportunityId();
  const anon = createAnonymousClient();

  const readResult = await anon.from('user_ticket_opportunity_states').select();
  assert.ok(readResult.error, 'expected a permission error for anonymous select');

  const insertResult = await anon
    .from('user_ticket_opportunity_states')
    .insert({ user_id: owner.user.id, opportunity_id: opportunity, status: 'planned' });
  assert.ok(insertResult.error, 'expected a permission error for anonymous insert');
});

// --- Negative: immutable / system-managed fields ---

void test('a state cannot be handed to another user', async () => {
  const opportunity = await opportunityId();
  const { data: created } = await owner.client
    .from('user_ticket_opportunity_states')
    .insert({ user_id: owner.user.id, opportunity_id: opportunity, status: 'planned' })
    .select()
    .single();
  assert.ok(created);

  const { error } = await owner.client
    .from('user_ticket_opportunity_states')
    .update({ user_id: otherUser.user.id })
    .eq('id', created.id);
  assert.ok(error, 'expected a permission error for changing user_id');

  const stored = await readMyStateAsAdmin(owner.user.id, opportunity);
  assert.equal(stored?.user_id, owner.user.id);
});

void test('a state cannot be re-pointed at a different opportunity', async () => {
  const opportunity = await opportunityId();
  const otherOpportunity = await opportunityId();
  const { data: created } = await owner.client
    .from('user_ticket_opportunity_states')
    .insert({ user_id: owner.user.id, opportunity_id: opportunity, status: 'planned' })
    .select()
    .single();
  assert.ok(created);

  const { error } = await owner.client
    .from('user_ticket_opportunity_states')
    .update({ opportunity_id: otherOpportunity })
    .eq('id', created.id);
  assert.ok(error, 'expected a permission error for changing opportunity_id');

  const stored = await readMyStateAsAdmin(owner.user.id, opportunity);
  assert.ok(stored, 'expected the original row to still exist under the original opportunity');
});

// --- Independence: official/shared writes never touch personal state ---

void test('re-importing an opportunity does not create, change, or remove personal state', async () => {
  const { event, occurrence } = await createEventWithOccurrence(catalogOwner);
  const sourceKey = `rls-independence-${String(Date.now())}`;
  const opportunity = await importOpportunity(event.id, { sourceKey, displayName: '第1抽選' });

  const { error: insertError } = await owner.client
    .from('user_ticket_opportunity_states')
    .insert({ user_id: owner.user.id, opportunity_id: opportunity.id, status: 'planned' });
  assert.equal(insertError, null);

  await importOpportunity(event.id, {
    sourceKey,
    displayName: '第1抽選（更新）',
    targetScope: 'selected_occurrences',
    occurrenceIds: [occurrence.id],
  });

  const stored = await readMyStateAsAdmin(owner.user.id, opportunity.id);
  assert.equal(
    stored?.status,
    'planned',
    'expected personal state to survive the re-import untouched',
  );

  const otherUserState = await readMyStateAsAdmin(otherUser.user.id, opportunity.id);
  assert.equal(otherUserState, null, 'expected the import to never create a state for any user');
});
