import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  declineInvitation,
  inviteToOccurrence,
  inviteToOccurrenceByEmail,
  listMyReceivedInvitations,
} from '../../src/infrastructure/supabase/invitation.ts';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';
import { createEventWithOccurrence } from './support/eventFixtures.ts';
import {
  createOccurrenceWithAttendee,
  readOwnParticipation,
  setParticipation,
} from './support/participationFixtures.ts';

// Real local Supabase/RLS tests for the invitation typed boundary (Issue
// #33), over public.occurrence_invitations (Issue #30). Unlike
// test/rls/occurrenceInvitations.test.ts, which exercises the raw RLS
// policies and RPCs directly, this file exercises src/infrastructure/
// supabase/invitation.ts - the typed functions #34-#37 will call.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let catalogOwner: TestActor;
let inviter: TestActor;
let invitee: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  catalogOwner = await createTestActor('rls-typed-inv-catalog', PASSWORD, {
    designatedCatalogCreator: true,
  });
  createdActors.push(catalogOwner);
  inviter = await createTestActor('rls-typed-inv-inviter', PASSWORD);
  createdActors.push(inviter);
  invitee = await createTestActor('rls-typed-inv-invitee', PASSWORD);
  createdActors.push(invitee);
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

void test('inviteToOccurrence creates an invitation and a considering participation for the invitee', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  const result = await inviteToOccurrence(inviter.client, occurrenceId, invitee.user.id);
  assert.deepEqual(result, { ok: true, data: undefined });

  const received = await listMyReceivedInvitations(invitee.client);
  assert.equal(received.ok, true);
  assert.ok(
    received.data.some((i) => i.occurrenceId === occurrenceId && i.inviterId === inviter.user.id),
  );

  const participation = await readOwnParticipation(invitee, occurrenceId);
  assert.equal(participation?.status, 'considering');
});

void test('inviteToOccurrence is opaque when the invitee is already attending: no error, no invitation row', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  await setParticipation(invitee, occurrenceId, 'attending');

  const result = await inviteToOccurrence(inviter.client, occurrenceId, invitee.user.id);
  assert.deepEqual(result, { ok: true, data: undefined });

  const received = await listMyReceivedInvitations(invitee.client);
  assert.equal(received.ok, true);
  assert.ok(!received.data.some((i) => i.occurrenceId === occurrenceId));

  const participation = await readOwnParticipation(invitee, occurrenceId);
  assert.equal(participation?.status, 'attending', 'attending must be left unchanged, not demoted');
});

void test('inviteToOccurrence reports validation for inviting yourself', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  const result = await inviteToOccurrence(inviter.client, occurrenceId, inviter.user.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'validation');
});

void test('inviteToOccurrence reports permission-denied when the inviter is only considering', async () => {
  const { occurrence } = await createEventWithOccurrence(catalogOwner);
  await setParticipation(inviter, occurrence.id, 'considering');

  const result = await inviteToOccurrence(inviter.client, occurrence.id, invitee.user.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'permission-denied');
});

void test('inviteToOccurrence reports validation when re-inviting a declined invitee', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  const first = await inviteToOccurrence(inviter.client, occurrenceId, invitee.user.id);
  assert.equal(first.ok, true);

  const received = await listMyReceivedInvitations(invitee.client);
  assert.equal(received.ok, true);
  const invitation = received.data.find((i) => i.occurrenceId === occurrenceId);
  assert.ok(invitation);
  const declined = await declineInvitation(invitee.client, invitation.id);
  assert.equal(declined.ok, true);

  const second = await inviteToOccurrence(inviter.client, occurrenceId, invitee.user.id);
  assert.equal(second.ok, false);
  assert.equal(second.error.kind, 'validation');
});

void test('declineInvitation is idempotent: declining twice returns the same declinedAt', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  await inviteToOccurrence(inviter.client, occurrenceId, invitee.user.id);
  const received = await listMyReceivedInvitations(invitee.client);
  assert.equal(received.ok, true);
  const invitation = received.data.find((i) => i.occurrenceId === occurrenceId);
  assert.ok(invitation);

  const firstDecline = await declineInvitation(invitee.client, invitation.id);
  assert.equal(firstDecline.ok, true);
  const secondDecline = await declineInvitation(invitee.client, invitation.id);
  assert.equal(secondDecline.ok, true);
  assert.equal(secondDecline.data.declinedAt, firstDecline.data.declinedAt);
});

void test('declineInvitation reports not-found for an id the caller cannot see', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  await inviteToOccurrence(inviter.client, occurrenceId, invitee.user.id);
  const received = await listMyReceivedInvitations(invitee.client);
  assert.equal(received.ok, true);
  const invitation = received.data.find((i) => i.occurrenceId === occurrenceId);
  assert.ok(invitation);

  // The inviter is not the invitee, so this id is invisible to them - the
  // RPC must report the same "not found" whether the row does not exist or
  // simply belongs to someone else (see decline_occurrence_invitation's
  // header comment).
  const result = await declineInvitation(inviter.client, invitation.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'not-found');
});

void test('listMyReceivedInvitations never includes an invitation the caller sent', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  await inviteToOccurrence(inviter.client, occurrenceId, invitee.user.id);

  const sentByInviter = await listMyReceivedInvitations(inviter.client);
  assert.equal(sentByInviter.ok, true);
  assert.ok(!sentByInviter.data.some((i) => i.occurrenceId === occurrenceId));
});

void test('inviteToOccurrence reports unauthenticated for a client with no session', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  const anonymous = createAnonymousClient();
  const result = await inviteToOccurrence(anonymous, occurrenceId, invitee.user.id);
  assert.equal(result.ok, false);
  // requireAuthenticatedUserId checks the session before this ever reaches
  // the RPC, so a missing session is `unauthenticated` even though EXECUTE
  // is also revoked from anon entirely (which would otherwise surface as a
  // generic Postgrest permission denial instead).
  assert.equal(result.error.kind, 'unauthenticated');
});

void test('declineInvitation reports unauthenticated for a client with no session', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  await inviteToOccurrence(inviter.client, occurrenceId, invitee.user.id);
  const received = await listMyReceivedInvitations(invitee.client);
  assert.equal(received.ok, true);
  const invitation = received.data.find((i) => i.occurrenceId === occurrenceId);
  assert.ok(invitation);

  const anonymous = createAnonymousClient();
  const result = await declineInvitation(anonymous, invitation.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'unauthenticated');
});

// Issue #55: inviteToOccurrenceByEmail is the actual invite UI entrypoint -
// exact registered email input, never a raw id. These tests exercise the
// three-branch dispatch exactly like the id-based tests above, plus the
// privacy-negative requirement Issue #55 adds: every invitee-dependent
// branch (no account, no participation row, considering, attending,
// previously declined) must be indistinguishable from the inviter's side.

void test('inviteToOccurrenceByEmail creates an invitation and a considering participation for the invitee', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  assert.ok(invitee.user.email);
  const result = await inviteToOccurrenceByEmail(inviter.client, occurrenceId, invitee.user.email);
  assert.deepEqual(result, { ok: true, data: undefined });

  const received = await listMyReceivedInvitations(invitee.client);
  assert.equal(received.ok, true);
  assert.ok(
    received.data.some((i) => i.occurrenceId === occurrenceId && i.inviterId === inviter.user.id),
  );

  const participation = await readOwnParticipation(invitee, occurrenceId);
  assert.equal(participation?.status, 'considering');
});

void test('inviteToOccurrenceByEmail is case-insensitive on the registered email', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  assert.ok(invitee.user.email);
  const shouted = invitee.user.email.toUpperCase();
  const result = await inviteToOccurrenceByEmail(inviter.client, occurrenceId, shouted);
  assert.deepEqual(result, { ok: true, data: undefined });

  const received = await listMyReceivedInvitations(invitee.client);
  assert.equal(received.ok, true);
  assert.ok(received.data.some((i) => i.occurrenceId === occurrenceId));
});

void test(
  'inviteToOccurrenceByEmail is opaque (ok:true, no invitation row) for an unregistered email - ' +
    'privacy-negative: identical outcome to every other invitee-dependent branch',
  async () => {
    const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
    const noAccount = await inviteToOccurrenceByEmail(
      inviter.client,
      occurrenceId,
      'no-such-stage-tracker-account@example.com',
    );
    assert.deepEqual(noAccount, { ok: true, data: undefined });

    const received = await listMyReceivedInvitations(invitee.client);
    assert.equal(received.ok, true);
    assert.ok(!received.data.some((i) => i.occurrenceId === occurrenceId));
  },
);

void test('inviteToOccurrenceByEmail is opaque when the invitee is already attending: no error, no invitation row', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  await setParticipation(invitee, occurrenceId, 'attending');
  assert.ok(invitee.user.email);

  const result = await inviteToOccurrenceByEmail(inviter.client, occurrenceId, invitee.user.email);
  assert.deepEqual(result, { ok: true, data: undefined });

  const received = await listMyReceivedInvitations(invitee.client);
  assert.equal(received.ok, true);
  assert.ok(!received.data.some((i) => i.occurrenceId === occurrenceId));

  const participation = await readOwnParticipation(invitee, occurrenceId);
  assert.equal(participation?.status, 'attending', 'attending must be left unchanged, not demoted');
});

void test('inviteToOccurrenceByEmail is opaque (ok:true, void) for a previously declined invitee - unlike the id-based RPC', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  assert.ok(invitee.user.email);
  const first = await inviteToOccurrenceByEmail(inviter.client, occurrenceId, invitee.user.email);
  assert.equal(first.ok, true);

  const received = await listMyReceivedInvitations(invitee.client);
  assert.equal(received.ok, true);
  const invitation = received.data.find((i) => i.occurrenceId === occurrenceId);
  assert.ok(invitation);
  const declined = await declineInvitation(invitee.client, invitation.id);
  assert.equal(declined.ok, true);

  // The id-based RPC raises a distinct `validation` exception for this
  // branch (see typedBoundaryInvitation's earlier "re-inviting a declined
  // invitee" test) - the email-based RPC must not, since that would let an
  // inviter who only has an email confirm the address belongs to a real,
  // previously-invited account.
  const second = await inviteToOccurrenceByEmail(inviter.client, occurrenceId, invitee.user.email);
  assert.deepEqual(second, { ok: true, data: undefined });
});

void test('inviteToOccurrenceByEmail reports validation for a malformed email', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  const result = await inviteToOccurrenceByEmail(inviter.client, occurrenceId, 'not-an-email');
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'validation');
});

void test('inviteToOccurrenceByEmail reports validation for inviting your own email', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  assert.ok(inviter.user.email);
  const result = await inviteToOccurrenceByEmail(inviter.client, occurrenceId, inviter.user.email);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'validation');
});

void test('inviteToOccurrenceByEmail reports permission-denied when the inviter is only considering', async () => {
  const { occurrence } = await createEventWithOccurrence(catalogOwner);
  await setParticipation(inviter, occurrence.id, 'considering');
  assert.ok(invitee.user.email);

  const result = await inviteToOccurrenceByEmail(inviter.client, occurrence.id, invitee.user.email);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'permission-denied');
});

void test('inviteToOccurrenceByEmail reports unauthenticated for a client with no session', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  assert.ok(invitee.user.email);
  const anonymous = createAnonymousClient();
  const result = await inviteToOccurrenceByEmail(anonymous, occurrenceId, invitee.user.email);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'unauthenticated');
});
