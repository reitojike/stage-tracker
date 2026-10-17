import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActorsSequentially,
} from './support/testActors.ts';
import {
  createTimedScheduleEntry,
  ensureAcceptedScheduleContact,
  shareScheduleEntry,
} from './support/personalScheduleFixtures.ts';

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

void test('current contact generation governs PostgREST reads and never revives old shares', async () => {
  const a = await createTestActor('contact-read-a', 'Str0ng-Test-Passw0rd!');
  const b = await createTestActor('contact-read-b', 'Str0ng-Test-Passw0rd!');
  const c = await createTestActor('contact-read-c', 'Str0ng-Test-Passw0rd!');
  try {
    const entryA = await createTimedScheduleEntry(a);
    const entryB = await createTimedScheduleEntry(b);
    const oldContact = await ensureAcceptedScheduleContact(a, b);
    const ab = await shareScheduleEntry(a, entryA.id, b);
    const ba = await shareScheduleEntry(b, entryB.id, a);
    const ac = await shareScheduleEntry(a, entryA.id, c);
    assert.equal(ab.contact_id, oldContact);
    assert.equal(ba.contact_id, oldContact);

    async function visible(
      actor: typeof a,
      table: 'personal_schedule_entries' | 'personal_schedule_shares',
      id: string,
    ) {
      const response = await actor.client.from(table).select('id').eq('id', id);
      assert.equal(
        response.error,
        null,
        'RLS must work without a recursive policy or private-table grant',
      );
      return response.data;
    }
    assert.deepEqual(await visible(b, 'personal_schedule_entries', entryA.id), [{ id: entryA.id }]);
    assert.deepEqual(await visible(b, 'personal_schedule_shares', ac.id), []);
    assert.deepEqual(await visible(c, 'personal_schedule_entries', entryB.id), []);
    const ownerProjection = await a.client.rpc('list_schedule_share_recipient_emails', {
      p_schedule_entry_id: entryA.id,
    });
    assert.equal(ownerProjection.error, null);
    assert.deepEqual(ownerProjection.data.map((row) => row.share_id).sort(), [ab.id, ac.id].sort());
    for (const actor of [b, c]) {
      assert.ok(
        (
          await actor.client.rpc('list_schedule_share_recipient_emails', {
            p_schedule_entry_id: entryA.id,
          })
        ).error,
        'recipients cannot enumerate the other recipients',
      );
      assert.equal((await actor.client.from('schedule_contacts').select('*')).error?.code, '42501');
    }

    assert.equal(
      (await b.client.rpc('unlink_schedule_contact', { p_contact_id: oldContact })).error,
      null,
    );
    assert.deepEqual(await visible(b, 'personal_schedule_entries', entryA.id), []);
    assert.deepEqual(await visible(a, 'personal_schedule_entries', entryB.id), []);
    assert.deepEqual(await visible(a, 'personal_schedule_entries', entryA.id), [{ id: entryA.id }]);
    assert.deepEqual(await visible(c, 'personal_schedule_entries', entryA.id), [{ id: entryA.id }]);
    assert.deepEqual(await visible(a, 'personal_schedule_shares', ab.id), []);
    assert.deepEqual(await visible(b, 'personal_schedule_shares', ba.id), []);
    assert.deepEqual(await visible(a, 'personal_schedule_shares', ac.id), [{ id: ac.id }]);

    const newContact = await ensureAcceptedScheduleContact(a, b);
    assert.notEqual(newContact, oldContact);
    assert.deepEqual(
      await visible(b, 'personal_schedule_entries', entryA.id),
      [],
      'reacceptance alone does not share',
    );
    assert.equal(
      (
        await a.client.rpc('share_schedule_entry_with_contact', {
          p_schedule_entry_id: entryA.id,
          p_contact_id: oldContact,
        })
      ).error?.code,
      '42501',
    );
    const fresh = await shareScheduleEntry(a, entryA.id, b);
    assert.notEqual(fresh.id, ab.id);
    assert.equal(fresh.contact_id, newContact);
    assert.deepEqual(await visible(b, 'personal_schedule_entries', entryA.id), [{ id: entryA.id }]);

    assert.equal(
      (await b.client.from('personal_schedule_shares').delete().eq('id', fresh.id)).error,
      null,
    );
    assert.deepEqual(await visible(b, 'personal_schedule_entries', entryA.id), []);
    const contacts = await a.client.rpc('list_schedule_contacts');
    assert.equal(contacts.error, null);
    assert.ok(
      contacts.data.some((contact) => contact.contact_id === newContact),
      'self-leave preserves registration',
    );
    assert.equal(
      (await a.client.from('personal_schedule_shares').delete().eq('id', ac.id)).error,
      null,
    );
    assert.deepEqual(await visible(c, 'personal_schedule_entries', entryA.id), []);
    assert.deepEqual(await visible(a, 'personal_schedule_entries', entryA.id), [{ id: entryA.id }]);
  } finally {
    await deleteTestActorsSequentially([a, b, c]);
  }
});
