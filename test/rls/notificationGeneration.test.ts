import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg from 'pg';
import {
  createAdminClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';
import { createEventWithOccurrence } from './support/eventFixtures.ts';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';
import {
  declineInvitationOrThrow,
  invitationReceived,
  invitationsReceived,
  inviteToOccurrence,
  inviteToOccurrenceByEmail,
  inviteToOccurrenceByEmailOrThrow,
  inviteToOccurrenceOrThrow,
  requireActorEmail,
  setParticipation,
} from './support/participationFixtures.ts';

// Issue #511: the Notification must be a consequence of an actual new
// occurrence_invitations row, not of an attempted RPC call. These tests keep
// the source mutation/RLS boundary under test through normal authenticated
// clients and use service_role only for fixture inspection.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let catalogOwner: TestActor;
let inviter: TestActor;
let invitee: TestActor;
let other: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  catalogOwner = await createTestActor('rls-notification-generation-catalog', PASSWORD, {
    designatedCatalogCreator: true,
  });
  createdActors.push(catalogOwner);
  inviter = await createTestActor('rls-notification-generation-inviter', PASSWORD);
  createdActors.push(inviter);
  invitee = await createTestActor('rls-notification-generation-invitee', PASSWORD);
  createdActors.push(invitee);
  other = await createTestActor('rls-notification-generation-other', PASSWORD);
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

async function invitableOccurrence(): Promise<string> {
  const { occurrenceId } = await (async () => {
    const result = await createEventWithOccurrence(catalogOwner);
    await setParticipation(inviter, result.occurrence.id, 'attending');
    return { occurrenceId: result.occurrence.id };
  })();
  return occurrenceId;
}

async function notificationsForRecipient() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('notifications')
    .select('id, recipient_id, kind, source_id')
    .eq('recipient_id', invitee.user.id)
    .order('id', { ascending: true });
  assert.equal(error, null);
  return data;
}

async function notificationCount(): Promise<number> {
  return (await notificationsForRecipient()).length;
}

async function notificationForSource(sourceId: string) {
  const rows = (await notificationsForRecipient()).filter((row) => row.source_id === sourceId);
  assert.equal(rows.length, 1, `expected one Notification for source ${sourceId}`);
  const notification = rows[0];
  if (notification === undefined) {
    throw new Error(`expected one Notification for source ${sourceId}`);
  }
  return notification;
}

void test('direct user-ID invite creates exactly one recipient/kind/source Notification', async () => {
  const occurrenceId = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrenceId, invitee.user.id);

  const invitation = await invitationReceived(invitee, occurrenceId);
  assert.ok(invitation);
  const notification = await notificationForSource(invitation.id);
  assert.deepEqual(notification, {
    id: notification.id,
    recipient_id: invitee.user.id,
    kind: 'invitation_received',
    source_id: invitation.id,
  });
});

void test('email invite to an existing account creates exactly one Notification', async () => {
  const occurrenceId = await invitableOccurrence();
  await inviteToOccurrenceByEmailOrThrow(inviter, occurrenceId, requireActorEmail(invitee));

  const invitation = await invitationReceived(invitee, occurrenceId);
  assert.ok(invitation);
  const notification = await notificationForSource(invitation.id);
  assert.equal(notification.recipient_id, invitee.user.id);
  assert.equal(notification.kind, 'invitation_received');
  assert.equal(notification.source_id, invitation.id);
});

void test('duplicate retry does not increase source or Notification count', async () => {
  const occurrenceId = await invitableOccurrence();
  const before = await notificationCount();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { error } = await inviteToOccurrence(inviter, occurrenceId, invitee.user.id);
    assert.equal(error, null);
  }

  const invitations = await invitationsReceived(invitee, occurrenceId);
  assert.equal(invitations.length, 1);
  assert.equal(await notificationCount(), before + 1);
  await notificationForSource(invitations[0]!.id);
});

void test('concurrent duplicate submits settle on exactly one source and one Notification', async () => {
  const occurrenceId = await invitableOccurrence();
  const before = await notificationCount();

  const results = await Promise.all(
    Array.from({ length: 8 }, () => inviteToOccurrence(inviter, occurrenceId, invitee.user.id)),
  );
  assert.ok(results.every((result) => result.error === null));

  const invitations = await invitationsReceived(invitee, occurrenceId);
  assert.equal(invitations.length, 1);
  assert.equal(await notificationCount(), before + 1);
  await notificationForSource(invitations[0]!.id);
});

void test('already-attending invitees create neither source nor Notification', async () => {
  const directOccurrence = await invitableOccurrence();
  await setParticipation(invitee, directOccurrence, 'attending');
  const beforeDirect = await notificationCount();
  const direct = await inviteToOccurrence(inviter, directOccurrence, invitee.user.id);
  assert.equal(direct.error, null);
  assert.deepEqual(await invitationsReceived(invitee, directOccurrence), []);
  assert.equal(await notificationCount(), beforeDirect);

  const emailOccurrence = await invitableOccurrence();
  await setParticipation(invitee, emailOccurrence, 'attending');
  const beforeEmail = await notificationCount();
  const email = await inviteToOccurrenceByEmail(
    inviter,
    emailOccurrence,
    requireActorEmail(invitee),
  );
  assert.equal(email.error, null);
  assert.deepEqual(await invitationsReceived(invitee, emailOccurrence), []);
  assert.equal(await notificationCount(), beforeEmail);
});

void test('missing-account email targeting remains opaque and creates neither source nor Notification', async () => {
  const occurrenceId = await invitableOccurrence();
  const before = await notificationCount();
  const { error } = await inviteToOccurrenceByEmail(
    inviter,
    occurrenceId,
    `missing-${randomUUID()}@example.test`,
  );
  assert.equal(error, null);
  assert.deepEqual(await invitationsReceived(invitee, occurrenceId), []);
  assert.equal(await notificationCount(), before);
});

void test('canceled occurrence rejects both source paths without a Notification', async () => {
  const { event, occurrence } = await createEventWithOccurrence(catalogOwner);
  await setParticipation(inviter, occurrence.id, 'attending');
  const { error: cancelError } = await catalogOwner.client
    .from('event_occurrences')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', occurrence.id);
  assert.equal(cancelError, null);

  const before = await notificationCount();
  const direct = await inviteToOccurrence(inviter, occurrence.id, invitee.user.id);
  assert.equal(direct.error?.code, '90002');
  const email = await inviteToOccurrenceByEmail(inviter, occurrence.id, requireActorEmail(other));
  assert.equal(email.error?.code, '90002');
  assert.deepEqual(await invitationsReceived(invitee, occurrence.id), []);
  assert.equal(await notificationCount(), before);

  // Keep the fixture's parent event referenced so the test makes clear that
  // the occurrence-level cancellation is the rejection source.
  assert.ok(event.id);
});

void test('decline then valid re-invite creates a new source and a new Notification while the old one remains', async () => {
  const occurrenceId = await invitableOccurrence();
  await inviteToOccurrenceOrThrow(inviter, occurrenceId, invitee.user.id);
  const first = await invitationReceived(invitee, occurrenceId);
  assert.ok(first);
  const firstNotification = await notificationForSource(first.id);

  await declineInvitationOrThrow(invitee, first.id);
  assert.deepEqual(await invitationsReceived(invitee, occurrenceId), []);

  await inviteToOccurrenceOrThrow(inviter, occurrenceId, invitee.user.id);
  const second = await invitationReceived(invitee, occurrenceId);
  assert.ok(second);
  assert.notEqual(second.id, first.id);
  const secondNotification = await notificationForSource(second.id);
  assert.notEqual(secondNotification.id, firstNotification.id);

  const oldNotification = (await notificationsForRecipient()).find(
    (row) => row.id === firstNotification.id,
  );
  assert.ok(oldNotification, 'the source-soft-referenced historical Notification must remain');
});

void test('invitation RPC responses stay void and branch-opaque while generation is internal', async () => {
  const directOccurrence = await invitableOccurrence();
  const directResult = await inviter.client.rpc('invite_to_occurrence', {
    p_occurrence_id: directOccurrence,
    p_invitee_id: invitee.user.id,
  });
  assert.equal(directResult.error, null);
  assert.equal(directResult.data, null);

  const emailOccurrence = await invitableOccurrence();
  const emailResult = await inviter.client.rpc('invite_to_occurrence_by_email', {
    p_occurrence_id: emailOccurrence,
    p_invitee_email: requireActorEmail(invitee),
  });
  assert.equal(emailResult.error, null);
  assert.equal(emailResult.data, null);
});

async function newDatabaseClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: readLocalSupabaseStatus().dbUrl });
  await client.connect();
  return client;
}

void test('Notification generation failure rolls back the source Invitation in the same transaction', async () => {
  const occurrenceId = await invitableOccurrence();
  const before = await notificationCount();
  const client = await newDatabaseClient();
  try {
    await client.query('begin');
    // This trigger and function exist only inside this test transaction. They
    // deterministically fail the Notification INSERT without adding a
    // production fail switch or changing the migration contract.
    await client.query(`
      create function public.issue_511_test_fail_notification_insert() returns trigger
      language plpgsql
      as $$
      begin
        raise exception 'issue 511 test notification generation failure';
      end;
      $$
    `);
    await client.query(`
      create trigger issue_511_test_fail_notification_insert
        before insert on public.notifications
        for each row
        execute function public.issue_511_test_fail_notification_insert()
    `);
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [inviter.user.id]);

    await assert.rejects(
      client.query('select public.invite_to_occurrence($1, $2)', [occurrenceId, invitee.user.id]),
      /issue 511 test notification generation failure/,
    );
    await client.query('rollback');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  assert.deepEqual(
    await invitationsReceived(invitee, occurrenceId),
    [],
    'the source Invitation must roll back when Notification generation fails',
  );
  assert.equal(
    await notificationCount(),
    before,
    'the failed source write must not leave an orphan Notification',
  );
});
