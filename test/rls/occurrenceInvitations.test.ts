import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import pg from 'pg';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';
import { createEventWithOccurrence } from './support/eventFixtures.ts';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';
import {
  createOccurrenceWithAttendee,
  inviteToOccurrence,
  inviteToOccurrenceOrThrow,
  readOwnParticipation,
  setParticipation,
  type InvitationRow,
} from './support/participationFixtures.ts';

// Real local Supabase/Postgres tests for public.occurrence_invitations and
// public.invite_to_occurrence (Issue #30). See test/rls/events.test.ts's
// header comment for the anon/service_role/authenticated client conventions,
// and for why a denied UPDATE surfaces as an empty result set rather than an
// error.
//
// The three-branch invitation semantics in product-rules.md are what most of
// this file exists to pin down:
//
//   invitee has no participation -> invitation + `considering`
//   invitee is `considering`     -> invitation, participation untouched
//   invitee is `attending`       -> no invitation at all, `attending` intact
//
// Every assertion about the invitee's participation reads it back through
// the invitee's own client, never service_role: those rows are private by
// default, and reading them any other way would not be evidence about what
// a real client can observe.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let catalogOwner: TestActor;
let inviter: TestActor;
let invitee: TestActor;
let other: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  catalogOwner = await createTestActor('rls-inv-catalog', PASSWORD);
  createdActors.push(catalogOwner);
  inviter = await createTestActor('rls-inv-inviter', PASSWORD);
  createdActors.push(inviter);
  invitee = await createTestActor('rls-inv-invitee', PASSWORD);
  createdActors.push(invitee);
  other = await createTestActor('rls-inv-other', PASSWORD);
  createdActors.push(other);
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

/** An occurrence on which `inviter` is already attending, i.e. invite-eligible. */
async function invitableOccurrence(): Promise<string> {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  return occurrenceId;
}

async function invitationsFrom(actor: TestActor, occurrence: string): Promise<InvitationRow[]> {
  const { data, error } = await actor.client
    .from('occurrence_invitations')
    .select()
    .eq('occurrence_id', occurrence);
  assert.equal(error, null);
  return data;
}

// --- Branch 1: invitee has no participation row ---

void test('inviting a user with no participation creates the invitation and a considering participation', async () => {
  const occurrence = await invitableOccurrence();
  const invitation = await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);

  assert.equal(invitation.occurrence_id, occurrence);
  assert.equal(invitation.inviter_id, inviter.user.id);
  assert.equal(invitation.invitee_id, invitee.user.id);
  assert.equal(invitation.declined_at, null);

  const participation = await readOwnParticipation(invitee, occurrence);
  assert.equal(participation?.status, 'considering');
});

// The invitee's new participation follows the normal default, so the act of
// being invited does not publish anything about them - not even to the
// person who invited them.
void test('the participation created by an invitation is private', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);

  const participation = await readOwnParticipation(invitee, occurrence);
  assert.equal(participation?.visibility, 'private');

  const { data, error } = await inviter.client
    .from('occurrence_participations')
    .select()
    .eq('occurrence_id', occurrence)
    .eq('user_id', invitee.user.id);
  assert.equal(error, null);
  assert.deepEqual(data, [], 'inviting someone must not let the inviter read their participation');
});

// --- Branch 2: invitee is already considering ---

void test('inviting a considering user creates the invitation and leaves the participation untouched', async () => {
  const occurrence = await invitableOccurrence();
  const before = await setParticipation(invitee, occurrence, 'considering');

  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);

  const participation = await readOwnParticipation(invitee, occurrence);
  assert.equal(participation?.status, 'considering');
  assert.equal(participation?.id, before.id, 'the existing row must be kept, not replaced');
  // updated_at only moves on a real UPDATE, so an unchanged value is direct
  // evidence that this branch performed no write against the row at all.
  assert.equal(participation?.updated_at, before.updated_at);
});

// --- Branch 3: invitee is already attending ---

void test('an already-attending user is out of scope for invite: no invitation row is created', async () => {
  const occurrence = await invitableOccurrence();
  const before = await setParticipation(invitee, occurrence, 'attending');

  const { error } = await inviteToOccurrence(inviter, occurrence, invitee.user.id);
  assert.ok(error, 'expected inviting an already-attending user to be rejected');

  const participation = await readOwnParticipation(invitee, occurrence);
  assert.equal(participation?.status, 'attending', 'attending must not be demoted');
  assert.equal(participation?.updated_at, before.updated_at, 'the row must not be rewritten');

  assert.deepEqual(
    await invitationsFrom(inviter, occurrence),
    [],
    'the rejected call must leave no invitation behind',
  );
});

// --- Inviter eligibility ---

void test('a considering user cannot invite', async () => {
  const { occurrence } = await createEventWithOccurrence(catalogOwner);
  await setParticipation(inviter, occurrence.id, 'considering');

  const { error } = await inviteToOccurrence(inviter, occurrence.id, invitee.user.id);
  assert.ok(error, 'expected considering to be insufficient for invite eligibility');
  assert.deepEqual(await invitationsFrom(inviter, occurrence.id), []);
  assert.equal(await readOwnParticipation(invitee, occurrence.id), null);
});

void test('a user with no participation cannot invite', async () => {
  const { occurrence } = await createEventWithOccurrence(catalogOwner);

  const { error } = await inviteToOccurrence(inviter, occurrence.id, invitee.user.id);
  assert.ok(error, 'expected a non-participant to be ineligible to invite');
  assert.deepEqual(await invitationsFrom(inviter, occurrence.id), []);
});

// product-rules.md is explicit that owning the event is an
// information-management role only - it confers no participation and no
// invite right.
void test('the parent event owner cannot invite without attending', async () => {
  const { occurrence } = await createEventWithOccurrence(catalogOwner);

  const { error } = await inviteToOccurrence(catalogOwner, occurrence.id, invitee.user.id);
  assert.ok(error, 'expected event ownership alone to be insufficient for invite eligibility');
  assert.deepEqual(await invitationsFrom(catalogOwner, occurrence.id), []);
  assert.equal(await readOwnParticipation(invitee, occurrence.id), null);
});

// The mirror image of the test above: what makes someone eligible is
// attending, and nothing else - so the event owner becomes eligible exactly
// when they start attending, not because they own anything.
void test('the parent event owner can invite once they are attending', async () => {
  const { occurrence } = await createEventWithOccurrence(catalogOwner);
  await setParticipation(catalogOwner, occurrence.id, 'attending');

  const invitation = await inviteToOccurrenceOrThrow(catalogOwner, occurrence.id, invitee.user.id);
  assert.equal(invitation.inviter_id, catalogOwner.user.id);
});

void test('a user cannot invite themselves', async () => {
  const occurrence = await invitableOccurrence();
  const { error } = await inviteToOccurrence(inviter, occurrence, inviter.user.id);
  assert.ok(error, 'expected self-invitation to be rejected');
});

// --- Invariant: an inviter cannot drive the invitee's status ---

void test('an inviter cannot promote the invitee to attending', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);

  const { data, error } = await inviter.client
    .from('occurrence_participations')
    .update({ status: 'attending' })
    .eq('occurrence_id', occurrence)
    .eq('user_id', invitee.user.id)
    .select();
  assert.equal(error, null);
  assert.deepEqual(data, []);

  const participation = await readOwnParticipation(invitee, occurrence);
  assert.equal(participation?.status, 'considering', 'only the invitee may confirm attendance');
});

void test('an inviter cannot demote the invitee’s attending back to considering', async () => {
  const occurrence = await invitableOccurrence();
  const before = await setParticipation(invitee, occurrence, 'attending');

  const { data, error } = await inviter.client
    .from('occurrence_participations')
    .update({ status: 'considering' })
    .eq('id', before.id)
    .select();
  assert.equal(error, null);
  assert.deepEqual(data, []);

  const participation = await readOwnParticipation(invitee, occurrence);
  assert.equal(participation?.status, 'attending');
});

// --- Decline ---

void test('the invitee can decline, and the inviter can see it', async () => {
  const occurrence = await invitableOccurrence();
  const invitation = await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);

  const declinedAt = new Date().toISOString();
  const { data, error } = await invitee.client
    .from('occurrence_invitations')
    .update({ declined_at: declinedAt })
    .eq('id', invitation.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.ok(data.declined_at);

  const [seenByInviter] = await invitationsFrom(inviter, occurrence);
  assert.ok(seenByInviter?.declined_at, 'the inviter must be able to observe the decline');
});

// Declining is expressed entirely on the invitation. product-rules.md rules
// out representing it as a `not_attending` participation, and this checks
// the participation side is genuinely left alone rather than mirrored.
void test('declining does not write anything to the invitee’s participation', async () => {
  const occurrence = await invitableOccurrence();
  const invitation = await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const before = await readOwnParticipation(invitee, occurrence);

  await invitee.client
    .from('occurrence_invitations')
    .update({ declined_at: new Date().toISOString() })
    .eq('id', invitation.id);

  const after = await readOwnParticipation(invitee, occurrence);
  assert.equal(after?.status, 'considering');
  assert.equal(after?.updated_at, before?.updated_at);
});

void test('the inviter cannot decline on the invitee’s behalf', async () => {
  const occurrence = await invitableOccurrence();
  const invitation = await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);

  const { data, error } = await inviter.client
    .from('occurrence_invitations')
    .update({ declined_at: new Date().toISOString() })
    .eq('id', invitation.id)
    .select();
  assert.equal(error, null);
  assert.deepEqual(data, []);

  const [refetched] = await invitationsFrom(inviter, occurrence);
  assert.equal(refetched?.declined_at, null);
});

void test('re-inviting a declined invitee neither clears the decline nor duplicates the row', async () => {
  const occurrence = await invitableOccurrence();
  const invitation = await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  await invitee.client
    .from('occurrence_invitations')
    .update({ declined_at: new Date().toISOString() })
    .eq('id', invitation.id);

  const again = await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  assert.equal(again.id, invitation.id);
  assert.ok(again.declined_at, 'a repeat invite must not clear declined_at');
  assert.equal((await invitationsFrom(inviter, occurrence)).length, 1);
});

// --- Idempotency ---

void test('re-inviting after the invitee withdrew does not re-create their participation', async () => {
  const occurrence = await invitableOccurrence();
  const invitation = await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);

  await invitee.client
    .from('occurrence_participations')
    .delete()
    .eq('occurrence_id', occurrence)
    .eq('user_id', invitee.user.id);
  assert.equal(await readOwnParticipation(invitee, occurrence), null);

  const again = await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  assert.equal(again.id, invitation.id);
  assert.equal(
    await readOwnParticipation(invitee, occurrence),
    null,
    'a repeat invite must not resurrect a participation the invitee removed',
  );
});

void test('two different attendees can each invite the same user', async () => {
  const occurrence = await invitableOccurrence();
  await setParticipation(other, occurrence, 'attending');

  const first = await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const second = await inviteToOccurrenceOrThrow(other, occurrence, invitee.user.id);
  assert.notEqual(first.id, second.id);

  const participation = await readOwnParticipation(invitee, occurrence);
  assert.equal(participation?.status, 'considering');
});

// --- Concurrency ---

void test('concurrent identical invites settle on one invitation and one participation', async () => {
  const occurrence = await invitableOccurrence();

  const results = await Promise.all(
    Array.from({ length: 4 }, () => inviteToOccurrence(inviter, occurrence, invitee.user.id)),
  );
  for (const result of results) {
    assert.equal(result.error, null);
  }
  const ids = new Set(results.map((result) => result.data?.id));
  assert.equal(ids.size, 1, 'every concurrent call must resolve to the same invitation');

  assert.equal((await invitationsFrom(inviter, occurrence)).length, 1);
  const participation = await readOwnParticipation(invitee, occurrence);
  assert.equal(participation?.status, 'considering');
});

// The check-then-act inside invite_to_occurrence is the risky part: if it
// could interleave with the invitee confirming attendance, an invitation
// would be able to overwrite a confirmed `attending`. Whichever side wins
// the race, an `attending` write the invitee saw succeed must still stand.
void test('an invite racing the invitee’s own attending insert never leaves them considering', async () => {
  const occurrence = await invitableOccurrence();

  const [, selfResult] = await Promise.all([
    inviteToOccurrence(inviter, occurrence, invitee.user.id),
    invitee.client.from('occurrence_participations').insert({
      occurrence_id: occurrence,
      user_id: invitee.user.id,
      status: 'attending',
    }),
  ]);

  const participation = await readOwnParticipation(invitee, occurrence);
  assert.ok(participation, 'the invitee must end up with exactly one participation');
  if (selfResult.error === null) {
    assert.equal(
      participation.status,
      'attending',
      'an attending write that reported success must not be undone by a concurrent invite',
    );
  }
});

// Same race, but from `considering`: here the invitee's UPDATE always
// succeeds (it is their own row), so the expected end state is unambiguous
// regardless of which transaction commits first.
void test('an invite racing the invitee’s own confirmation ends with attending', async () => {
  const occurrence = await invitableOccurrence();
  const existing = await setParticipation(invitee, occurrence, 'considering');

  const [, updateResult] = await Promise.all([
    inviteToOccurrence(inviter, occurrence, invitee.user.id),
    invitee.client
      .from('occurrence_participations')
      .update({ status: 'attending' })
      .eq('id', existing.id)
      .select(),
  ]);
  assert.equal(updateResult.error, null);
  assert.equal(updateResult.data?.length, 1);

  const participation = await readOwnParticipation(invitee, occurrence);
  assert.equal(participation?.status, 'attending');
});

// --- Negative: anonymous ---

void test('anonymous cannot execute the invite RPC', async () => {
  const occurrence = await invitableOccurrence();
  const anon = createAnonymousClient();
  const { error } = await anon.rpc('invite_to_occurrence', {
    p_occurrence_id: occurrence,
    p_invitee_id: invitee.user.id,
  });
  assert.ok(error, 'expected a permission error for anonymous RPC execution');
});

void test('anonymous cannot read invitations', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.from('occurrence_invitations').select();
  assert.ok(error, 'expected a permission error for anonymous select');
});

void test('anonymous cannot update invitations', async () => {
  const occurrence = await invitableOccurrence();
  const invitation = await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const anon = createAnonymousClient();
  const { error } = await anon
    .from('occurrence_invitations')
    .update({ declined_at: new Date().toISOString() })
    .eq('id', invitation.id);
  assert.ok(error, 'expected a permission error for anonymous update');
});

// --- Negative: visibility to third parties ---

void test('an unrelated authenticated user cannot read someone else’s invitation', async () => {
  const occurrence = await invitableOccurrence();
  const invitation = await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);

  const { data, error } = await other.client
    .from('occurrence_invitations')
    .select()
    .eq('id', invitation.id);
  assert.equal(error, null);
  assert.deepEqual(data, [], 'invitations are visible only to the inviter and the invitee');
});

void test('the invitee can read the invitation addressed to them', async () => {
  const occurrence = await invitableOccurrence();
  const invitation = await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);

  const { data, error } = await invitee.client
    .from('occurrence_invitations')
    .select()
    .eq('id', invitation.id);
  assert.equal(error, null);
  assert.equal(data.length, 1);
});

// --- Negative: create/delete boundary ---

void test('an authenticated client cannot directly INSERT an invitation', async () => {
  const occurrence = await invitableOccurrence();
  const { error } = await inviter.client.from('occurrence_invitations').insert({
    occurrence_id: occurrence,
    inviter_id: inviter.user.id,
    invitee_id: invitee.user.id,
  });
  assert.ok(
    error,
    'expected direct authenticated INSERT into occurrence_invitations to be unsupported',
  );
  assert.deepEqual(await invitationsFrom(inviter, occurrence), []);
});

void test('an invitation cannot be deleted by either party', async () => {
  const occurrence = await invitableOccurrence();
  const invitation = await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);

  const { error: inviterError } = await inviter.client
    .from('occurrence_invitations')
    .delete()
    .eq('id', invitation.id);
  assert.ok(inviterError, 'expected DELETE to be unsupported for the inviter');

  const { error: inviteeError } = await invitee.client
    .from('occurrence_invitations')
    .delete()
    .eq('id', invitation.id);
  assert.ok(inviteeError, 'expected DELETE to be unsupported for the invitee');

  assert.equal((await invitationsFrom(inviter, occurrence)).length, 1);
});

// Direct privilege/policy inspection rather than a behavioral probe: this
// proves *why* the two tests above fail. Unlike events - where an INSERT
// policy was deliberately left in place as a second layer after the grant
// was revoked - occurrence_invitations has neither an INSERT grant nor an
// INSERT policy, so re-adding a grant alone would still not open a direct
// create path. Connects as the DB superuser since this reads catalog
// metadata, not RLS-governed application data.
void test('occurrence_invitations exposes no INSERT or DELETE surface to authenticated', async () => {
  const status = readLocalSupabaseStatus();
  const client = new pg.Client({ connectionString: status.dbUrl });
  await client.connect();
  try {
    const { rows: grants } = await client.query<{ privilege_type: string; column_name: string }>(
      `select privilege_type, column_name
       from information_schema.role_column_grants
       where table_schema = 'public'
         and table_name = 'occurrence_invitations'
         and grantee = 'authenticated'
       order by privilege_type, column_name`,
    );
    assert.deepEqual(
      grants
        .filter((grant) => grant.privilege_type !== 'SELECT')
        .map((grant) => `${grant.privilege_type} ${grant.column_name}`),
      ['UPDATE declined_at'],
      'declined_at UPDATE must be the only non-SELECT grant authenticated holds',
    );

    const { rows: policies } = await client.query<{ cmd: string }>(
      `select distinct cmd
       from pg_policies
       where schemaname = 'public'
         and tablename = 'occurrence_invitations'
       order by cmd`,
    );
    assert.deepEqual(
      policies.map((policy) => policy.cmd),
      ['SELECT', 'UPDATE'],
      'expected no INSERT or DELETE policy on occurrence_invitations',
    );
  } finally {
    await client.end();
  }
});
