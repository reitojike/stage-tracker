import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  createAdminClient,
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';
import {
  createAllDayScheduleEntry,
  createTimedScheduleEntry,
  scheduleEntryMemo,
  shareScheduleEntry,
} from './support/personalScheduleFixtures.ts';

// Real local Supabase/Postgres RLS tests for public.personal_schedule_entries
// / public.personal_schedule_shares (Issue #31). See test/rls/events.test.ts's
// header comment for the anon/service_role/authenticated client conventions
// used throughout, and 20260822000000_create_personal_schedule.sql for the
// product semantics each test below is verifying.
//
// A denied UPDATE/DELETE is not always a request error: when RLS's USING
// clause filters a row out of visibility for the caller, the
// UPDATE/DELETE simply matches zero rows and returns successfully with
// empty data. A denied INSERT (RLS WITH CHECK failure) does surface as a
// request error. Each test below asserts the actual observed shape for its
// case, not just "an error happened".

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let owner: TestActor;
let recipient: TestActor;
let stranger: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  owner = await createTestActor('rls-sched-owner', PASSWORD);
  createdActors.push(owner);
  recipient = await createTestActor('rls-sched-recipient', PASSWORD);
  createdActors.push(recipient);
  stranger = await createTestActor('rls-sched-stranger', PASSWORD);
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

// --- Positive: temporal shapes ---

void test('owner can create a single-day all-day entry', async () => {
  const entry = await createAllDayScheduleEntry(owner);
  assert.equal(entry.is_all_day, true);
  assert.equal(entry.ends_on, entry.starts_on);
  assert.equal(entry.starts_at, null);
  assert.equal(entry.ends_at, null);
});

void test('owner can create a multi-day all-day entry', async () => {
  const startsOn = '2026-09-01';
  const endsOn = '2026-09-03';
  const entry = await createAllDayScheduleEntry(owner, { startsOn, endsOn });
  assert.equal(entry.starts_on, startsOn);
  assert.equal(entry.ends_on, endsOn);
});

void test('owner can create a time-bounded entry with an unset end', async () => {
  const entry = await createTimedScheduleEntry(owner);
  assert.equal(entry.is_all_day, false);
  assert.ok(entry.starts_at);
  assert.equal(entry.ends_at, null);
  assert.equal(entry.starts_on, null);
  assert.equal(entry.ends_on, null);
});

void test('owner can create a time-bounded entry with a known end', async () => {
  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const entry = await createTimedScheduleEntry(owner, { startsAt, endsAt });
  assert.equal(new Date(entry.starts_at ?? '').toISOString(), startsAt);
  assert.equal(new Date(entry.ends_at ?? '').toISOString(), endsAt);
});

// --- Negative: temporal shape must not silently mix or invert ---

void test('rejects an all-day entry that also sets starts_at', async () => {
  const startsOn = new Date().toISOString().slice(0, 10);
  const { error } = await owner.client.from('personal_schedule_entries').insert({
    owner_id: owner.user.id,
    title: 'x',
    blocking: true,
    is_all_day: true,
    starts_on: startsOn,
    ends_on: startsOn,
    starts_at: new Date().toISOString(),
  });
  assert.ok(error, 'expected the temporal shape check constraint to reject a mixed all-day row');
});

void test('rejects a time-bounded entry that also sets starts_on', async () => {
  const { error } = await owner.client.from('personal_schedule_entries').insert({
    owner_id: owner.user.id,
    title: 'x',
    blocking: true,
    is_all_day: false,
    starts_at: new Date().toISOString(),
    starts_on: new Date().toISOString().slice(0, 10),
  });
  assert.ok(
    error,
    'expected the temporal shape check constraint to reject a mixed time-bounded row',
  );
});

void test('rejects an all-day entry with ends_on before starts_on', async () => {
  const { error } = await owner.client.from('personal_schedule_entries').insert({
    owner_id: owner.user.id,
    title: 'x',
    blocking: true,
    is_all_day: true,
    starts_on: '2026-09-05',
    ends_on: '2026-09-01',
  });
  assert.ok(error, 'expected the temporal shape check constraint to reject an inverted date range');
});

void test('rejects a time-bounded entry with ends_at before starts_at', async () => {
  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { error } = await owner.client.from('personal_schedule_entries').insert({
    owner_id: owner.user.id,
    title: 'x',
    blocking: true,
    is_all_day: false,
    starts_at: startsAt,
    ends_at: endsAt,
  });
  assert.ok(
    error,
    'expected the temporal shape check constraint to reject an inverted timed range',
  );
});

void test('rejects an all-day entry missing ends_on', async () => {
  const { error } = await owner.client.from('personal_schedule_entries').insert({
    owner_id: owner.user.id,
    title: 'x',
    blocking: true,
    is_all_day: true,
    starts_on: new Date().toISOString().slice(0, 10),
  });
  assert.ok(error, 'expected the temporal shape check constraint to reject a missing ends_on');
});

void test('rejects a time-bounded entry missing starts_at', async () => {
  const { error } = await owner.client.from('personal_schedule_entries').insert({
    owner_id: owner.user.id,
    title: 'x',
    blocking: true,
    is_all_day: false,
  });
  assert.ok(error, 'expected the temporal shape check constraint to reject a missing starts_at');
});

// --- Positive: default-private / owner read+write ---

void test('owner can read their own entry', async () => {
  const entry = await createTimedScheduleEntry(owner);
  const { data, error } = await owner.client
    .from('personal_schedule_entries')
    .select()
    .eq('id', entry.id);
  assert.equal(error, null);
  assert.equal(data.length, 1);
});

void test('owner can update their own entry', async () => {
  const entry = await createTimedScheduleEntry(owner);
  const newMemo = scheduleEntryMemo();
  const { data, error } = await owner.client
    .from('personal_schedule_entries')
    .update({ memo: newMemo })
    .eq('id', entry.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.memo, newMemo);
});

// --- Negative: default-private (no share yet) ---

void test('a user with no share cannot read another owner’s entry', async () => {
  const entry = await createTimedScheduleEntry(owner);
  const { data, error } = await stranger.client
    .from('personal_schedule_entries')
    .select()
    .eq('id', entry.id);
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

void test('a user with no share cannot update another owner’s entry, and the row stays unchanged', async () => {
  const entry = await createTimedScheduleEntry(owner);
  const { data: updateData, error: updateError } = await stranger.client
    .from('personal_schedule_entries')
    .update({ memo: 'hijacked' })
    .eq('id', entry.id)
    .select();
  assert.equal(updateError, null);
  assert.deepEqual(updateData, []);

  const { data: refetched } = await owner.client
    .from('personal_schedule_entries')
    .select()
    .eq('id', entry.id)
    .single();
  assert.equal(refetched?.memo, entry.memo);
});

void test('owner_id cannot be spoofed on insert', async () => {
  const startsOn = new Date().toISOString().slice(0, 10);
  const { error } = await stranger.client.from('personal_schedule_entries').insert({
    owner_id: owner.user.id,
    title: 'x',
    blocking: true,
    is_all_day: true,
    starts_on: startsOn,
    ends_on: startsOn,
  });
  assert.ok(error, 'expected a permission error for inserting with someone else’s owner_id');
});

// --- Positive: explicit sharing takes effect immediately ---

void test('owner sharing an entry lets the recipient read it', async () => {
  const entry = await createTimedScheduleEntry(owner);
  await shareScheduleEntry(owner, entry.id, recipient.user.id);

  const { data, error } = await recipient.client
    .from('personal_schedule_entries')
    .select()
    .eq('id', entry.id);
  assert.equal(error, null);
  assert.equal(data.length, 1);
  const [row] = data;
  assert.ok(row);
  assert.equal(row.memo, entry.memo);
  assert.equal(row.title, entry.title);
  assert.equal(row.blocking, entry.blocking);
});

void test('owner can see the recipients they have shared an entry with', async () => {
  const entry = await createTimedScheduleEntry(owner);
  await shareScheduleEntry(owner, entry.id, recipient.user.id);

  const { data, error } = await owner.client
    .from('personal_schedule_shares')
    .select()
    .eq('schedule_entry_id', entry.id);
  assert.equal(error, null);
  assert.equal(data.length, 1);
  assert.equal(data[0]?.shared_with_user_id, recipient.user.id);
});

void test('recipient can see their own share row', async () => {
  const entry = await createTimedScheduleEntry(owner);
  const share = await shareScheduleEntry(owner, entry.id, recipient.user.id);

  const { data, error } = await recipient.client
    .from('personal_schedule_shares')
    .select()
    .eq('id', share.id);
  assert.equal(error, null);
  assert.equal(data.length, 1);
});

void test('sharing the same entry with the same recipient twice is rejected', async () => {
  const entry = await createTimedScheduleEntry(owner);
  await shareScheduleEntry(owner, entry.id, recipient.user.id);

  const { error } = await owner.client
    .from('personal_schedule_shares')
    .insert({ schedule_entry_id: entry.id, shared_with_user_id: recipient.user.id });
  assert.ok(error, 'expected the unique constraint to reject a duplicate share');
});

// --- Negative: a shared user cannot edit the entry or manage recipients ---

void test('a recipient cannot update the shared entry, and the row stays unchanged', async () => {
  const entry = await createTimedScheduleEntry(owner);
  await shareScheduleEntry(owner, entry.id, recipient.user.id);

  const { data: updateData, error: updateError } = await recipient.client
    .from('personal_schedule_entries')
    .update({ memo: 'recipient edit attempt' })
    .eq('id', entry.id)
    .select();
  assert.equal(updateError, null);
  assert.deepEqual(updateData, []);

  const { data: refetched } = await owner.client
    .from('personal_schedule_entries')
    .select()
    .eq('id', entry.id)
    .single();
  assert.equal(refetched?.memo, entry.memo);
});

void test('a recipient cannot add another recipient to an entry they don’t own', async () => {
  const entry = await createTimedScheduleEntry(owner);
  await shareScheduleEntry(owner, entry.id, recipient.user.id);

  const { error } = await recipient.client
    .from('personal_schedule_shares')
    .insert({ schedule_entry_id: entry.id, shared_with_user_id: stranger.user.id });
  assert.ok(error, 'expected a permission error for a recipient adding another recipient');
});

void test('a recipient cannot remove another recipient’s share', async () => {
  const entry = await createTimedScheduleEntry(owner);
  await shareScheduleEntry(owner, entry.id, recipient.user.id);
  const otherShare = await shareScheduleEntry(owner, entry.id, stranger.user.id);

  const { data: deleteData, error: deleteError } = await recipient.client
    .from('personal_schedule_shares')
    .delete()
    .eq('id', otherShare.id)
    .select();
  assert.equal(deleteError, null);
  assert.deepEqual(deleteData, []);

  const { data: refetched } = await owner.client
    .from('personal_schedule_shares')
    .select()
    .eq('id', otherShare.id);
  assert.equal(refetched?.length, 1);
});

// --- Positive: recipient self-removal, owner recipient removal ---

void test('a recipient can remove themselves from a share, losing read access', async () => {
  const entry = await createTimedScheduleEntry(owner);
  const share = await shareScheduleEntry(owner, entry.id, recipient.user.id);

  const { error: deleteError } = await recipient.client
    .from('personal_schedule_shares')
    .delete()
    .eq('id', share.id);
  assert.equal(deleteError, null);

  const { data } = await recipient.client
    .from('personal_schedule_entries')
    .select()
    .eq('id', entry.id);
  assert.deepEqual(data, []);
});

void test('the owner can remove a recipient, revoking their read access', async () => {
  const entry = await createTimedScheduleEntry(owner);
  const share = await shareScheduleEntry(owner, entry.id, recipient.user.id);

  const { error: deleteError } = await owner.client
    .from('personal_schedule_shares')
    .delete()
    .eq('id', share.id);
  assert.equal(deleteError, null);

  const { data } = await recipient.client
    .from('personal_schedule_entries')
    .select()
    .eq('id', entry.id);
  assert.deepEqual(data, []);
});

// --- Negative: anonymous ---

void test('anonymous cannot read schedule entries', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.from('personal_schedule_entries').select();
  assert.ok(error, 'expected a permission error for anonymous select');
});

void test('anonymous cannot insert schedule entries', async () => {
  const startsOn = new Date().toISOString().slice(0, 10);
  const anon = createAnonymousClient();
  const { error } = await anon.from('personal_schedule_entries').insert({
    owner_id: owner.user.id,
    title: 'x',
    blocking: true,
    is_all_day: true,
    starts_on: startsOn,
    ends_on: startsOn,
  });
  assert.ok(error, 'expected a permission error for anonymous insert');
});

void test('anonymous cannot update schedule entries', async () => {
  const entry = await createTimedScheduleEntry(owner);
  const anon = createAnonymousClient();
  const { error } = await anon
    .from('personal_schedule_entries')
    .update({ memo: 'anon edit' })
    .eq('id', entry.id);
  assert.ok(error, 'expected a permission error for anonymous update');
});

void test('anonymous cannot delete schedule entries', async () => {
  const entry = await createTimedScheduleEntry(owner);
  const anon = createAnonymousClient();
  const { error } = await anon.from('personal_schedule_entries').delete().eq('id', entry.id);
  assert.ok(error, 'expected a permission error for anonymous delete');
});

void test('anonymous cannot read schedule shares', async () => {
  const anon = createAnonymousClient();
  const { error } = await anon.from('personal_schedule_shares').select();
  assert.ok(error, 'expected a permission error for anonymous select');
});

void test('anonymous cannot insert schedule shares', async () => {
  const entry = await createTimedScheduleEntry(owner);
  const anon = createAnonymousClient();
  const { error } = await anon
    .from('personal_schedule_shares')
    .insert({ schedule_entry_id: entry.id, shared_with_user_id: recipient.user.id });
  assert.ok(error, 'expected a permission error for anonymous insert');
});

void test('anonymous cannot delete schedule shares', async () => {
  const entry = await createTimedScheduleEntry(owner);
  const share = await shareScheduleEntry(owner, entry.id, recipient.user.id);
  const anon = createAnonymousClient();
  const { error } = await anon.from('personal_schedule_shares').delete().eq('id', share.id);
  assert.ok(error, 'expected a permission error for anonymous delete');
});

// --- Negative: system-managed fields ---

void test('normal client cannot mutate id', async () => {
  const entry = await createTimedScheduleEntry(owner);
  const { error } = await owner.client
    .from('personal_schedule_entries')
    .update({ id: crypto.randomUUID() })
    .eq('id', entry.id);
  assert.ok(error, 'expected a permission error for changing id');
});

void test('normal client cannot mutate created_at', async () => {
  const entry = await createTimedScheduleEntry(owner);
  const { error } = await owner.client
    .from('personal_schedule_entries')
    .update({ created_at: new Date(0).toISOString() })
    .eq('id', entry.id);
  assert.ok(error, 'expected a permission error for changing created_at');
});

void test('updated_at is DB-managed on a real update', async () => {
  const entry = await createTimedScheduleEntry(owner);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const { data, error } = await owner.client
    .from('personal_schedule_entries')
    .update({ memo: 'trigger updated_at' })
    .eq('id', entry.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.ok(data);
  assert.notEqual(data.updated_at, entry.updated_at);
  assert.ok(new Date(data.updated_at).getTime() > new Date(entry.updated_at).getTime());
});

void test('normal client cannot set updated_at directly', async () => {
  const entry = await createTimedScheduleEntry(owner);
  const { error } = await owner.client
    .from('personal_schedule_entries')
    .update({ updated_at: new Date(0).toISOString() })
    .eq('id', entry.id);
  assert.ok(error, 'expected a permission error for setting updated_at directly');
});

void test('owner cannot transfer ownership of an entry', async () => {
  const entry = await createTimedScheduleEntry(owner);
  const { error } = await owner.client
    .from('personal_schedule_entries')
    .update({ owner_id: recipient.user.id })
    .eq('id', entry.id);
  assert.ok(error, 'expected a permission error for changing owner_id');

  const { data: refetched } = await owner.client
    .from('personal_schedule_entries')
    .select()
    .eq('id', entry.id)
    .single();
  assert.equal(refetched?.owner_id, owner.user.id);
});

// --- Entry deletion (Issue #121): owner-only hard delete, cascading to
// dependent personal_schedule_shares rows. The create migration
// (20260822000000) deliberately withheld DELETE entirely; 20260826000000
// added personal_schedule_entries_delete_own plus an ON DELETE CASCADE FK
// from personal_schedule_shares.schedule_entry_id.

void test('owner can delete their own entry', async () => {
  const entry = await createTimedScheduleEntry(owner);
  const { error: deleteError } = await owner.client
    .from('personal_schedule_entries')
    .delete()
    .eq('id', entry.id);
  assert.equal(deleteError, null);

  const { data } = await owner.client.from('personal_schedule_entries').select().eq('id', entry.id);
  assert.deepEqual(data, []);
});

void test('deleting an entry cascades to its shares, leaving no orphan row', async () => {
  const entry = await createTimedScheduleEntry(owner);
  const share = await shareScheduleEntry(owner, entry.id, recipient.user.id);

  const { error: deleteError } = await owner.client
    .from('personal_schedule_entries')
    .delete()
    .eq('id', entry.id);
  assert.equal(deleteError, null);

  // Bypasses RLS (createAdminClient - see testActors.ts's own header on why
  // assertions normally avoid it) specifically to prove the share row was
  // actually deleted by the FK's ON DELETE CASCADE, not merely hidden from
  // both parties by RLS now that the entry it referenced is gone - an
  // orphaned row with no entry left to grant access to would be invisible
  // to owner/recipient reads either way, so only a privilege-bypassing read
  // can tell the two apart.
  const admin = createAdminClient();
  const { data: orphanCheck, error: orphanCheckError } = await admin
    .from('personal_schedule_shares')
    .select()
    .eq('id', share.id);
  assert.equal(orphanCheckError, null);
  assert.deepEqual(orphanCheck, []);

  // Both parties lose visibility too, as a consequence.
  const { data: recipientView } = await recipient.client
    .from('personal_schedule_entries')
    .select()
    .eq('id', entry.id);
  assert.deepEqual(recipientView, []);
});

void test('a recipient cannot delete a shared entry, and it remains visible to the owner', async () => {
  const entry = await createTimedScheduleEntry(owner);
  await shareScheduleEntry(owner, entry.id, recipient.user.id);

  const { data: deleteData, error: deleteError } = await recipient.client
    .from('personal_schedule_entries')
    .delete()
    .eq('id', entry.id)
    .select();
  assert.equal(deleteError, null);
  assert.deepEqual(deleteData, []);

  const { data: refetched } = await owner.client
    .from('personal_schedule_entries')
    .select()
    .eq('id', entry.id);
  assert.equal(refetched?.length, 1);
});

void test('a stranger (no share, not the owner) cannot delete an entry', async () => {
  const entry = await createTimedScheduleEntry(owner);
  const { data: deleteData, error: deleteError } = await stranger.client
    .from('personal_schedule_entries')
    .delete()
    .eq('id', entry.id)
    .select();
  assert.equal(deleteError, null);
  assert.deepEqual(deleteData, []);

  const { data: refetched } = await owner.client
    .from('personal_schedule_entries')
    .select()
    .eq('id', entry.id);
  assert.equal(refetched?.length, 1);
});
