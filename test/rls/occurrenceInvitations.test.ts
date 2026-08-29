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
// (Issue #30, updated for Issue #225/#230's pending-only Invitation model -
// see supabase/migrations/20260830000000_simplify_invitation_pending_only.sql).
// See test/rls/events.test.ts's header comment for the anon/service_role/
// authenticated client conventions, and for why a denied UPDATE surfaces as
// an empty result set rather than an error.
//
// The three-branch invitation semantics this file pins down:
//
//   invitee has no participation -> invitation only, participation untouched
//   invitee is `considering`     -> invitation, participation untouched
//   invitee is `attending`       -> no invitation at all, `attending` intact
//
// Unlike the original #30 design, branch 1 no longer creates a `considering`
// participation as a side effect - Issue #225/#230 explicitly removes that
// auto-consider. "Accepting" an invitation is now just the invitee setting
// their own participation to `attending` through the normal path (there is
// no separate accept RPC); doing so - by any path, not only via an
// invitation - resolves (deletes) every pending invitation for that
// (occurrence, invitee) pair via the
// occurrence_participations_resolve_invitations_on_attending trigger.
// Declining now DELETEs the invitation row instead of stamping declined_at,
// so a prior decline no longer permanently blocks re-invitation.
//
// The second thing this file pins down is that the *inviter cannot tell
// which of the three invite branches happened*. Which branch runs is
// decided entirely by the invitee's participation, and participation is
// private by default, so invite_to_occurrence returns void in every branch
// and only the invitee can read an invitation back. See the "Opacity"
// section below.
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

void test('inviting a user with no participation creates only the invitation - Issue #225/#230 removes the former auto-considering side effect', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);

  const invitation = await requireInvitation(occurrence);
  assert.equal(invitation.occurrence_id, occurrence);
  assert.equal(invitation.inviter_id, inviter.user.id);
  assert.equal(invitation.invitee_id, invitee.user.id);
  assert.equal(invitation.declined_at, null);

  assert.equal(
    await readOwnParticipation(invitee, occurrence),
    null,
    'inviting a rowless invitee must not create a participation row',
  );
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
  // Issue #225/#230: invite no longer creates a `considering` participation
  // on its own, so this test sets it explicitly first - what it pins down is
  // that the inviter's own UPDATE attempt cannot touch the invitee's row,
  // regardless of how that row came to exist.
  await setParticipation(invitee, occurrence, 'considering');
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

// --- Decline (Issue #225/#230: pending-only - decline now DELETEs the row
// rather than stamping declined_at) ---
//
// occurrence_invitations has no UPDATE/DELETE grant and no UPDATE/DELETE
// policy, so this row is reachable only through
// public.decline_occurrence_invitation (or the resolve-on-attending
// trigger). These tests pin down the decline itself, that it never touches
// Participation, and that no client can write/remove the row any other way.

void test('decline/no Participation: resolves the pending invitation and creates no Participation', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);
  assert.equal(await readOwnParticipation(invitee, occurrence), null);

  const declined = await declineInvitationOrThrow(invitee, invitation.id);
  assert.equal(declined.id, invitation.id);

  assert.equal(
    await invitationReceived(invitee, occurrence),
    null,
    'a declined invitation must no longer exist as a row',
  );
  assert.equal(
    await readOwnParticipation(invitee, occurrence),
    null,
    'decline must not create a Participation',
  );
});

// Declining is expressed entirely by resolving the invitation.
// product-rules.md rules out representing it as a `not_attending`
// participation, and an existing self-created `considering` must survive a
// decline unchanged (Issue #225/#230: "decline/existing considering ->
// considering維持").
void test('decline/existing considering: resolves the pending invitation and leaves considering untouched', async () => {
  const occurrence = await invitableOccurrence();
  const before = await setParticipation(invitee, occurrence, 'considering');
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);

  await declineInvitationOrThrow(invitee, invitation.id);

  assert.equal(await invitationReceived(invitee, occurrence), null);
  const after = await readOwnParticipation(invitee, occurrence);
  assert.equal(after?.status, 'considering');
  assert.equal(after.id, before.id);
  assert.equal(after.updated_at, before.updated_at, 'decline must not write to the row at all');
});

// decline_occurrence_invitation matches on (id, invitee_id = actor) - an
// invitation addressed to someone else simply matches no row for this
// caller, the same benign `data: null, error: null` outcome as declining an
// already-resolved or nonexistent id (see the idempotence test below and
// declineInvitation's own header comment): this must not become a probe for
// whether a given id exists or who it belongs to.
void test('the inviter cannot decline on the invitee’s behalf: matches no row, changes nothing', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);

  const { data, error } = await declineInvitation(inviter, invitation.id);
  assert.equal(error, null);
  assert.equal(data, null);

  assert.ok(
    await invitationReceived(invitee, occurrence),
    'the invitation must still be pending after a decline attempt that matched no row',
  );
});

void test('an unrelated user cannot decline someone else’s invitation: matches no row, changes nothing', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);

  const { data, error } = await declineInvitation(other, invitation.id);
  assert.equal(error, null);
  assert.equal(data, null);
  assert.ok(await invitationReceived(invitee, occurrence));
});

// The row's own declined_at column still exists (this PR does not drop
// schema) but nothing ever writes it again - decline resolves the row by
// deleting it. This pins down that a direct table UPDATE remains unsupported
// regardless.
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
});

// Repeating the same act, not a lifecycle change: a second decline call for
// an already-resolved invitation is a benign no-op (`data: null`), never an
// error - this is what makes the client's own finalize-on-timer-or-unmount
// path (src/app/catalog/_components/InvitationCard.tsx) safe to call twice
// under a race.
void test('declining twice is idempotent: the second call finds no row and reports no error', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);

  const first = await declineInvitationOrThrow(invitee, invitation.id);
  assert.equal(first.id, invitation.id);

  const { data: second, error } = await declineInvitation(invitee, invitation.id);
  assert.equal(error, null);
  assert.equal(second, null, 'declining an already-resolved invitation must report data: null');
});

// A prior decline must not permanently block re-invitation (Issue #225/#230
// addendum, superseding #30's original refusal): since decline deletes the
// row, a later invite for the same (occurrence, inviter, invitee) finds no
// existing row and creates a fresh pending one.
void test('re-inviting a declined invitee creates a new pending invitation (a prior decline is not a permanent block)', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const firstInvitation = await requireInvitation(occurrence);
  await declineInvitationOrThrow(invitee, firstInvitation.id);
  assert.equal(await invitationReceived(invitee, occurrence), null);

  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);

  const secondInvitation = await requireInvitation(occurrence);
  assert.notEqual(
    secondInvitation.id,
    firstInvitation.id,
    'the re-invite must be a fresh row, not a resurrected one',
  );
  assert.equal(secondInvitation.declined_at, null);
});

// The re-invite still goes through the normal no-participation branch - it
// must not resurrect a participation just because this invitee/occurrence
// pair was invited before.
void test('re-inviting a declined invitee does not create their participation', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);
  await declineInvitationOrThrow(invitee, invitation.id);

  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);

  assert.equal(
    await readOwnParticipation(invitee, occurrence),
    null,
    're-inviting must not create a participation for the invitee',
  );
});

// Accepting elsewhere (attending) after a decline must not be permanently
// blocked either - the addendum: "accept -> later self-withdraw does not
// permanently prevent a future invitation" pairs with this: a decline does
// not prevent the invitee from later becoming attending through the normal
// participation UI, independent of any invitation at all.
void test('after declining, the invitee can still set their own participation to attending directly', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);
  await declineInvitationOrThrow(invitee, invitation.id);

  await setParticipation(invitee, occurrence, 'attending');

  const participation = await readOwnParticipation(invitee, occurrence);
  assert.equal(participation?.status, 'attending');
});

// A decline is scoped to the invitation it was made on, not to the invitee:
// another attendee's invitation is a separate record and a separate act, so
// it is not blocked by an earlier decline of someone else's invitation. And
// since decline now deletes rather than marks, only the still-pending
// invitation (from `other`) remains afterward.
void test('a decline does not block a different inviter from inviting, and only the still-pending invitation remains', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);
  await declineInvitationOrThrow(invitee, invitation.id);
  await setParticipation(other, occurrence, 'attending');

  await inviteToOccurrenceOrThrow(other, occurrence, invitee.user.id);

  const rows = await invitationsReceived(invitee, occurrence);
  assert.equal(rows.length, 1, 'the declined invitation must be gone, leaving only the new one');
  const [remaining] = rows;
  assert.ok(remaining);
  assert.equal(remaining.inviter_id, other.user.id);
  assert.equal(remaining.declined_at, null);
});

// --- Generic attending convergence (Issue #225/#230) ---
//
// Accepting an invitation is not a separate operation from setting one's own
// participation to `attending` - both go through the same write, and the
// occurrence_participations_resolve_invitations_on_attending trigger is what
// resolves pending invitations as a side effect, regardless of which UI path
// produced the write.

void test('setting participation to attending directly (not through an invitation) resolves a pending invitation for the same occurrence', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  await requireInvitation(occurrence);

  await setParticipation(invitee, occurrence, 'attending');

  assert.equal(
    await invitationReceived(invitee, occurrence),
    null,
    'a generic attending write must resolve the pending invitation, indistinguishably from an explicit accept',
  );
});

void test('updating an existing considering participation to attending resolves a pending invitation for the same occurrence', async () => {
  const occurrence = await invitableOccurrence();
  const existing = await setParticipation(invitee, occurrence, 'considering');
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  await requireInvitation(occurrence);

  const { error } = await invitee.client
    .from('occurrence_participations')
    .update({ status: 'attending' })
    .eq('id', existing.id);
  assert.equal(error, null);

  assert.equal(await invitationReceived(invitee, occurrence), null);
});

void test('multiple pending inviters: becoming attending resolves every pending invitation for the occurrence at once', async () => {
  const occurrence = await invitableOccurrence();
  await setParticipation(other, occurrence, 'attending');
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  await inviteToOccurrenceOrThrow(other, occurrence, invitee.user.id);
  assert.equal((await invitationsReceived(invitee, occurrence)).length, 2);

  await setParticipation(invitee, occurrence, 'attending');

  assert.deepEqual(
    await invitationsReceived(invitee, occurrence),
    [],
    'no pending invitation may survive once the invitee is attending',
  );
});

// --- Idempotency ---

void test('inviting an invitee with no row twice, with a withdraw between, does not resurrect a participation', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);
  assert.equal(await readOwnParticipation(invitee, occurrence), null);

  // A repeat invite while the invitation is still pending is idempotent -
  // the same row, no new participation.
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  assert.equal((await requireInvitation(occurrence)).id, invitation.id);
  assert.equal(await readOwnParticipation(invitee, occurrence), null);
});

void test('two different attendees can each invite the same rowless user; neither creates a participation', async () => {
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

  assert.equal(
    await readOwnParticipation(invitee, occurrence),
    null,
    'neither invite may create a participation',
  );
});

// --- Concurrency ---

void test('concurrent identical invites settle on one invitation and create no participation', async () => {
  const occurrence = await invitableOccurrence();

  const results = await Promise.all(
    Array.from({ length: 4 }, () => inviteToOccurrence(inviter, occurrence, invitee.user.id)),
  );
  for (const result of results) {
    assert.equal(result.error, null);
  }

  assert.equal((await invitationsReceived(invitee, occurrence)).length, 1);
  assert.equal(await readOwnParticipation(invitee, occurrence), null);
});

// The check-then-act inside invite_to_occurrence is the risky part: if the
// attending short-circuit's read of the invitee's own row could race a
// concurrent transition to attending, invite_to_occurrence might create a
// pending invitation the invitee is already, or about to be, attending for.
// Whichever side wins, the invitee's own attending write - if it reports
// success - must always end up with no pending invitation left over (either
// invite_to_occurrence's own for-share-locked check skips creating one, or
// the resolve-on-attending trigger cleans it up once the attending write
// commits).
void test('an invite racing the invitee’s own attending insert never leaves a pending invitation once attending is confirmed', async () => {
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
  if (selfResult.error === null) {
    assert.equal(
      participation?.status,
      'attending',
      'an attending write that reported success must not be undone by a concurrent invite',
    );
    assert.equal(
      await invitationReceived(invitee, occurrence),
      null,
      'no pending invitation may survive once attending is confirmed',
    );
  }
});

// Same race, but from `considering`: here the invitee's UPDATE always
// succeeds (it is their own row), so the expected end state is unambiguous
// regardless of which transaction commits first.
void test('an invite racing the invitee’s own confirmation ends with attending and no pending invitation', async () => {
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
  assert.equal(await invitationReceived(invitee, occurrence), null);
});

// decline_occurrence_invitation is also a check-then-act (find the row,
// delete it). FOR UPDATE is what keeps only one of several concurrent
// declines from actually finding (and deleting) the row.
void test('concurrent declines settle on exactly one deletion; the rest report data: null with no error', async () => {
  const occurrence = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrence, invitee.user.id);
  const invitation = await requireInvitation(occurrence);

  const results = await Promise.all(
    Array.from({ length: 4 }, () => declineInvitation(invitee, invitation.id)),
  );
  for (const result of results) {
    assert.equal(result.error, null);
  }
  const resolved = results.filter((result) => result.data !== null);
  assert.equal(resolved.length, 1, 'exactly one concurrent decline must actually find the row');
  assert.equal(resolved[0]?.data?.id, invitation.id);
  assert.equal(await invitationReceived(invitee, occurrence), null);
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
  assert.ok(
    await invitationReceived(invitee, occurrence),
    'the invitation must still be pending after a failed anonymous decline attempt',
  );
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
