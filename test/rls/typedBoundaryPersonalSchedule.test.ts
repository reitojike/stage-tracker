import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  createPersonalScheduleEntry,
  listScheduleShareRecipientEmails,
  listScheduleShares,
  listVisiblePersonalSchedule,
  removeScheduleShare,
  shareScheduleEntry,
  shareScheduleEntryByEmail,
  updatePersonalScheduleEntry,
} from '../../src/infrastructure/supabase/personalSchedule.ts';
import {
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';

// Real local Supabase/RLS tests for the personal schedule typed boundary
// (Issue #33), over public.personal_schedule_entries / public.
// personal_schedule_shares (Issue #31). Unlike test/rls/personalSchedule.
// test.ts, which exercises the raw RLS policies directly, this file
// exercises src/infrastructure/supabase/personalSchedule.ts.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let owner: TestActor;
let recipient: TestActor;
let recipient2: TestActor;
let stranger: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  owner = await createTestActor('rls-typed-sched-owner', PASSWORD);
  createdActors.push(owner);
  recipient = await createTestActor('rls-typed-sched-recipient', PASSWORD);
  createdActors.push(recipient);
  recipient2 = await createTestActor('rls-typed-sched-recipient2', PASSWORD);
  createdActors.push(recipient2);
  stranger = await createTestActor('rls-typed-sched-stranger', PASSWORD);
  createdActors.push(stranger);
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

void test('createPersonalScheduleEntry persists an all-day entry for the caller', async () => {
  const result = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'travel',
    memo: 'trip',
    temporal: { kind: 'all-day', startsOn: '2026-03-01', endsOn: '2026-03-03' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.ownerId, owner.user.id);
  assert.deepEqual(result.data.temporal, {
    kind: 'all-day',
    startsOn: '2026-03-01',
    endsOn: '2026-03-03',
  });
});

void test('createPersonalScheduleEntry persists a time-bounded entry with an unset end', async () => {
  const result = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'work',
    memo: null,
    temporal: { kind: 'time-bounded', startsAt: '2026-03-05T09:00:00Z', endsAt: null },
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.temporal.kind, 'time-bounded');
  // Compared via Date, not string equality: Postgres/PostgREST renders a
  // timestamptz back as e.g. "+00:00", not the "Z" it was submitted with -
  // see test/rls/eventOccurrences.test.ts's identical convention.
  assert.equal(new Date(result.data.temporal.startsAt).toISOString(), '2026-03-05T09:00:00.000Z');
  assert.equal(result.data.temporal.endsAt, null);
});

void test('listVisiblePersonalSchedule shows the owner their own entry, and a stranger nothing', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'other',
    memo: 'private plan',
    temporal: { kind: 'all-day', startsOn: '2026-03-10', endsOn: '2026-03-10' },
  });
  assert.equal(created.ok, true);

  const ownerView = await listVisiblePersonalSchedule(owner.client);
  assert.equal(ownerView.ok, true);
  assert.ok(ownerView.data.some((e) => e.id === created.data.id));

  const strangerView = await listVisiblePersonalSchedule(stranger.client);
  assert.equal(strangerView.ok, true);
  assert.ok(!strangerView.data.some((e) => e.id === created.data.id));
});

void test('sharing an entry makes it visible to the recipient too', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'paid_leave',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-03-15', endsOn: '2026-03-16' },
  });
  assert.equal(created.ok, true);

  const share = await shareScheduleEntry(owner.client, created.data.id, recipient.user.id);
  assert.equal(share.ok, true);
  assert.equal(share.data.sharedWithUserId, recipient.user.id);

  const recipientView = await listVisiblePersonalSchedule(recipient.client);
  assert.equal(recipientView.ok, true);
  assert.ok(recipientView.data.some((e) => e.id === created.data.id));
});

void test('updatePersonalScheduleEntry lets the owner change the entry', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'other',
    memo: 'before',
    temporal: { kind: 'all-day', startsOn: '2026-03-20', endsOn: '2026-03-20' },
  });
  assert.equal(created.ok, true);

  const updated = await updatePersonalScheduleEntry(owner.client, created.data.id, {
    scheduleType: 'other',
    memo: 'after',
    temporal: { kind: 'all-day', startsOn: '2026-03-21', endsOn: '2026-03-22' },
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.data.memo, 'after');
});

void test('updatePersonalScheduleEntry reports permission-denied for a shared recipient (visible but not writable)', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'other',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-03-25', endsOn: '2026-03-25' },
  });
  assert.equal(created.ok, true);
  const share = await shareScheduleEntry(owner.client, created.data.id, recipient.user.id);
  assert.equal(share.ok, true);

  const result = await updatePersonalScheduleEntry(recipient.client, created.data.id, {
    scheduleType: 'other',
    memo: 'hijacked',
    temporal: { kind: 'all-day', startsOn: '2026-03-25', endsOn: '2026-03-25' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'permission-denied');
});

void test('listScheduleShares: owner sees the full recipient list, recipient sees only their own row', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'other',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-03-28', endsOn: '2026-03-28' },
  });
  assert.equal(created.ok, true);
  await shareScheduleEntry(owner.client, created.data.id, recipient.user.id);

  const ownerShares = await listScheduleShares(owner.client, created.data.id);
  assert.equal(ownerShares.ok, true);
  assert.ok(ownerShares.data.some((s) => s.sharedWithUserId === recipient.user.id));

  const recipientShares = await listScheduleShares(recipient.client, created.data.id);
  assert.equal(recipientShares.ok, true);
  assert.ok(recipientShares.data.every((s) => s.sharedWithUserId === recipient.user.id));
});

void test('removeScheduleShare: a recipient can remove themselves (self-leave)', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'other',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-04-01', endsOn: '2026-04-01' },
  });
  assert.equal(created.ok, true);
  const share = await shareScheduleEntry(owner.client, created.data.id, recipient.user.id);
  assert.equal(share.ok, true);

  const removed = await removeScheduleShare(recipient.client, share.data.id);
  assert.deepEqual(removed, { ok: true, data: undefined });

  const recipientView = await listVisiblePersonalSchedule(recipient.client);
  assert.equal(recipientView.ok, true);
  assert.ok(!recipientView.data.some((e) => e.id === created.data.id));
});

void test('removeScheduleShare reports not-found for a stranger who is neither owner nor recipient', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'other',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-04-05', endsOn: '2026-04-05' },
  });
  assert.equal(created.ok, true);
  const share = await shareScheduleEntry(owner.client, created.data.id, recipient.user.id);
  assert.equal(share.ok, true);

  const result = await removeScheduleShare(stranger.client, share.data.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'not-found');
});

void test('createPersonalScheduleEntry reports unauthenticated for a client with no session', async () => {
  const anonymous = createAnonymousClient();
  const result = await createPersonalScheduleEntry(anonymous, {
    scheduleType: 'other',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-04-10', endsOn: '2026-04-10' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'unauthenticated');
});

void test('updatePersonalScheduleEntry reports unauthenticated (not permission-denied) for a client with no session', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'other',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-04-12', endsOn: '2026-04-12' },
  });
  assert.equal(created.ok, true);

  const anonymous = createAnonymousClient();
  const result = await updatePersonalScheduleEntry(anonymous, created.data.id, {
    scheduleType: 'other',
    memo: 'hijacked',
    temporal: { kind: 'all-day', startsOn: '2026-04-12', endsOn: '2026-04-12' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'unauthenticated');
});

void test('shareScheduleEntry reports unauthenticated for a client with no session', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'other',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-04-14', endsOn: '2026-04-14' },
  });
  assert.equal(created.ok, true);

  const anonymous = createAnonymousClient();
  const result = await shareScheduleEntry(anonymous, created.data.id, recipient.user.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'unauthenticated');
});

void test('removeScheduleShare reports unauthenticated for a client with no session', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'other',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-04-16', endsOn: '2026-04-16' },
  });
  assert.equal(created.ok, true);
  const share = await shareScheduleEntry(owner.client, created.data.id, recipient.user.id);
  assert.equal(share.ok, true);

  const anonymous = createAnonymousClient();
  const result = await removeScheduleShare(anonymous, share.data.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'unauthenticated');
});

// Issue #55: shareScheduleEntryByEmail / listScheduleShareRecipientEmails
// are the actual sharing-UI entrypoints - exact registered email input,
// never a raw id, plus the bounded owner-only recipient-email read
// projection #37's recipient-removal UI needs.

void test('shareScheduleEntryByEmail shares an entry with a recipient identified by exact email', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'paid_leave',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-05-01', endsOn: '2026-05-02' },
  });
  assert.equal(created.ok, true);
  assert.ok(recipient.user.email);

  const share = await shareScheduleEntryByEmail(
    owner.client,
    created.data.id,
    recipient.user.email,
  );
  assert.equal(share.ok, true);
  assert.equal(share.data.sharedWithUserId, recipient.user.id);

  const recipientView = await listVisiblePersonalSchedule(recipient.client);
  assert.equal(recipientView.ok, true);
  assert.ok(recipientView.data.some((e) => e.id === created.data.id));
});

void test('shareScheduleEntryByEmail is case-insensitive on the registered email', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'other',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-05-03', endsOn: '2026-05-03' },
  });
  assert.equal(created.ok, true);
  assert.ok(recipient.user.email);

  const share = await shareScheduleEntryByEmail(
    owner.client,
    created.data.id,
    recipient.user.email.toUpperCase(),
  );
  assert.equal(share.ok, true);
  assert.equal(share.data.sharedWithUserId, recipient.user.id);
});

void test('shareScheduleEntryByEmail is idempotent: re-sharing the same recipient returns the existing row', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'other',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-05-04', endsOn: '2026-05-04' },
  });
  assert.equal(created.ok, true);
  assert.ok(recipient.user.email);

  const first = await shareScheduleEntryByEmail(
    owner.client,
    created.data.id,
    recipient.user.email,
  );
  assert.equal(first.ok, true);
  const second = await shareScheduleEntryByEmail(
    owner.client,
    created.data.id,
    recipient.user.email,
  );
  assert.equal(second.ok, true);
  assert.equal(second.data.id, first.data.id);
});

void test(
  'shareScheduleEntryByEmail reports validation (not permission-denied) for an unregistered email - ' +
    'unlike invitation, sharing is not required to hide account existence',
  async () => {
    const created = await createPersonalScheduleEntry(owner.client, {
      scheduleType: 'other',
      memo: null,
      temporal: { kind: 'all-day', startsOn: '2026-05-05', endsOn: '2026-05-05' },
    });
    assert.equal(created.ok, true);

    const result = await shareScheduleEntryByEmail(
      owner.client,
      created.data.id,
      'no-such-stage-tracker-account@example.com',
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'validation');
  },
);

void test('shareScheduleEntryByEmail reports validation for a malformed email', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'other',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-05-06', endsOn: '2026-05-06' },
  });
  assert.equal(created.ok, true);

  const result = await shareScheduleEntryByEmail(owner.client, created.data.id, 'not-an-email');
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'validation');
});

void test('shareScheduleEntryByEmail reports validation for sharing with your own email', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'other',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-05-07', endsOn: '2026-05-07' },
  });
  assert.equal(created.ok, true);
  assert.ok(owner.user.email);

  const result = await shareScheduleEntryByEmail(owner.client, created.data.id, owner.user.email);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'validation');
});

void test('shareScheduleEntryByEmail reports permission-denied for a non-owner caller, even a shared recipient', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'other',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-05-08', endsOn: '2026-05-08' },
  });
  assert.equal(created.ok, true);
  assert.ok(recipient.user.email);
  assert.ok(stranger.user.email);
  const share = await shareScheduleEntryByEmail(
    owner.client,
    created.data.id,
    recipient.user.email,
  );
  assert.equal(share.ok, true);

  // A shared recipient can see the entry, but cannot manage other
  // recipients on it - mirrors updatePersonalScheduleEntry's "visible but
  // not writable" boundary above.
  const result = await shareScheduleEntryByEmail(
    recipient.client,
    created.data.id,
    stranger.user.email,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'permission-denied');
});

void test('shareScheduleEntryByEmail reports unauthenticated for a client with no session', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'other',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-05-09', endsOn: '2026-05-09' },
  });
  assert.equal(created.ok, true);
  assert.ok(recipient.user.email);

  const anonymous = createAnonymousClient();
  const result = await shareScheduleEntryByEmail(anonymous, created.data.id, recipient.user.email);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'unauthenticated');
});

void test('listScheduleShareRecipientEmails lets the owner identify recipients by email', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'other',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-05-10', endsOn: '2026-05-10' },
  });
  assert.equal(created.ok, true);
  assert.ok(recipient.user.email);
  await shareScheduleEntryByEmail(owner.client, created.data.id, recipient.user.email);

  const result = await listScheduleShareRecipientEmails(owner.client, created.data.id);
  assert.equal(result.ok, true);
  assert.ok(result.data.some((r) => r.recipientEmail === recipient.user.email?.toLowerCase()));
});

void test('listScheduleShareRecipientEmails returns every recipient of one entry, not just the first', async () => {
  // A real (not mocked) round trip through client.rpc(...).range(...) with
  // more than one row - src/infrastructure/supabase/__tests__/pagedFetch.
  // test.ts proves fetchAllRows itself accumulates pages correctly with a
  // mocked queryPage; this proves the real RPC + fetchAllRows wiring
  // returns every row against the actual local PostgREST/Postgres, not
  // just what a single unranged request happens to return.
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'other',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-05-10', endsOn: '2026-05-10' },
  });
  assert.equal(created.ok, true);
  assert.ok(recipient.user.email);
  assert.ok(recipient2.user.email);
  await shareScheduleEntryByEmail(owner.client, created.data.id, recipient.user.email);
  await shareScheduleEntryByEmail(owner.client, created.data.id, recipient2.user.email);

  const result = await listScheduleShareRecipientEmails(owner.client, created.data.id);
  assert.equal(result.ok, true);
  const emails = result.data.map((r) => r.recipientEmail);
  assert.equal(emails.length, 2);
  assert.ok(emails.includes(recipient.user.email.toLowerCase()));
  assert.ok(emails.includes(recipient2.user.email.toLowerCase()));
});

void test(
  'listScheduleShareRecipientEmails reports permission-denied for a non-owner - ' +
    'privacy-negative: a shared recipient cannot read this projection, and neither can a stranger',
  async () => {
    const created = await createPersonalScheduleEntry(owner.client, {
      scheduleType: 'other',
      memo: null,
      temporal: { kind: 'all-day', startsOn: '2026-05-11', endsOn: '2026-05-11' },
    });
    assert.equal(created.ok, true);
    assert.ok(recipient.user.email);
    await shareScheduleEntryByEmail(owner.client, created.data.id, recipient.user.email);

    const asRecipient = await listScheduleShareRecipientEmails(recipient.client, created.data.id);
    assert.equal(asRecipient.ok, false);
    assert.equal(asRecipient.error.kind, 'permission-denied');

    const asStranger = await listScheduleShareRecipientEmails(stranger.client, created.data.id);
    assert.equal(asStranger.ok, false);
    assert.equal(asStranger.error.kind, 'permission-denied');
  },
);

void test('listScheduleShareRecipientEmails reports unauthenticated for a client with no session', async () => {
  const created = await createPersonalScheduleEntry(owner.client, {
    scheduleType: 'other',
    memo: null,
    temporal: { kind: 'all-day', startsOn: '2026-05-12', endsOn: '2026-05-12' },
  });
  assert.equal(created.ok, true);

  const anonymous = createAnonymousClient();
  const result = await listScheduleShareRecipientEmails(anonymous, created.data.id);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'unauthenticated');
});
