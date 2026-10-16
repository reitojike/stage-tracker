import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createAnonymousClient, createTestActor, deleteTestActor } from './support/testActors.ts';

// Real PostgREST + auth boundary with the deployed false gate. Positive
// enabled behavior is rollback-only pgTAP / namespace-isolated concurrency SQL.
void test('disabled contact API has equal known/unknown responses and no direct directory', async () => {
  const actor = await createTestActor('contact-access', 'Str0ng-Test-Passw0rd!');
  try {
    assert.equal((await actor.client.rpc('schedule_contact_registration_enabled')).data, false);
    const known = await actor.client.rpc('request_schedule_contact_by_email', {
      p_recipient_email: actor.user.email ?? '',
    });
    const unknown = await actor.client.rpc('request_schedule_contact_by_email', {
      p_recipient_email: `${randomUUID()}@example.test`,
    });
    assert.deepEqual(
      { status: known.status, data: known.data, error: known.error },
      { status: unknown.status, data: unknown.data, error: unknown.error },
    );
    assert.equal(known.error?.code, '0A000');
    for (const result of [
      await actor.client.rpc('list_schedule_contacts'),
      await actor.client.rpc('list_received_schedule_contact_requests'),
      await actor.client.rpc('set_schedule_contact_alias', {
        p_contact_id: randomUUID(),
        p_alias: 'private',
      }),
      await actor.client.rpc('unlink_schedule_contact', { p_contact_id: randomUUID() }),
      await actor.client.rpc('share_schedule_entry_with_contact', {
        p_contact_id: randomUUID(),
        p_schedule_entry_id: randomUUID(),
      }),
    ])
      assert.equal(result.error?.code, '0A000');
    for (const table of [
      'schedule_contact_requests',
      'schedule_contacts',
      'schedule_contact_aliases',
    ] as const) {
      assert.equal(
        (await actor.client.from(table).select('*', { count: 'exact' })).error?.code,
        '42501',
      );
    }
    assert.equal(
      (
        await actor.client.from('schedule_contact_aliases').insert({
          contact_id: randomUUID(),
          owner_id: actor.user.id,
          alias: 'private',
        })
      ).error?.code,
      '42501',
    );
    assert.equal(
      (await createAnonymousClient().rpc('list_schedule_contacts')).error?.code,
      '42501',
    );
    assert.equal((await actor.client.rpc('schedule_contact_registration_enabled')).data, false);
  } finally {
    await deleteTestActor(actor);
  }
});
