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

/**
 * Creates a confirmed auth user (admin/setup path) and signs in as that user
 * through the anon-key client (the same path a real client uses), returning
 * only the signed-in client for use in assertions.
 */
export async function createTestActor(emailPrefix: string, password: string): Promise<TestActor> {
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

  // events.owner_id references auth.users(id), and event_occurrences.event_id
  // references events(id), both with no ON DELETE action - so deleting a
  // user who still owns fixture events, or events that still have fixture
  // occurrences, would fail the FK check. Clean those up first via the
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
