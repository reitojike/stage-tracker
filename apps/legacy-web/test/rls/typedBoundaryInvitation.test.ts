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

void test('inviteToOccurrence creates only the invitation - Issue #225/#230 removes the former auto-considering side effect', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  const result = await inviteToOccurrence(inviter.client, occurrenceId, invitee.user.id);
  assert.deepEqual(result, { ok: true, data: undefined });

  const received = await listMyReceivedInvitations(invitee.client);
  assert.equal(received.ok, true);
  assert.ok(
    received.data.some((i) => i.occurrenceId === occurrenceId && i.inviterId === inviter.user.id),
  );

  const participation = await readOwnParticipation(invitee, occurrenceId);
  assert.equal(participation, null, 'inviting a rowless invitee must not create a participation');
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

void test('inviteToOccurrence creates a new pending invitation after a prior decline (not a permanent block, Issue #225/#230)', async () => {
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
  assert.deepEqual(second, { ok: true, data: undefined });

  const receivedAfter = await listMyReceivedInvitations(invitee.client);
  assert.equal(receivedAfter.ok, true);
  assert.ok(receivedAfter.data.some((i) => i.occurrenceId === occurrenceId));
});

void test('declineInvitation is idempotent: a second decline reports ok:true with data: null', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  await inviteToOccurrence(inviter.client, occurrenceId, invitee.user.id);
  const received = await listMyReceivedInvitations(invitee.client);
  assert.equal(received.ok, true);
  const invitation = received.data.find((i) => i.occurrenceId === occurrenceId);
  assert.ok(invitation);

  const firstDecline = await declineInvitation(invitee.client, invitation.id);
  assert.equal(firstDecline.ok, true);
  assert.equal(firstDecline.data?.id, invitation.id);

  const secondDecline = await declineInvitation(invitee.client, invitation.id);
  assert.deepEqual(secondDecline, { ok: true, data: null });
});

void test('declineInvitation reports ok:true with data: null for an id the caller cannot see', async () => {
  const { occurrenceId } = await createOccurrenceWithAttendee(catalogOwner, inviter);
  await inviteToOccurrence(inviter.client, occurrenceId, invitee.user.id);
  const received = await listMyReceivedInvitations(invitee.client);
  assert.equal(received.ok, true);
  const invitation = received.data.find((i) => i.occurrenceId === occurrenceId);
  assert.ok(invitation);

  // The inviter is not the invitee, so this id matches no row for them - the
  // RPC reports the same benign `data: null` whether the row does not
  // exist, belongs to someone else, or was already resolved (see
  // decline_occurrence_invitation's header comment: this must not become a
  // probe for whether a given id exists).
  const result = await declineInvitation(inviter.client, invitation.id);
  assert.deepEqual(result, { ok: true, data: null });

  // The invitation itself is untouched - only the invitee's own call can
  // actually resolve it.
  const stillPending = await listMyReceivedInvitations(invitee.client);
  assert.equal(stillPending.ok, true);
  assert.ok(stillPending.data.some((i) => i.id === invitation.id));
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

void test('inviteToOccurrenceByEmail creates only the invitation - Issue #225/#230 removes the former auto-considering side effect', async () => {
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
  assert.equal(participation, null, 'inviting a rowless invitee must not create a participation');
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

void test('inviteToOccurrenceByEmail creates a new pending invitation after a prior decline (not a permanent block, Issue #225/#230)', async () => {
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

  // Issue #225/#230 removes the id-based RPC's former distinct exception for
  // this branch too, so both entrypoints now behave the same way here: a
  // prior decline never permanently blocks re-invitation.
  const second = await inviteToOccurrenceByEmail(inviter.client, occurrenceId, invitee.user.email);
  assert.deepEqual(second, { ok: true, data: undefined });

  const receivedAfter = await listMyReceivedInvitations(invitee.client);
  assert.equal(receivedAfter.ok, true);
  assert.ok(receivedAfter.data.some((i) => i.occurrenceId === occurrenceId));
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
