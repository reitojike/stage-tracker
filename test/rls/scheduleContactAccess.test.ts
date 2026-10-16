import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActorsSequentially,
} from './support/testActors.ts';
import { createTimedScheduleEntry } from './support/personalScheduleFixtures.ts';

// Real PostgREST + auth boundary with the contact cutover enabled. Contact
// creation uses both authenticated actors; service_role is limited to setup
// and cleanup by the shared test actor helpers.
void test('contact API requires acceptance and the legacy email share RPC is revoked', async () => {
  const owner = await createTestActor('contact-access-owner', 'Str0ng-Test-Passw0rd!');
  const recipient = await createTestActor('contact-access-recipient', 'Str0ng-Test-Passw0rd!');
  try {
    const { data: enabled, error: gateError } = await owner.client.rpc(
      'schedule_contact_registration_enabled',
    );
    assert.equal(gateError, null);
    assert.equal(enabled, true);

    const entry = await createTimedScheduleEntry(owner);
    const recipientEmail = recipient.user.email;
    assert.ok(recipientEmail);
    const { error: unacceptedShareError } = await owner.client.rpc(
      'share_schedule_entry_with_contact',
      { p_schedule_entry_id: entry.id, p_contact_id: randomUUID() },
    );
    assert.equal(unacceptedShareError?.code, '42501');
    const { data: sharesBeforeAcceptance, error: sharesBeforeAcceptanceError } = await owner.client
      .from('personal_schedule_shares')
      .select('id')
      .eq('schedule_entry_id', entry.id);
    assert.equal(sharesBeforeAcceptanceError, null);
    assert.deepEqual(sharesBeforeAcceptance, []);

    const knownLegacy = await owner.client.rpc('share_schedule_entry_by_email', {
      p_schedule_entry_id: entry.id,
      p_recipient_email: recipientEmail,
    });
    const unknownLegacy = await owner.client.rpc('share_schedule_entry_by_email', {
      p_schedule_entry_id: entry.id,
      p_recipient_email: `${randomUUID()}@example.test`,
    });
    assert.equal(knownLegacy.error?.code, '42501');
    assert.deepEqual(
      { status: knownLegacy.status, data: knownLegacy.data, error: knownLegacy.error },
      { status: unknownLegacy.status, data: unknownLegacy.data, error: unknownLegacy.error },
    );

    const { error: requestError } = await owner.client.rpc('request_schedule_contact_by_email', {
      p_recipient_email: recipientEmail,
    });
    assert.equal(requestError, null);

    const { data: requests, error: requestsError } = await recipient.client.rpc(
      'list_received_schedule_contact_requests',
    );
    assert.equal(requestsError, null);
    const ownerEmail = owner.user.email;
    assert.ok(ownerEmail);
    const request = requests.find(
      (item) => item.requester_email.toLowerCase() === ownerEmail.toLowerCase(),
    );
    assert.ok(request, 'recipient should see the owner’s pending contact request');

    const { error: acceptError } = await recipient.client.rpc('accept_schedule_contact_request', {
      p_request_id: request.request_id,
    });
    assert.equal(acceptError, null);

    const { data: contacts, error: contactsError } =
      await owner.client.rpc('list_schedule_contacts');
    assert.equal(contactsError, null);
    const contact = contacts.find(
      (item) => item.counterpart_email.toLowerCase() === recipientEmail.toLowerCase(),
    );
    assert.ok(contact, 'accepted contact should appear in the owner’s contact list');

    const { data: share, error: shareError } = await owner.client.rpc(
      'share_schedule_entry_with_contact',
      { p_schedule_entry_id: entry.id, p_contact_id: contact.contact_id },
    );
    assert.equal(shareError, null);
    assert.ok(share);

    const { data: visibleEntry, error: readError } = await recipient.client
      .from('personal_schedule_entries')
      .select('id')
      .eq('id', entry.id)
      .single();
    assert.equal(readError, null);
    assert.equal(visibleEntry.id, entry.id);

    for (const table of [
      'schedule_contact_requests',
      'schedule_contacts',
      'schedule_contact_aliases',
    ] as const) {
      assert.equal(
        (await owner.client.from(table).select('*', { count: 'exact' })).error?.code,
        '42501',
      );
    }
    assert.equal(
      (
        await owner.client.from('schedule_contact_aliases').insert({
          contact_id: contact.contact_id,
          owner_id: owner.user.id,
          alias: 'private',
        })
      ).error?.code,
      '42501',
    );
    assert.equal(
      (await createAnonymousClient().rpc('list_schedule_contacts')).error?.code,
      '42501',
    );
    assert.equal((await owner.client.rpc('schedule_contact_registration_enabled')).data, true);
  } finally {
    await deleteTestActorsSequentially([owner, recipient]);
  }
});
