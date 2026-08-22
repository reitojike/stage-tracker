import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { Database } from '../../../src/infrastructure/supabase/database.types.ts';
import { readLocalSupabaseStatus } from './localSupabase.ts';

// This module is the fixture/setup boundary for DB/RLS tests: it creates
// and tears down test users using the service_role admin path. Nothing here
// is used to perform or assert the RLS-governed operations under test -
// those always go through the anon-key clients returned by
// createAnonymousClient / signInAsUser below, which carry only the
// permissions a real end user would have.

const status = readLocalSupabaseStatus();

export function createAnonymousClient(): SupabaseClient<Database> {
  return createClient<Database>(status.apiUrl, status.anonKey);
}

function createAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(status.apiUrl, status.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface TestActor {
  user: User;
  client: SupabaseClient<Database>;
}

export interface TestActorOptions {
  /**
   * Grants designated catalog creator membership (Issue #29) right after
   * the user is created. Event creation is restricted to that membership,
   * so any actor a test uses to produce fixture events needs it; actors
   * used only to prove denial deliberately do not.
   */
  designatedCatalogCreator?: boolean;
}

/**
 * Grants designated catalog creator membership through the service_role
 * admin path. `authenticated` has no write privilege on catalog_creators
 * at all, which is the point - this is setup, and mirrors the operational
 * grant script (scripts/grant-catalog-creator.mjs), not something a test's
 * own client could do to itself.
 */
export async function grantCatalogCreator(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('catalog_creators')
    .upsert({ user_id: userId }, { onConflict: 'user_id' });
  if (error) {
    throw new Error(`failed to grant catalog creator to ${userId}: ${error.message}`);
  }
}

export async function revokeCatalogCreator(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from('catalog_creators').delete().eq('user_id', userId);
  if (error) {
    throw new Error(`failed to revoke catalog creator from ${userId}: ${error.message}`);
  }
}

/**
 * Creates a confirmed auth user (admin/setup path) and signs in as that user
 * through the anon-key client (the same path a real client uses), returning
 * only the signed-in client for use in assertions.
 */
export async function createTestActor(
  emailPrefix: string,
  password: string,
  options: TestActorOptions = {},
): Promise<TestActor> {
  const admin = createAdminClient();
  const email = `${emailPrefix}-${String(Date.now())}-${Math.random().toString(36).slice(2)}@example.test`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) {
    throw new Error(`failed to create test user ${email}: ${createError.message}`);
  }

  if (options.designatedCatalogCreator === true) {
    await grantCatalogCreator(created.user.id);
  }

  const client = createAnonymousClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) {
    // Don't leave a bare, unusable user behind just because sign-in failed
    // after creation succeeded. Report a cleanup failure here too, rather
    // than discarding it, so it doesn't go unnoticed.
    const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id);
    const cleanupSuffix = cleanupError
      ? ` (cleanup of the orphaned user also failed: ${cleanupError.message})`
      : '';
    throw new Error(
      `failed to sign in as test user ${email}: ${signInError.message}${cleanupSuffix}`,
    );
  }

  return { user: created.user, client };
}

export async function deleteTestActor(actor: TestActor): Promise<void> {
  const admin = createAdminClient();

  // personal_schedule_entries.owner_id and personal_schedule_shares.
  // shared_with_user_id both reference auth.users(id) with no ON DELETE
  // action (Issue #31), and personal_schedule_shares.schedule_entry_id
  // references personal_schedule_entries(id), also with no ON DELETE
  // action. A test actor can appear as either an entry owner or a share
  // recipient (or both), so clean up every angle before the events/
  // occurrences cleanup below and before deleting the user itself.
  const { error: deleteSharesAsRecipientError } = await admin
    .from('personal_schedule_shares')
    .delete()
    .eq('shared_with_user_id', actor.user.id);
  if (deleteSharesAsRecipientError) {
    throw new Error(
      `failed to delete fixture schedule shares received by test user ${actor.user.id}: ${deleteSharesAsRecipientError.message}`,
    );
  }

  const { data: ownedScheduleEntries, error: selectScheduleEntriesError } = await admin
    .from('personal_schedule_entries')
    .select('id')
    .eq('owner_id', actor.user.id);
  if (selectScheduleEntriesError) {
    throw new Error(
      `failed to list fixture schedule entries for test user ${actor.user.id}: ${selectScheduleEntriesError.message}`,
    );
  }

  const ownedScheduleEntryIds = ownedScheduleEntries.map((entry) => entry.id);
  const SCHEDULE_ENTRY_ID_BATCH_SIZE = 100;
  for (let start = 0; start < ownedScheduleEntryIds.length; start += SCHEDULE_ENTRY_ID_BATCH_SIZE) {
    const batch = ownedScheduleEntryIds.slice(start, start + SCHEDULE_ENTRY_ID_BATCH_SIZE);
    const { error: deleteSharesOnOwnedEntriesError } = await admin
      .from('personal_schedule_shares')
      .delete()
      .in('schedule_entry_id', batch);
    if (deleteSharesOnOwnedEntriesError) {
      throw new Error(
        `failed to delete fixture schedule shares on entries owned by test user ${actor.user.id}: ${deleteSharesOnOwnedEntriesError.message}`,
      );
    }
  }

  const { error: deleteScheduleEntriesError } = await admin
    .from('personal_schedule_entries')
    .delete()
    .eq('owner_id', actor.user.id);
  if (deleteScheduleEntriesError) {
    throw new Error(
      `failed to delete fixture schedule entries for test user ${actor.user.id}: ${deleteScheduleEntriesError.message}`,
    );
  }

  // events.owner_id references auth.users(id), and event_occurrences.event_id
  // references events(id), both with no ON DELETE action - so deleting a
  // user who still owns fixture events, or events that still have fixture
  // occurrences, would fail the FK check. catalog_creators needs no
  // equivalent step: its user_id FK is ON DELETE CASCADE, so a granted
  // actor's membership row goes with the user. Clean the rest up first via the
  // admin path (setup/teardown, not an RLS assertion), innermost first, so
  // teardown actually removes what each test created. This ordering is
  // fixture cleanup only; it does not decide product deletion/cancellation
  // semantics for events or occurrences.
  const { data: ownedEvents, error: selectEventsError } = await admin
    .from('events')
    .select('id')
    .eq('owner_id', actor.user.id);
  if (selectEventsError) {
    throw new Error(
      `failed to list fixture events for test user ${actor.user.id}: ${selectEventsError.message}`,
    );
  }

  const ownedEventIds = ownedEvents.map((event) => event.id);
  // Chunked rather than one `.in()` call: event_id is embedded directly in
  // the request URL, and a fixture actor that owns hundreds of events
  // (e.g. pagination tests) can otherwise produce a "URI too long" error
  // that has nothing to do with the RLS behavior under test.
  const EVENT_ID_BATCH_SIZE = 100;
  for (let start = 0; start < ownedEventIds.length; start += EVENT_ID_BATCH_SIZE) {
    const batch = ownedEventIds.slice(start, start + EVENT_ID_BATCH_SIZE);
    const { error: deleteOccurrencesError } = await admin
      .from('event_occurrences')
      .delete()
      .in('event_id', batch);
    if (deleteOccurrencesError) {
      throw new Error(
        `failed to delete fixture occurrences for test user ${actor.user.id}: ${deleteOccurrencesError.message}`,
      );
    }
  }

  const { error: deleteEventsError } = await admin
    .from('events')
    .delete()
    .eq('owner_id', actor.user.id);
  if (deleteEventsError) {
    throw new Error(
      `failed to delete fixture events for test user ${actor.user.id}: ${deleteEventsError.message}`,
    );
  }

  const { error: deleteUserError } = await admin.auth.admin.deleteUser(actor.user.id);
  if (deleteUserError) {
    throw new Error(`failed to delete test user ${actor.user.id}: ${deleteUserError.message}`);
  }
}
