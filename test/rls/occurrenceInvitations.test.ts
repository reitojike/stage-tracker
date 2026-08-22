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
  declineInvitation,
  declineInvitationOrThrow,
  invitationReceived,
  invitationsReceived,
  inviteToOccurrence,
  inviteToOccurrenceOrThrow,
  readInvitation,
  readOwnParticipation,
  setParticipation,
} from './support/participationFixtures.ts';

// Real local Supabase/Postgres tests for public.occurrence_invitations,
// public.invite_to_occurrence and public.decline_occurrence_invitation
// (Issue #30). See test/rls/events.test.ts's header comment for the
// anon/service_role/authenticated client conventions, and for why a denied
// UPDATE surfaces as an empty result set rather than an error.
//
// The three-branch invitation semantics in product-rules.md are what most of
// this file exists to pin down:
//
//   invitee has no participation -> invitation + `considering`
//   invitee is `considering`     -> invitation, participation untouched
//   invitee is `attending`       -> no invitation at all, `attending` intact
//
// The second thing it pins down is that the *inviter cannot tell which of
// those three happened*. Which branch runs is decided entirely by the
// invitee's participation, and participation is private by default, so
// invite_to_occurrence returns void in every branch and only the invitee can
// read an invitation back. See the "Opacity" section below.
//
// Every assertion about the invitee's participation or invitations reads it
// back through the invitee's own client, never service_role: those rows are
// private, and reading them any other way would not be evidence about what a
// real client can observe.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let catalogOwner: TestActor;
let inviter: TestActor;
let invitee: TestActor;
let other: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  // Event creation is restricted to designated catalog creators (Issue
  // #29), and every occurrence here needs a parent event. That gate is
  // orthogonal to invite eligibility: 'the parent event owner cannot invite
  // without attending' below is exactly the point.
  catalogOwner = await createTestActor('rls-inv-catalog', PASSWORD, {
    designatedCatalogCreator: true,
  });
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

/** The invitation the invitee received, failing the test if there is none. */
async function requireInvitation(occurrence: string) {
  const invitation = await invitationReceived(invitee, occurrence);
  assert.ok(invitation, 'expected the invitee to have received an invitation');
  return invitation;
}

// --- Branch 1: invitee has no participation row ---

void test('inviting a user with no participation creates the invitation and a considering participation', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);

  const invitation = await requireInvitation(occurrence);
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

  const invitation = await requireInvitation(occurrence);
  assert.equal(invitation.inviter_id, inviter.user.id);

  const participation = await readOwnParticipation(invitee, occurrence);
  assert.equal(participation?.status, 'considering');
  assert.equal(participation.id, before.id, 'the existing row must be kept, not replaced');
  // updated_at only moves on a real UPDATE, so an unchanged value is direct
  // evidence that this branch performed no write against the row at all.
  assert.equal(participation.updated_at, before.updated_at);
});

// --- Branch 3: invitee is already attending ---

void test('an already-attending user is out of scope for invite: no invitation row is created', async () => {
  const occurrence = await invitableOccurrence();
  const before = await setParticipation(invitee, occurrence, 'attending');

  // No error: the caller is told nothing, because "which branch ran" is the
  // invitee's private participation state. What must still hold is that
  // nothing was written.
  const { error } = await inviteToOccurrence(inviter, occurrence, invitee.user.id);
  assert.equal(error, null);

  const participation = await readOwnParticipation(invitee, occurrence);
  assert.equal(participation?.status, 'attending', 'attending must not be demoted');
  assert.equal(participation.updated_at, before.updated_at, 'the row must not be rewritten');

  assert.deepEqual(
    await invitationsReceived(invitee, occurrence),
    [],
    'no invitation row may be created for an already-attending invitee',
  );
});

// --- Opacity: the branch taken must not be observable by the inviter ---
//
// Which of the three branches runs is decided by the invitee's participation
// status, and product-rules.md makes participation private by default
// (`private` = 本人のみ). An inviter who could tell "already attending" apart
// from the other two branches would have a one-bit oracle over any user id
// they knew, for any occurrence they attend - which is exactly the privacy
// boundary RLS otherwise enforces. These tests are the regression guard for
// that (Issue #30 PO decision).

void test('all three invitee branches produce an identical RPC result', async () => {
  const noRow = await invitableOccurrence();

  const considering = await invitableOccurrence();
  await setParticipation(invitee, considering, 'considering');

  const attending = await invitableOccurrence();
  await setParticipation(invitee, attending, 'attending');

  const results = [];
  for (const occurrence of [noRow, considering, attending]) {
    const result = await inviter.client.rpc('invite_to_occurrence', {
      p_occurrence_id: occurrence,
      p_invitee_id: invitee.user.id,
    });
    results.push({ data: result.data, error: result.error, status: result.status });
  }

  const [first] = results;
  for (const result of results) {
    assert.deepEqual(
      result,
      first,
      'every branch must answer identically, or the branch taken is observable',
    );
  }
  assert.equal(first?.error, null);
});

// The response being identical is only half of it: the already-attending
// branch is also the only one that writes no invitation row, so an inviter
// who could list their own invitations would recover the same bit from the
// row's absence. That is why SELECT belongs to the invitee alone.
void test('the inviter cannot read back an invitation they created', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);

  // The row really does exist - the invitee can see it.
  await requireInvitation(occurrence);

  const { data, error } = await inviter.client
    .from('occurrence_invitations')
    .select()
    .eq('occurrence_id', occurrence);
  assert.equal(error, null);
  assert.deepEqual(data, [], 'an inviter must not be able to observe their own invitation rows');
});

// The two halves combined, stated as the property that actually matters: an
// attending invitee and a considering one must look the same from outside.
void test('an inviter cannot distinguish an attending invitee from a considering one', async () => {
  const considering = await invitableOccurrence();
  await setParticipation(invitee, considering, 'considering');
  const attending = await invitableOccurrence();
  await setParticipation(invitee, attending, 'attending');

  async function observableOutcome(occurrence: string) {
    const { error } = await inviteToOccurrence(inviter, occurrence, invitee.user.id);
    const { data: visibleInvitations } = await inviter.client
      .from('occurrence_invitations')
      .select()
      .eq('occurrence_id', occurrence);
    const { data: visibleParticipations } = await inviter.client
      .from('occurrence_participations')
      .select()
      .eq('occurrence_id', occurrence)
      .eq('user_id', invitee.user.id);
    return { error, visibleInvitations, visibleParticipations };
  }

  assert.deepEqual(await observableOutcome(considering), await observableOutcome(attending));
});

// --- Inviter eligibility ---

void test('a considering user cannot invite', async () => {
  const { occurrence } = await createEventWithOccurrence(catalogOwner);
  await setParticipation(inviter, occurrence.id, 'considering');

  const { error } = await inviteToOccurrence(inviter, occurrence.id, invitee.user.id);
  assert.ok(error, 'expected considering to be insufficient for invite eligibility');
  assert.deepEqual(await invitationsReceived(invitee, occurrence.id), []);
  assert.equal(await readOwnParticipation(invitee, occurrence.id), null);
});

void test('a user with no participation cannot invite', async () => {
  const { occurrence } = await createEventWithOccurrence(catalogOwner);

  const { error } = await inviteToOccurrence(inviter, occurrence.id, invitee.user.id);
  assert.ok(error, 'expected a non-participant to be ineligible to invite');
  assert.deepEqual(await invitationsReceived(invitee, occurrence.id), []);
});

// product-rules.md is explicit that owning the event is an
// information-management role only - it confers no participation and no
// invite right.
void test('the parent event owner cannot invite without attending', async () => {
  const { occurrence } = await createEventWithOccurrence(catalogOwner);

  const { error } = await inviteToOccurrence(catalogOwner, occurrence.id, invitee.user.id);
  assert.ok(error, 'expected event ownership alone to be insufficient for invite eligibility');
  assert.deepEqual(await invitationsReceived(invitee, occurrence.id), []);
  assert.equal(await readOwnParticipation(invitee, occurrence.id), null);
});

// The mirror image of the test above: what makes someone eligible is
// attending, and nothing else - so the event owner becomes eligible exactly
// when they start attending, not because they own anything.
void test('the parent event owner can invite once they are attending', async () => {
  const { occurrence } = await createEventWithOccurrence(catalogOwner);
  await setParticipation(catalogOwner, occurrence.id, 'attending');

  await inviteToOccurrenceOrThrow(catalogOwner, occurrence.id, invitee.user.id);

  const invitation = await invitationReceived(invitee, occurrence.id);
  assert.equal(invitation?.inviter_id, catalogOwner.user.id);
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
//
// occurrence_invitations has no UPDATE grant and no UPDATE policy, so
// declined_at is reachable only through public.decline_occurrence_invitation.
// These tests pin down both halves of that: the decline itself, and the fact
// that no client can write the column any other way - which is what keeps
// un-declining out of the schema while product-rules.md is silent on it.

void test('the invitee can decline their own invitation', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);

  const declined = await declineInvitationOrThrow(invitee, invitation.id);
  assert.equal(declined.id, invitation.id);
  assert.ok(declined.declined_at);

  assert.ok(
    (await invitationReceived(invitee, occurrence))?.declined_at,
    'the decline must be persisted on the invitation',
  );
});

// Declining is expressed entirely on the invitation. product-rules.md rules
// out representing it as a `not_attending` participation, and this checks
// the participation side is genuinely left alone rather than mirrored.
void test('declining does not write anything to the invitee’s participation', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);
  const before = await readOwnParticipation(invitee, occurrence);

  await declineInvitationOrThrow(invitee, invitation.id);

  const after = await readOwnParticipation(invitee, occurrence);
  assert.equal(after?.status, 'considering');
  assert.equal(after.updated_at, before?.updated_at);
});

void test('the inviter cannot decline on the invitee’s behalf', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);

  const { error } = await declineInvitation(inviter, invitation.id);
  assert.ok(error, 'expected declining an invitation addressed to someone else to fail');

  assert.equal((await readInvitation(invitee, invitation.id))?.declined_at, null);
});

void test('an unrelated user cannot decline someone else’s invitation', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);

  const { error } = await declineInvitation(other, invitation.id);
  assert.ok(error, 'expected a third party decline to fail');
  assert.equal((await readInvitation(invitee, invitation.id))?.declined_at, null);
});

// The one product fact product-rules.md asks for is *that* the invitee
// declined. Nothing has decided what un-declining would mean, so the schema
// must not offer it: declined_at is not writable through the table API at
// all, in either direction.
void test('declined_at is not writable through the table API', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);

  const { error: stampError } = await invitee.client
    .from('occurrence_invitations')
    .update({ declined_at: new Date().toISOString() })
    .eq('id', invitation.id);
  assert.ok(stampError, 'expected a direct declined_at UPDATE to be unsupported');
  assert.equal((await readInvitation(invitee, invitation.id))?.declined_at, null);

  const declined = await declineInvitationOrThrow(invitee, invitation.id);
  assert.ok(declined.declined_at);

  const { error: clearError } = await invitee.client
    .from('occurrence_invitations')
    .update({ declined_at: null })
    .eq('id', invitation.id);
  assert.ok(clearError, 'expected clearing declined_at to be unsupported');
  assert.ok(
    (await readInvitation(invitee, invitation.id))?.declined_at,
    'a decline must not be undoable',
  );
});

// Repeating the same act, not a lifecycle change: the second call must not
// move the timestamp, or "when they declined" would drift on every retry.
void test('declining twice is idempotent and does not re-stamp declined_at', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);

  const first = await declineInvitationOrThrow(invitee, invitation.id);
  const second = await declineInvitationOrThrow(invitee, invitation.id);
  assert.equal(second.declined_at, first.declined_at);
});

// Re-inviting after a decline is a product operation nothing has defined.
// The RPC refuses it rather than answering with a silent no-op or a fresh
// `considering` row - either of which would settle the undecided semantics
// by accident.
//
// This refusal is not a hole in the opacity guarantee above: it fires on the
// inviter's own prior invitation, before the participation branch runs, so
// it says nothing about the invitee's current status.
void test('re-inviting a declined invitee is refused and changes nothing', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);
  const declined = await declineInvitationOrThrow(invitee, invitation.id);

  const { error } = await inviteToOccurrence(inviter, occurrence, invitee.user.id);
  assert.ok(error, 'expected re-inviting a declined invitee to be refused');

  const rows = await invitationsReceived(invitee, occurrence);
  assert.equal(rows.length, 1, 'a refused re-invite must not stack a second invitation');
  assert.equal(rows[0]?.declined_at, declined.declined_at, 'the decline must be left as it was');
});

// Same refusal, but with the invitee's participation removed first: the
// branch that creates a `considering` row must not run for a declined
// invitation.
void test('re-inviting a declined invitee does not re-create their participation', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);
  await declineInvitationOrThrow(invitee, invitation.id);

  await invitee.client
    .from('occurrence_participations')
    .delete()
    .eq('occurrence_id', occurrence)
    .eq('user_id', invitee.user.id);

  const { error } = await inviteToOccurrence(inviter, occurrence, invitee.user.id);
  assert.ok(error);
  assert.equal(
    await readOwnParticipation(invitee, occurrence),
    null,
    'a refused re-invite must not resurrect a participation',
  );
});

// A decline is scoped to the invitation it was made on, not to the invitee:
// another attendee's invitation is a separate record and a separate act, so
// it is not blocked by an earlier decline of someone else's invitation.
void test('a decline does not block a different inviter from inviting', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);
  await declineInvitationOrThrow(invitee, invitation.id);
  await setParticipation(other, occurrence, 'attending');

  await inviteToOccurrenceOrThrow(other, occurrence, invitee.user.id);

  const rows = await invitationsReceived(invitee, occurrence);
  assert.equal(rows.length, 2);
  const fromOther = rows.find((row) => row.inviter_id === other.user.id);
  assert.ok(fromOther, 'the second attendee’s invitation must exist');
  assert.equal(fromOther.declined_at, null);
});

// --- Idempotency ---

void test('re-inviting after the invitee withdrew does not re-create their participation', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);

  await invitee.client
    .from('occurrence_participations')
    .delete()
    .eq('occurrence_id', occurrence)
    .eq('user_id', invitee.user.id);
  assert.equal(await readOwnParticipation(invitee, occurrence), null);

  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  assert.equal((await requireInvitation(occurrence)).id, invitation.id);
  assert.equal(
    await readOwnParticipation(invitee, occurrence),
    null,
    'a repeat invite must not resurrect a participation the invitee removed',
  );
});

void test('two different attendees can each invite the same user', async () => {
  const occurrence = await invitableOccurrence();
  await setParticipation(other, occurrence, 'attending');

  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  await inviteToOccurrenceOrThrow(other, occurrence, invitee.user.id);

  const rows = await invitationsReceived(invitee, occurrence);
  assert.equal(rows.length, 2, 'each inviter gets their own invitation record');
  assert.deepEqual(
    rows.map((row) => row.inviter_id).sort(),
    [inviter.user.id, other.user.id].sort(),
  );

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

  assert.equal((await invitationsReceived(invitee, occurrence)).length, 1);
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
  assert.equal(updateResult.data.length, 1);

  const participation = await readOwnParticipation(invitee, occurrence);
  assert.equal(participation?.status, 'attending');
});

// decline_occurrence_invitation is also a check-then-act (read the row,
// decide whether it is already declined, then stamp it). FOR UPDATE is what
// keeps two concurrent declines from producing two different timestamps.
void test('concurrent declines settle on a single declined_at', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);

  const results = await Promise.all(
    Array.from({ length: 4 }, () => declineInvitation(invitee, invitation.id)),
  );
  for (const result of results) {
    assert.equal(result.error, null);
  }
  const stamps = new Set(results.map((result) => result.data?.declined_at));
  assert.equal(stamps.size, 1, 'every concurrent decline must report the same timestamp');
  assert.equal(
    (await readInvitation(invitee, invitation.id))?.declined_at,
    results[0]?.data?.declined_at,
  );
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
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);
  const anon = createAnonymousClient();
  const { error } = await anon
    .from('occurrence_invitations')
    .update({ declined_at: new Date().toISOString() })
    .eq('id', invitation.id);
  assert.ok(error, 'expected a permission error for anonymous update');
});

void test('anonymous cannot execute the decline RPC', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);
  const anon = createAnonymousClient();
  const { error } = await anon.rpc('decline_occurrence_invitation', {
    p_invitation_id: invitation.id,
  });
  assert.ok(error, 'expected a permission error for anonymous RPC execution');
  assert.equal((await readInvitation(invitee, invitation.id))?.declined_at, null);
});

// --- Negative: visibility ---

void test('an unrelated authenticated user cannot read someone else’s invitation', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);

  const { data, error } = await other.client
    .from('occurrence_invitations')
    .select()
    .eq('id', invitation.id);
  assert.equal(error, null);
  assert.deepEqual(data, [], 'an invitation is visible only to its invitee');
});

void test('the invitee can read the invitation addressed to them', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);

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
  assert.deepEqual(await invitationsReceived(invitee, occurrence), []);
});

void test('an invitation cannot be deleted by either party', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);

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

  assert.equal((await invitationsReceived(invitee, occurrence)).length, 1);
});

// Direct privilege/policy inspection rather than a behavioral probe: this
// proves *why* the write tests above fail. authenticated holds SELECT and
// nothing else, and SELECT is the only policy on the table - so every
// write, including the decline, has to come through a SECURITY DEFINER
// function. Unlike events - where an INSERT policy was deliberately left in
// place as a second layer after the grant was revoked - there is no policy
// here to fall back on, so re-adding a grant alone would still not open a
// direct write path.
//
// The SELECT policy's own predicate is asserted too: a future edit that
// added `inviter_id = auth.uid()` back would reopen the invite side channel
// while every behavioral test above still passed except one, so it is worth
// failing loudly and specifically here. Connects as the DB superuser since
// this reads catalog metadata, not RLS-governed application data.
void test('occurrence_invitations exposes no write surface at all to authenticated', async () => {
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
      [],
      'authenticated must hold no write grant on occurrence_invitations',
    );

    const { rows: policies } = await client.query<{ cmd: string; qual: string | null }>(
      `select cmd, qual
       from pg_policies
       where schemaname = 'public'
         and tablename = 'occurrence_invitations'
       order by cmd`,
    );
    assert.deepEqual(
      policies.map((policy) => policy.cmd),
      ['SELECT'],
      'expected SELECT to be the only policy on occurrence_invitations',
    );
    const [selectPolicy] = policies;
    assert.ok(selectPolicy, 'expected a SELECT policy to exist');
    assert.ok(selectPolicy.qual?.includes('invitee_id'));
    assert.ok(
      !selectPolicy.qual?.includes('inviter_id'),
      'the SELECT policy must not grant the inviter read access - that would reopen the invite side channel',
    );
  } finally {
    await client.end();
  }
});
