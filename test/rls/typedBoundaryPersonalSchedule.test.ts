import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  createPersonalScheduleEntry,
  listScheduleShares,
  listVisiblePersonalSchedule,
  removeScheduleShare,
  shareScheduleEntry,
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
let stranger: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  owner = await createTestActor('rls-typed-sched-owner', PASSWORD);
  createdActors.push(owner);
  recipient = await createTestActor('rls-typed-sched-recipient', PASSWORD);
  createdActors.push(recipient);
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
